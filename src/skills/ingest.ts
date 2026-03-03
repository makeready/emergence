import { readAgentFile, writeAgentFile, readPromptFile, getLastCycleTime } from "../lib/files.js";
import { callSkill, type ContentBlock } from "../lib/anthropic.js";
import { getTimeline, getDMs, getNotifications, getProfile, getPosts, markConvoRead, getAuthorFeed } from "../lib/bluesky.js";
import { CONFIG } from "../config.js";
import type { BlueskyPost, BlueskyDM, BlueskyNotification, BlueskyProfile } from "../types.js";

function formatProfile(p: BlueskyProfile): string {
  return [
    `**@${p.handle}**${p.displayName ? ` (${p.displayName})` : ""}`,
    p.description ? `Bio: ${p.description}` : "Bio: _(none)_",
    `Followers: ${p.followersCount ?? 0} | Following: ${p.followsCount ?? 0} | Posts: ${p.postsCount ?? 0}`,
  ].join("\n");
}

function formatPost(p: BlueskyPost): string {
  const imageNote =
    p.images && p.images.length > 0
      ? `\n[${p.images.length} image(s)${p.images.some((i) => i.alt) ? ": " + p.images.map((i) => i.alt).filter(Boolean).join("; ") : ""}]`
      : "";
  const videoNote = p.videoAlt ? `\n[video: ${p.videoAlt}]` : "";
  const staleTag = isStale(p.createdAt) ? " ⚠️ **STALE**" : "";
  return `**@${p.author.handle}** (${p.author.displayName || ""}) [${p.author.did}]${staleTag}\n${p.text}${imageNote}${videoNote}\n_${p.createdAt}_ | replies: ${p.replyCount ?? 0} | likes: ${p.likeCount ?? 0}\nuri: ${p.uri} cid: ${p.cid}`;
}

function formatPosts(posts: BlueskyPost[]): string {
  return posts.map(formatPost).join("\n\n---\n\n");
}

function formatOwnReplies(posts: BlueskyPost[]): string {
  const replies = posts.filter((p) => p.replyTo);
  if (replies.length === 0) return "_No recent replies._";
  return replies
    .map((p) => `- Replied to: ${p.replyTo}\n  Your reply (${p.uri}): "${p.text.slice(0, 120)}"`)
    .join("\n");
}

function formatDMs(dms: BlueskyDM[]): string {
  if (dms.length === 0) return "_No new DMs._";
  return dms
    .map((d) => {
      const unreadBadge = d.unread ? " 🔴 **UNREAD**" : "";
      return `**@${d.sender.handle}** (${d.sender.did})${unreadBadge}:\n${d.text}\n_${d.sentAt}_`;
    })
    .join("\n\n---\n\n");
}

const STALE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

function isStale(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() > STALE_MS;
}

function formatNotifications(notifs: BlueskyNotification[], subjectPosts: Map<string, BlueskyPost>): string {
  if (notifs.length === 0) return "_No new notifications._";
  return notifs
    .map((n) => {
      const subject = n.subjectUri ? subjectPosts.get(n.subjectUri) : undefined;
      const subjectLine = subject ? `\n↳ Your post: "${subject.text}"` : "";
      const replyLine = n.text ? `\n↳ Reply: "${n.text}"` : "";
      const staleTag = isStale(n.createdAt) ? " ⚠️ **STALE — too old to respond to**" : "";

      if (n.reason === "reply") {
        return `**reply** from @${n.author.handle} [${n.author.did}]${staleTag}${subject ? `\n↳ To your post: "${subject.text}"` : ""}${n.text ? `\n↳ Reply: "${n.text}"` : ""}\n_${n.createdAt}_\nuri: ${n.uri} cid: ${n.cid}`;
      }
      if (n.reason === "like" || n.reason === "repost") {
        return `**${n.reason}** from @${n.author.handle} [${n.author.did}]${staleTag}${subjectLine}\n_${n.createdAt}_`;
      }
      return `**${n.reason}** from @${n.author.handle} [${n.author.did}]${staleTag}${replyLine}\n_${n.createdAt}_\nuri: ${n.uri} cid: ${n.cid}`;
    })
    .join("\n\n---\n\n");
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const ALLOWED_MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Fetch an image URL and return it as a base64 content block. Returns null on failure. */
async function fetchImageAsBase64(url: string): Promise<ContentBlock | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const data = Buffer.from(buf).toString("base64");
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const mediaType: ImageMediaType = ALLOWED_MEDIA_TYPES.find((t) => ct.includes(t)) ?? "image/jpeg";
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  } catch {
    return null;
  }
}

