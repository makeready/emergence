import { readAgentFile, writeAgentFile, appendToJournal, readPromptFile } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import * as bluesky from "../lib/bluesky.js";
import type { CommunicateAction } from "../types.js";
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

async function executeAction(action: CommunicateAction): Promise<string> {
  switch (action.action) {
    case "post": {
      const result = await bluesky.post(action.text);
      const link = result.uri !== "dry-run" ? ` ([view post](${atUriToWebUrl(result.uri)}))` : "";
      return `Posted: "${action.text}"${link}`;
    }
    case "reply": {
      const rootUri = action.rootUri ?? action.postUri;
      const rootCid = action.rootCid ?? action.postCid;
      if (!CONFIG.allowReplyToNonFollowers) {
        const authorDid = extractDid(action.postUri);
        const followed = await bluesky.isFollowedBy(authorDid);
        if (!followed) {
          return `Skipped reply to [post](${atUriToWebUrl(action.postUri)}) — author does not follow us`;
        }
      }
      const result = await bluesky.reply(
        action.text,
        action.postUri,
        action.postCid,
        rootUri,
        rootCid,
      );
      const targetLink = `[post](${atUriToWebUrl(action.postUri)})`;
      const replyLink = result.uri !== "dry-run" ? ` ([view reply](${atUriToWebUrl(result.uri)}))` : "";
      return `Replied to ${targetLink}: "${action.text}"${replyLink}`;
    }
    case "dm":
      await bluesky.sendDM(action.did, action.text);
      return `DM to [${action.did}](${didToWebUrl(action.did)}): "${action.text}"`;
    case "follow":
      await bluesky.follow(action.did);
      return `Followed [${action.did}](${didToWebUrl(action.did)})`;
    case "unfollow": {
      await bluesky.unfollow(action.followUri);
      const did = extractDid(action.followUri);
      return `Unfollowed [${did}](${didToWebUrl(did)})`;
    }
    case "like":
      await bluesky.like(action.uri, action.cid);
      return `Liked [post](${atUriToWebUrl(action.uri)})`;
    case "repost":
      await bluesky.repost(action.uri, action.cid);
      return `Reposted [post](${atUriToWebUrl(action.uri)})`;
  }
}

export async function communicate(): Promise<void> {
  console.log("[communicate] Starting...");

  const [systemPrompt, mindset, ownProfile] = await Promise.all([
    readPromptFile("communicate.md"),
    readAgentFile("mindset.md"),
    bluesky.getProfile(CONFIG.bluesky.handle),
  ]);

  const followingSuggestion =
    (ownProfile.followsCount ?? 0) < CONFIG.targetFollowCount
      ? `\n\n> **Note:** You are currently following ${ownProfile.followsCount ?? 0} accounts (target: ${CONFIG.targetFollowCount}). Consider finding someone interesting on your timeline to follow this cycle.`
      : "";

  const userContent = "## Current Mindset\n\n" + mindset + followingSuggestion +
    '\n\n---\n\nProduce your response in two clearly labeled sections:\n\n## Updated Mindset\n(your mindset after deciding what to communicate)\n\n## Actions\n(your chosen actions as JSON, or "No actions — choosing silence.")';

  const response = await callSkill(systemPrompt, userContent, {
    model: CONFIG.anthropic.modelDeep,
  });

  // Parse and execute actions
  const actions = parseActions(response);
  const actionLog: string[] = [];

  for (const action of actions) {
    try {
      const result = await executeAction(action);
      actionLog.push(result);
    } catch (err) {
      const body = JSON.stringify(action);
      const desc = `Failed to ${action.action}${actionTarget(action)}: ${err}\n  \`\`\`json\n  ${body}\n  \`\`\``;
      console.error(`  [communicate] Failed to ${action.action}: ${err}`);
      actionLog.push(desc);
    }
  }

  if (actions.length === 0) {
    actionLog.push("Chose silence — no actions taken.");
  }

  // Log actions to journal
  const logEntry = `\n\n### Communication Log — ${new Date().toISOString()}\n${CONFIG.dryRun ? "*(dry run)*\n" : ""}${actionLog.map((a) => "- " + a).join("\n")}`;
  await appendToJournal(logEntry);

  // Update mindset
  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Actions|$)/,
  );
  if (mindsetMatch) {
    await writeAgentFile("mindset.md", mindsetMatch[1].trim());
    console.log("[communicate] Updated mindset.md");
  }

  console.log(`[communicate] ${actions.length} actions processed`);
}
