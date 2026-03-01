import { readAgentFile, writeAgentFile, readPromptFile } from "../lib/files.js";
import { callSkill, type ContentBlock } from "../lib/anthropic.js";
import { getTimeline, getDMs, getNotifications } from "../lib/bluesky.js";
import type { BlueskyPost, BlueskyDM, BlueskyNotification } from "../types.js";

function formatPost(p: BlueskyPost): string {
  const imageNote =
    p.images && p.images.length > 0
      ? `\n[${p.images.length} image(s)${p.images.some((i) => i.alt) ? ": " + p.images.map((i) => i.alt).filter(Boolean).join("; ") : ""}]`
      : "";
  const videoNote = p.videoAlt ? `\n[video: ${p.videoAlt}]` : "";
  return `**@${p.author.handle}** (${p.author.displayName || ""})\n${p.text}${imageNote}${videoNote}\n_${p.createdAt}_ | replies: ${p.replyCount ?? 0} | likes: ${p.likeCount ?? 0}\nuri: ${p.uri} cid: ${p.cid}`;
}

function formatPosts(posts: BlueskyPost[]): string {
  return posts.map(formatPost).join("\n\n---\n\n");
}

function formatDMs(dms: BlueskyDM[]): string {
  if (dms.length === 0) return "_No new DMs._";
  return dms
    .map(
      (d) =>
        `**@${d.sender.handle}** (${d.sender.did}):\n${d.text}\n_${d.sentAt}_`,
    )
    .join("\n\n---\n\n");
}

function formatNotifications(notifs: BlueskyNotification[]): string {
  if (notifs.length === 0) return "_No new notifications._";
  return notifs
    .map(
      (n) =>
        `**${n.reason}** from @${n.author.handle}: ${n.text || "(no text)"}\n_${n.createdAt}_\nuri: ${n.uri} cid: ${n.cid}`,
    )
    .join("\n\n---\n\n");
}

/** Build multimodal content blocks: text sections interleaved with thumbnail images. */
function buildContentBlocks(
  textContent: string,
  posts: BlueskyPost[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: "text", text: textContent }];

  // Collect all posts with images, tagging each image with its post context
  const postsWithImages = posts.filter(
    (p) => p.images && p.images.length > 0,
  );
  if (postsWithImages.length === 0) return blocks;

  blocks.push({
    type: "text",
    text: `\n\n## Post Images\n\nThe following images are attached to posts in the timeline above. Each is labeled with the post author and URI.\n\nIf any image contains text that you cannot read at this size, note the post URI in your response under a section called "## Unreadable Image Text" so higher-resolution versions can be fetched.`,
  });

  for (const post of postsWithImages) {
    for (const img of post.images!) {
      blocks.push({
        type: "text",
        text: `\nImage from @${post.author.handle} (${post.uri}):${img.alt ? ` alt="${img.alt}"` : ""}`,
      });
      blocks.push({
        type: "image",
        source: { type: "url", url: img.thumb },
      });
    }
  }

  return blocks;
}

/** Second pass: re-fetch specific images at full size for posts Claude flagged as unreadable. */
function buildFullsizeBlocks(
  flaggedUris: string[],
  posts: BlueskyPost[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: "You previously noted that the following images contained text you couldn't read at thumbnail size. Here they are at full resolution. Please provide any additional notes about what you can now read.",
    },
  ];

  for (const uri of flaggedUris) {
    const post = posts.find((p) => p.uri === uri);
    if (!post?.images) continue;

    for (const img of post.images) {
      blocks.push({
        type: "text",
        text: `\nFull-size image from @${post.author.handle} (${post.uri}):`,
      });
      blocks.push({
        type: "image",
        source: { type: "url", url: img.fullsize },
      });
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

  const [systemPrompt, mindset] = await Promise.all([
    readPromptFile("ingest.md"),
    readAgentFile("mindset.md"),
  ]);

  // Fetch social data
  console.log("[ingest] Fetching timeline, notifications, and DMs...");
  const [timeline, notifications, dms] = await Promise.all([
    getTimeline(),
    getNotifications(),
    getDMs(),
  ]);

  const imageCount = timeline.reduce(
    (n, p) => n + (p.images?.length ?? 0),
    0,
  );
  console.log(
    `[ingest] Got ${timeline.length} posts (${imageCount} images), ${notifications.length} notifications, ${dms.length} DMs`,
  );

  const textContent = [
    "## Current Mindset\n\n" + mindset,
    "## Timeline\n\n" + formatPosts(timeline),
    "## Notifications\n\n" + formatNotifications(notifications),
    "## Direct Messages\n\n" + formatDMs(dms),
    '\n\n---\n\nProduce your response in two clearly labeled sections:\n\n## Updated Mindset\n(your updated mindset)\n\n## Raw Notes\n(your detailed notes)\n\nIf any images contain text you cannot read at this size, add a third section:\n\n## Unreadable Image Text\n(list the post URIs with unreadable text)',
  ].join("\n\n---\n\n");

  // First pass: thumbnails
  const content =
    imageCount > 0
      ? buildContentBlocks(textContent, timeline)
      : textContent;

  let response = await callSkill(systemPrompt, content);

  // Second pass: full-size images if Claude flagged any as unreadable
  const flaggedUris = parseUnreadableUris(response);
  if (flaggedUris.length > 0) {
    console.log(
      `[ingest] Re-fetching ${flaggedUris.length} images at full size...`,
    );
    const fullsizeBlocks = buildFullsizeBlocks(flaggedUris, timeline);
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

  if (mindsetMatch) {
    await writeAgentFile("mindset.md", mindsetMatch[1].trim());
    console.log("[ingest] Updated mindset.md");
  }

  let rawNotes = notesMatch ? notesMatch[1].trim() : "";
  if (extraNotesMatch) {
    rawNotes += "\n\n---\n\n## Additional Image Notes\n\n" + extraNotesMatch[1].trim();
  }
  if (rawNotes) {
    await writeAgentFile("raw_notes.md", rawNotes);
    console.log("[ingest] Wrote raw_notes.md");
  }
}