/** Build multimodal content blocks: text sections interleaved with thumbnail images. */
async function buildContentBlocks(
  textContent: string,
  posts: BlueskyPost[],
  avatarUrl?: string,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [{ type: "text", text: textContent }];

  const postsWithImages = posts.filter((p) => p.images && p.images.length > 0);

  // Collect all image URLs to fetch in parallel
  const urlsToFetch: string[] = [];
  if (avatarUrl) urlsToFetch.push(avatarUrl);
  for (const post of postsWithImages) {
    for (const img of post.images!) {
      urlsToFetch.push(img.thumb);
    }
  }

  // Fetch all images in parallel
  const fetched = await Promise.all(urlsToFetch.map(fetchImageAsBase64));
  let idx = 0;

  // Include own avatar if available
  if (avatarUrl) {
    const avatarBlock = fetched[idx++];
    if (avatarBlock) {
      blocks.push(
        { type: "text", text: "\n\n## Your Profile Picture\n\nThis is your current avatar:" },
        avatarBlock,
      );
    }
  }

  if (postsWithImages.length === 0) return blocks;

  blocks.push({
    type: "text",
    text: `\n\n## Post Images\n\nThe following images are attached to posts in the timeline above. Each is labeled with the post author and URI.\n\nIf any image contains text that you cannot read at this size, note the post URI in your response under a section called "## Unreadable Image Text" so higher-resolution versions can be fetched.`,
  });

  for (const post of postsWithImages) {
    for (const img of post.images!) {
      const imgBlock = fetched[idx++];
      blocks.push({
        type: "text",
        text: `\nImage from @${post.author.handle} (${post.uri}):${img.alt ? ` alt="${img.alt}"` : ""}`,
      });
      if (imgBlock) {
        blocks.push(imgBlock);
      }
    }
  }

  return blocks;
}

/** Second pass: re-fetch specific images at full size for posts Claude flagged as unreadable. */
async function buildFullsizeBlocks(
  flaggedUris: string[],
  posts: BlueskyPost[],
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: "You previously noted that the following images contained text you couldn't read at thumbnail size. Here they are at full resolution. Please provide any additional notes about what you can now read.",
    },
  ];

  // Collect all full-size URLs to fetch in parallel
  const jobs: { post: BlueskyPost; fullsize: string }[] = [];
  for (const uri of flaggedUris) {
    const post = posts.find((p) => p.uri === uri);
    if (!post?.images) continue;
    for (const img of post.images) {
      jobs.push({ post, fullsize: img.fullsize });
    }
  }

  const fetched = await Promise.all(jobs.map((j) => fetchImageAsBase64(j.fullsize)));

  for (let i = 0; i < jobs.length; i++) {
    const { post } = jobs[i];
    const imgBlock = fetched[i];
    blocks.push({
      type: "text",
      text: `\nFull-size image from @${post.author.handle} (${post.uri}):`,
    });
    if (imgBlock) {
      blocks.push(imgBlock);
    }
  }

  return blocks;
}

/** Extract post URIs from the "## Unreadable Image Text" section. */
function parseUnreadableUris(response: string): string[] {
  const section = response.match(
    /## Unreadable Image Text\n([\s\S]*?)(?=\n## |$)/,
  );
  if (!section) return [];

  const uriPattern = /at:\/\/[^\s)]+/g;
  return [...new Set(section[1].match(uriPattern) || [])];
}

