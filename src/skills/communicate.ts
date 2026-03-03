import { readAgentFile, writeAgentFile, appendToJournal, readPromptFile, readPeopleFiles, appendPeopleNotes, parsePeopleUpdates, readRecentJournal } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import * as bluesky from "../lib/bluesky.js";
import type { CommunicateAction, BlueskyProfile } from "../types.js";
import { CONFIG } from "../config.js";

function atUriToWebUrl(uri: string): string {
  const match = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  if (match) return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
  return uri;
}

function didToWebUrl(did: string): string {
  return `https://bsky.app/profile/${did}`;
}

function extractDid(uri: string): string {
  return uri.match(/^at:\/\/([^/]+)\//)?.[1] ?? uri;
}

/** Returns a markdown link identifying the target of an action, used in error log entries. */
function actionTarget(action: CommunicateAction): string {
  switch (action.action) {
    case "post": return "";
    case "reply": return ` ([post](${atUriToWebUrl(action.postUri)}))`;
    case "dm": return ` [${action.did}](${didToWebUrl(action.did)}) — "${action.text}"`;
    case "follow": return ` ([${action.did}](${didToWebUrl(action.did)}))`;
    case "unfollow": {
      const did = extractDid(action.followUri);
      return ` ([${did}](${didToWebUrl(did)}))`;
    }
    case "like": return ` ([post](${atUriToWebUrl(action.uri)}))`;
    case "repost": return ` ([post](${atUriToWebUrl(action.uri)}))`;
  }
}

function parseActions(response: string): CommunicateAction[] {
  const actions: CommunicateAction[] = [];
  const jsonPattern = /```json\s*\n([\s\S]*?)```|(\{[^\n]*"action"[^\n]*\})/g;
  let match;

  while ((match = jsonPattern.exec(response)) !== null) {
    const jsonStr = match[1] || match[2];
    // Handle multiple JSON objects in a single block
    for (const line of jsonStr.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          actions.push(JSON.parse(trimmed));
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
  return actions;
}

/** Returns the DIDs of all accounts targeted by a set of actions. */
function collectTargetDids(actions: CommunicateAction[]): string[] {
  const dids = new Set<string>();
  for (const a of actions) {
    switch (a.action) {
      case "reply":   dids.add(extractDid(a.postUri)); break;
      case "dm":
      case "follow":  dids.add(a.did); break;
      case "unfollow": dids.add(extractDid(a.followUri)); break;
      case "like":
      case "repost":  dids.add(extractDid(a.uri)); break;
    }
  }
  return [...dids];
}

/** Returns a markdown link like `[@handle (Display Name)](profile-url)` for a DID. */
function profileLink(did: string, profiles: Map<string, BlueskyProfile>): string {
  const p = profiles.get(did);
  if (!p) return `[${did}](${didToWebUrl(did)})`;
  const label = p.displayName ? `@${p.handle} (${p.displayName})` : `@${p.handle}`;
  return `[${label}](${didToWebUrl(did)})`;
}

const FORBIDDEN_TEXT_RE = /[—;@]/;

function checkText(text: string): string | null {
  if (FORBIDDEN_TEXT_RE.test(text)) {
    const char = text.match(FORBIDDEN_TEXT_RE)![0];
    const name = char === "—" ? "em dash" : char === ";" ? "semicolon" : "@ symbol";
    const reason = char === "@"
      ? "Mentioning other users by handle in posts is considered rude — address people only when replying directly to them."
      : `Using ${name}s is a recognizable AI writing quirk — rephrase without it.`;
    return `Skipped — text contains ${name}. ${reason} Original text: "${text}"`;
  }
  return null;
}

async function executeAction(action: CommunicateAction, profiles: Map<string, BlueskyProfile>): Promise<string> {
  switch (action.action) {
    case "post": {
      const blocked = checkText(action.text);
      if (blocked) return blocked;
      const result = await bluesky.post(action.text);
      const link = result.uri !== "dry-run" ? ` ([view post](${atUriToWebUrl(result.uri)}))` : "";
      return `Posted: "${action.text}"${link}`;
    }
    case "reply": {
      const blockedReply = checkText(action.text);
      if (blockedReply) return blockedReply;
      const rootUri = action.rootUri ?? action.postUri;
      const rootCid = action.rootCid ?? action.postCid;
      const authorDid = extractDid(action.postUri);
      // Check if the target post is too old to reply to
      const [targetPost] = await bluesky.getPosts([action.postUri]);
      if (targetPost && isStale(targetPost.createdAt)) {
        return `Skipped reply to ${profileLink(authorDid, profiles)} — post is older than 2 days. Replying to stale posts feels out of context and is blocked automatically.`;
      }
      if (await bluesky.hasReplied(action.postUri)) {
        return `Skipped reply to ${profileLink(authorDid, profiles)} — already replied to this post. Duplicate replies are blocked automatically.`;
      }
      if (!CONFIG.allowReplyToNonFollowers) {
        const followed = await bluesky.isFollowedBy(authorDid);
        if (!followed) {
          return `Skipped reply to ${profileLink(authorDid, profiles)} — author does not follow us. Replying to non-followers is disabled by the allowReplyToNonFollowers setting.`;
        }
      }
      const result = await bluesky.reply(
        action.text,
        action.postUri,
        action.postCid,
        rootUri,
        rootCid,
      );
      const replyLink = result.uri !== "dry-run" ? ` ([view reply](${atUriToWebUrl(result.uri)}))` : "";
      return `Replied to ${profileLink(authorDid, profiles)} ([post](${atUriToWebUrl(action.postUri)})): "${action.text}"${replyLink}`;
    }
    case "dm": {
      const blockedDm = checkText(action.text);
      if (blockedDm) return blockedDm;
      await bluesky.sendDM(action.did, action.text);
      return `DM to ${profileLink(action.did, profiles)}: "${action.text}"`;
    }
    case "follow": {
      const profile = profiles.get(action.did);
      if (profile?.weFollow) {
        return `Skipped follow of ${profileLink(action.did, profiles)} — already following. Check existing follow status before issuing follow actions.`;
      }
      await bluesky.follow(action.did);
      return `Followed ${profileLink(action.did, profiles)}`;
    }
    case "unfollow": {
      await bluesky.unfollow(action.followUri);
      const did = extractDid(action.followUri);
      return `Unfollowed ${profileLink(did, profiles)}`;
    }
    case "like":
      await bluesky.like(action.uri, action.cid);
      return `Liked [post](${atUriToWebUrl(action.uri)}) by ${profileLink(extractDid(action.uri), profiles)}`;
    case "repost":
      await bluesky.repost(action.uri, action.cid);
      return `Reposted [post](${atUriToWebUrl(action.uri)}) by ${profileLink(extractDid(action.uri), profiles)}`;
  }
}

const STALE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function isStale(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() > STALE_MS;
}

function formatNotificationsForCommunicate(
  notifs: import("../types.js").BlueskyNotification[],
  profiles: Map<string, BlueskyProfile>,
): string {
  const actionable = notifs.filter((n) => n.reason === "reply" || n.reason === "mention");
  if (actionable.length === 0) return "";

  const lines = actionable.map((n) => {
    const followStatus = profiles.get(n.author.did)?.weFollow ? " **(you follow)**" : " **(not following)**";
    const replyTo = n.subjectUri ? `\n  ↳ In reply to your post: ${n.subjectUri}` : "";
    const staleTag = isStale(n.createdAt) ? " ⚠️ **STALE — do not respond**" : "";
    return `**${n.reason}** from @${n.author.handle}${followStatus} [${n.author.did}]${staleTag}\n  Text: "${n.text ?? ""}"\n  uri: ${n.uri}\n  cid: ${n.cid}${replyTo}\n  _${n.createdAt}_`;
  });

  return `\n\n## Notifications Requiring Possible Response\n\nThese are replies and mentions from this cycle. Use the \`uri\` and \`cid\` values directly when constructing reply actions. **Do not respond to notifications marked STALE** — they are older than 2 days and a reply would feel out of context.\n\n${lines.join("\n\n---\n\n")}`;
}

function formatFollowerProfile(p: BlueskyProfile): string {
  return [
    `**@${p.handle}**${p.displayName ? ` (${p.displayName})` : ""} — \`${p.did}\``,
    p.description ? `Bio: ${p.description}` : "Bio: _(none)_",
    `Followers: ${p.followersCount ?? 0} | Following: ${p.followsCount ?? 0} | Posts: ${p.postsCount ?? 0}`,
  ].join("\n");
}

export async function communicate(): Promise<void> {
  console.log("[communicate] Starting...");

  const [systemPrompt, mindset, ownProfile, notifications, ingestDidsRaw, agentReadme, ownRecentPosts, recentJournal] = await Promise.all([
    readPromptFile("communicate.md"),
    readAgentFile("mindset.md"),
    bluesky.getProfile(CONFIG.bluesky.handle),
    bluesky.getNotifications(),
    readAgentFile("ingest_dids.json"),
    readAgentFile("README.md"),
    bluesky.getAuthorFeed(CONFIG.bluesky.handle, 50),
    readRecentJournal(CONFIG.maxJournalContextLines),
  ]);

  // Find accounts that followed us but we haven't followed back
  const followerDids = [...new Set(
    notifications.filter((n) => n.reason === "follow").map((n) => n.author.did),
  )];
  const unfollowedFollowers = await bluesky.getUnfollowedFollowers(followerDids);

  // Fetch follow status for actionable notification authors so the model knows who it already follows
  const actionableNotifDids = [...new Set(
    notifications
      .filter((n) => n.reason === "reply" || n.reason === "mention")
      .map((n) => n.author.did),
  )];
  const actionableProfiles = actionableNotifDids.length > 0
    ? await bluesky.getProfiles(actionableNotifDids)
    : [];
  const actionableProfileMap = new Map(actionableProfiles.map((p) => [p.did, p]));

  // Load people files for all known DIDs this cycle
  let ingestDids: string[] = [];
  try { ingestDids = JSON.parse(ingestDidsRaw); } catch { /* ignore */ }
  const notifDids = notifications.map((n) => n.author.did);
  const newFollowerDids = unfollowedFollowers.map((p) => p.did);
  const allPeopleDids = [...new Set([...ingestDids, ...notifDids, ...newFollowerDids])];
  const peopleFiles = await readPeopleFiles(allPeopleDids);
  const peopleEntries = Object.entries(peopleFiles);
  const peopleSection = peopleEntries.length > 0
    ? "\n\n## People Context\n\nYou have notes on these accounts:\n\n" +
      peopleEntries.map(([did, content]) => `### ${did}\n\n${content}`).join("\n\n")
    : "";

  const followingSuggestion =
    (ownProfile.followsCount ?? 0) < CONFIG.targetFollowCount
      ? `\n\n> **Note:** You are currently following ${ownProfile.followsCount ?? 0} accounts (target: ${CONFIG.targetFollowCount}). Consider finding someone interesting on your timeline to follow this cycle.`
      : "";

  const newFollowersSection = unfollowedFollowers.length > 0
    ? `\n\n## New Followers to Evaluate\n\nThese accounts recently followed you and you haven't followed back. Review each and decide whether to follow them.\n\n${unfollowedFollowers.map(formatFollowerProfile).join("\n\n")}`
    : "";

  const notificationsSection = formatNotificationsForCommunicate(notifications, actionableProfileMap);

  // Show posts we've already replied to so the model doesn't attempt duplicate replies
  const repliedToUris = ownRecentPosts
    .filter((p) => p.replyTo)
    .map((p) => p.replyTo!);
  const alreadyRepliedSection = repliedToUris.length > 0
    ? `\n\n## Posts You Have Already Replied To\n\nDo NOT reply to any of these posts again.\n\n${repliedToUris.map((uri) => `- ${uri}`).join("\n")}`
    : "";

  const journalSection = recentJournal.trim()
    ? `\n\n## Journal (recent entries)\n\nReview recent communication logs below — any actions marked "Skipped" were blocked by hard-coded safety checks. Adjust your behavior to satisfy these restrictions, or note in your mindset if you want to propose a change during iterate.\n\n${recentJournal}`
    : "";

  const userContent = (agentReadme ? agentReadme + "\n\n---\n\n" : "") + "## Current Mindset\n\n" + mindset + followingSuggestion + notificationsSection + alreadyRepliedSection + journalSection + newFollowersSection + peopleSection +
    '\n\n---\n\nProduce your response in two clearly labeled sections:\n\n## Updated Mindset\n(your mindset after deciding what to communicate)\n\n## Actions\n(your chosen actions as JSON, or "No actions — choosing silence.")\n\nOptionally add a third section:\n\n## People Updates\n(if you have new thoughts about specific people, record them here)';

  const response = await callSkill(systemPrompt, userContent, {
    model: CONFIG.anthropic.modelDeep,
  });

  // Parse and execute actions, with retry loop for skipped actions
  const allLogs: string[] = [];
  let currentResponse = response;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const actions = parseActions(currentResponse);
    if (actions.length === 0) {
      if (attempt === 0) allLogs.push("Chose silence — no actions taken.");
      break;
    }

    const targetDids = collectTargetDids(actions);
    const targetProfiles = targetDids.length > 0 ? await bluesky.getProfiles(targetDids) : [];
    const profileMap = new Map(targetProfiles.map((p) => [p.did, p]));

    const roundLog: string[] = [];
    for (const action of actions) {
      try {
        const result = await executeAction(action, profileMap);
        roundLog.push(result);
      } catch (err) {
        const body = JSON.stringify(action);
        const desc = `Failed to ${action.action}${actionTarget(action)}: ${err}\n  \`\`\`json\n  ${body}\n  \`\`\``;
        console.error(`  [communicate] Failed to ${action.action}: ${err}`);
        roundLog.push(desc);
      }
    }

    allLogs.push(...roundLog);

    // Check for skipped actions that the agent could fix by rephrasing
    const retryable = roundLog.filter((l) => l.startsWith("Skipped — text contains"));
    if (retryable.length === 0 || attempt === MAX_RETRIES) break;

    console.log(`[communicate] ${retryable.length} action(s) skipped — asking agent to retry`);
    const retryPrompt = `Some of your actions were blocked. Here is what happened:\n\n${retryable.map((s) => "- " + s).join("\n")}\n\nPlease rephrase and resubmit ONLY the blocked actions as a new ## Actions section. Do not resend actions that succeeded. If you cannot satisfy the restriction, output "No actions — giving up."`;

    currentResponse = await callSkill(systemPrompt, retryPrompt, {
      model: CONFIG.anthropic.modelDeep,
      maxTokens: 1024,
    });
  }

  // Log all actions to journal
  const logEntry = `\n\n### Communication Log — ${new Date().toISOString()}\n${CONFIG.dryRun ? "*(dry run)*\n" : ""}${allLogs.map((a) => "- " + a).join("\n")}`;
  await appendToJournal(logEntry);

  // Update mindset from the original response
  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Actions|$)/,
  );
  if (mindsetMatch) {
    await writeAgentFile("mindset.md", mindsetMatch[1].trim());
    console.log("[communicate] Updated mindset.md");
  }

  // Append any people updates the model produced
  const condenser = async (entries: string, header: string) => {
    return await callSkill(
      "Condense these timestamped observations about a person into 1-3 sentences. Preserve key facts: who they are, relationship dynamics, important topics, and notable traits. Be specific.",
      `${header}\n\nObservations to condense:\n${entries}`,
      { maxTokens: 256 },
    );
  };
  const peopleUpdates = parsePeopleUpdates(response);
  for (const [did, update] of Object.entries(peopleUpdates)) {
    await appendPeopleNotes(did, update.notes, update.heading, condenser);
    console.log(`[communicate] Appended people notes for ${did}`);
  }

  console.log(`[communicate] ${allLogs.length} actions processed`);
}