export async function ingest(): Promise<void> {
  console.log("[ingest] Starting...");

  const [systemPrompt, mindset, agentReadme, lastCycleTime] = await Promise.all([
    readPromptFile("ingest.md"),
    readAgentFile("mindset.md"),
    readAgentFile("README.md"),
    getLastCycleTime(),
  ]);

  // Fetch social data + own profile
  console.log("[ingest] Fetching timeline, notifications, DMs, own profile, and own recent posts...");
  const [timeline, notifications, dms, ownProfile, ownRecentPosts] = await Promise.all([
    getTimeline(),
    getNotifications(),
    getDMs(),
    getProfile(CONFIG.bluesky.handle),
    getAuthorFeed(CONFIG.bluesky.handle, 50),
  ]);

  const imageCount = timeline.reduce(
    (n, p) => n + (p.images?.length ?? 0),
    0,
  );
  const unreadDmCount = dms.filter((d) => d.unread).length;
  console.log(
    `[ingest] Got ${timeline.length} posts (${imageCount} images), ${notifications.length} notifications, ${dms.length} DMs (${unreadDmCount} unread)`,
  );

  // Mark all conversations as read now that we've ingested them
  if (dms.length > 0) {
    await Promise.all(dms.map((d) => markConvoRead(d.conversationId)));
  }

  // Fetch the agent's own posts that were liked/reposted/replied to
  const subjectUris = [...new Set(
    notifications.map((n) => n.subjectUri).filter((u): u is string => !!u),
  )];
  const subjectPostsList = await getPosts(subjectUris);
  const subjectPosts = new Map(subjectPostsList.map((p) => [p.uri, p]));
  if (subjectUris.length > 0) {
    console.log(`[ingest] Fetched ${subjectPostsList.length} subject posts for notification context`);
  }

  // Collect all unique DIDs seen this cycle for people file lookup
  const ingestDids = [
    ...new Set([
      ...timeline.map((p) => p.author.did),
      ...notifications.map((n) => n.author.did),
      ...dms.map((d) => d.sender.did),
    ]),
  ];
  await writeAgentFile("ingest_dids.json", JSON.stringify(ingestDids));

  const textParts: string[] = [];
  if (agentReadme) textParts.push(agentReadme);
  const textContent = [...textParts,
    "## Current Mindset\n\n" + mindset,
    "## Your Profile\n\n" + formatProfile(ownProfile),
    "## Your Recent Replies\n\nThese are posts you have already replied to. Do NOT suggest replying to them again.\n\n" + formatOwnReplies(ownRecentPosts),
    "## Timeline\n\n" + formatPosts(timeline),
    "## Notifications\n\n" + formatNotifications(notifications, subjectPosts),
    "## Direct Messages\n\n" + formatDMs(dms),
    '\n\n---\n\nProduce your response in two clearly labeled sections:\n\n## Updated Mindset\n(your updated mindset)\n\n## Raw Notes\n(your detailed notes)\n\nIf any images contain text you cannot read at this size, add a third section:\n\n## Unreadable Image Text\n(list the post URIs with unreadable text)',
  ].join("\n\n---\n\n");

  // Only fetch images for posts that arrived since the last cycle
  const newPosts = lastCycleTime
    ? timeline.filter((p) => new Date(p.createdAt).getTime() > lastCycleTime)
    : timeline;
  const newImageCount = newPosts.reduce((n, p) => n + (p.images?.length ?? 0), 0);
  const skippedImages = imageCount - newImageCount;
  if (skippedImages > 0) {
    console.log(`[ingest] Skipping ${skippedImages} images from already-seen posts`);
  }

  // First pass: thumbnails (fetched as base64 for reliable delivery to the model)
  const hasImages = newImageCount > 0 || ownProfile.avatar;
  const content = hasImages
    ? await buildContentBlocks(textContent, newPosts, ownProfile.avatar)
    : textContent;

  let response = await callSkill(systemPrompt, content);

  // Second pass: full-size images if Claude flagged any as unreadable
  const flaggedUris = parseUnreadableUris(response);
  if (flaggedUris.length > 0) {
    console.log(
      `[ingest] Re-fetching ${flaggedUris.length} images at full size...`,
    );
    const fullsizeBlocks = await buildFullsizeBlocks(flaggedUris, newPosts);
    const extraNotes = await callSkill(
      "You are reviewing images at higher resolution. Add any new observations to your notes.",
      fullsizeBlocks,
    );
    // Append the extra notes to the raw notes section
    response = response.replace(
      /## Unreadable Image Text[\s\S]*$/,
      "",
    );
    response += "\n\n## Additional Image Notes\n\n" + extraNotes;
  }

  // Parse response into mindset and raw_notes sections
  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Raw Notes|$)/,
  );
  const notesMatch = response.match(
    /## Raw Notes\n([\s\S]*?)(?=## Unreadable Image Text|## Additional Image Notes|$)/,
  );
  const extraNotesMatch = response.match(
    /## Additional Image Notes\n([\s\S]*?)$/,
  );

  await writeAgentFile("mindset.md", mindsetMatch ? mindsetMatch[1].trim() : response);

  let rawNotes = notesMatch ? notesMatch[1].trim() : "";
  if (extraNotesMatch) {
    rawNotes += "\n\n---\n\n## Additional Image Notes\n\n" + extraNotesMatch[1].trim();
  }
  if (rawNotes) {
    await writeAgentFile("raw_notes.md", rawNotes);
    console.log("[ingest] Wrote raw_notes.md");
  }
}
