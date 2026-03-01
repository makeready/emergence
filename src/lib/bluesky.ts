import { BskyAgent, RichText } from "@atproto/api";
import { CONFIG } from "../config.js";
import type {
  BlueskyPost,
  BlueskyImage,
  BlueskyThread,
  BlueskyDM,
  BlueskyNotification,
  BlueskyProfile,
} from "../types.js";

const CHAT_PROXY_HEADER = {
  headers: { "atproto-proxy": "did:web:api.bsky.chat#bsky_chat" },
};

let agent: BskyAgent | null = null;
let loginPromise: Promise<BskyAgent> | null = null;

export async function login(): Promise<BskyAgent> {
  if (agent) return agent;
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const bsky = new BskyAgent({ service: CONFIG.bluesky.service });
    await bsky.login({
      identifier: CONFIG.bluesky.handle,
      password: CONFIG.bluesky.appPassword,
    });
    console.log(`  [bluesky] Logged in as ${CONFIG.bluesky.handle}`);
    agent = bsky;
    return bsky;
  })();

  return loginPromise;
}

// ---------------------------------------------------------------------------
// Reading — timeline, threads, search, profiles, social graph
// ---------------------------------------------------------------------------

export async function getTimeline(
  limit = CONFIG.timelineLimit,
  pages = CONFIG.timelinePages,
): Promise<BlueskyPost[]> {
  const bsky = await login();
  const posts: BlueskyPost[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < pages; page++) {
    const response = await bsky.getTimeline({ limit, cursor });
    posts.push(...response.data.feed.map((item) => mapPost(item.post)));
    cursor = response.data.cursor;
    if (!cursor) break;
  }

  return posts;
}

export async function getPostThread(uri: string): Promise<BlueskyThread | null> {
  const bsky = await login();
  try {
    const response = await bsky.getPostThread({ uri, depth: 6, parentHeight: 10 });
    return mapThread(response.data.thread);
  } catch (err) {
    console.log(`  [bluesky] Failed to fetch thread ${uri}: ${err}`);
    return null;
  }
}

export async function searchPosts(
  query: string,
  limit = 25,
): Promise<BlueskyPost[]> {
  const bsky = await login();
  const response = await bsky.app.bsky.feed.searchPosts({ q: query, limit });
  return response.data.posts.map(mapPost);
}

export async function getAuthorFeed(
  actor: string,
  limit = 25,
): Promise<BlueskyPost[]> {
  const bsky = await login();
  const response = await bsky.getAuthorFeed({ actor, limit });
  return response.data.feed.map((item) => mapPost(item.post));
}

export async function getProfile(actor: string): Promise<BlueskyProfile> {
  const bsky = await login();
  const response = await bsky.getProfile({ actor });
  return mapProfile(response.data);
}

export async function getProfiles(actors: string[]): Promise<BlueskyProfile[]> {
  const bsky = await login();
  const response = await bsky.getProfiles({ actors });
  return response.data.profiles.map(mapProfile);
}

export async function getFollows(
  actor: string,
  limit = 50,
): Promise<BlueskyProfile[]> {
  const bsky = await login();
  const response = await bsky.getFollows({ actor, limit });
  return response.data.follows.map(mapProfile);
}

export async function getFollowers(
  actor: string,
  limit = 50,
): Promise<BlueskyProfile[]> {
  const bsky = await login();
  const response = await bsky.getFollowers({ actor, limit });
  return response.data.followers.map(mapProfile);
}

export async function getNotifications(): Promise<BlueskyNotification[]> {
  const bsky = await login();
  const response = await bsky.listNotifications({ limit: 50 });

  return response.data.notifications.map((n) => ({
    uri: n.uri,
    cid: n.cid,
    author: {
      handle: n.author.handle,
      displayName: n.author.displayName,
      did: n.author.did,
    },
    reason: n.reason,
    text: (n.record as { text?: string }).text,
    createdAt: n.indexedAt,
  }));
}

// ---------------------------------------------------------------------------
// Reading — DMs
// ---------------------------------------------------------------------------

export async function getDMs(): Promise<BlueskyDM[]> {
  const bsky = await login();
  try {
    const response = await bsky.api.call(
      "chat.bsky.convo.listConvos",
      {},
      undefined,
      CHAT_PROXY_HEADER,
    );

    const dms: BlueskyDM[] = [];
    for (const convo of response.data.convos || []) {
      if (
        convo.lastMessage &&
        convo.lastMessage.$type === "chat.bsky.convo.defs#messageView"
      ) {
        dms.push({
          id: convo.lastMessage.id || "",
          conversationId: convo.id,
          sender: {
            handle: convo.lastMessage.sender?.handle || "unknown",
            did: convo.lastMessage.sender?.did || "",
          },
          text: convo.lastMessage.text || "",
          sentAt: convo.lastMessage.sentAt || "",
        });
      }
    }
    return dms;
  } catch (err) {
    console.log(`  [bluesky] DM fetch failed: ${err}`);
    return [];
  }
}

export async function getMessages(
  conversationId: string,
  limit = 50,
): Promise<BlueskyDM[]> {
  const bsky = await login();
  try {
    const response = await bsky.api.call(
      "chat.bsky.convo.getMessages",
      { convoId: conversationId, limit },
      undefined,
      CHAT_PROXY_HEADER,
    );

    return (response.data.messages || [])
      .filter(
        (m: { $type?: string }) =>
          m.$type === "chat.bsky.convo.defs#messageView",
      )
      .map((m: { id?: string; sender?: { handle?: string; did?: string }; text?: string; sentAt?: string }) => ({
        id: m.id || "",
        conversationId,
        sender: {
          handle: m.sender?.handle || "unknown",
          did: m.sender?.did || "",
        },
        text: m.text || "",
        sentAt: m.sentAt || "",
      }));
  } catch (err) {
    console.log(`  [bluesky] Failed to fetch messages for ${conversationId}: ${err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Writing — posts, replies, likes, reposts
// ---------------------------------------------------------------------------

export async function post(
  text: string,
): Promise<{ uri: string; cid: string }> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would post: "${text.slice(0, 80)}..."`);
    return { uri: "dry-run", cid: "dry-run" };
  }

  const bsky = await login();
  const rt = new RichText({ text });
  await rt.detectFacets(bsky);

  const response = await bsky.post({ text: rt.text, facets: rt.facets });
  console.log(`  [bluesky] Posted: ${response.uri}`);
  return response;
}

export async function reply(
  text: string,
  parentUri: string,
  parentCid: string,
  rootUri: string,
  rootCid: string,
): Promise<{ uri: string; cid: string }> {
  if (CONFIG.dryRun) {
    console.log(
      `  [bluesky] DRY RUN — would reply to ${parentUri}: "${text.slice(0, 80)}..."`,
    );
    return { uri: "dry-run", cid: "dry-run" };
  }

  const bsky = await login();
  const rt = new RichText({ text });
  await rt.detectFacets(bsky);

  const response = await bsky.post({
    text: rt.text,
    facets: rt.facets,
    reply: {
      parent: { uri: parentUri, cid: parentCid },
      root: { uri: rootUri, cid: rootCid },
    },
  });
  console.log(`  [bluesky] Replied: ${response.uri}`);
  return response;
}

export async function deletePost(uri: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would delete post: ${uri}`);
    return;
  }

  const bsky = await login();
  await bsky.deletePost(uri);
  console.log(`  [bluesky] Deleted post: ${uri}`);
}

export async function like(
  uri: string,
  cid: string,
): Promise<{ uri: string }> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would like: ${uri}`);
    return { uri: "dry-run" };
  }

  const bsky = await login();
  const response = await bsky.like(uri, cid);
  console.log(`  [bluesky] Liked: ${uri}`);
  return response;
}

export async function deleteLike(likeUri: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would unlike: ${likeUri}`);
    return;
  }

  const bsky = await login();
  await bsky.deleteLike(likeUri);
  console.log(`  [bluesky] Unliked: ${likeUri}`);
}

export async function repost(
  uri: string,
  cid: string,
): Promise<{ uri: string }> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would repost: ${uri}`);
    return { uri: "dry-run" };
  }

  const bsky = await login();
  const response = await bsky.repost(uri, cid);
  console.log(`  [bluesky] Reposted: ${uri}`);
  return response;
}

export async function deleteRepost(repostUri: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would unrepost: ${repostUri}`);
    return;
  }

  const bsky = await login();
  await bsky.deleteRepost(repostUri);
  console.log(`  [bluesky] Unreposted: ${repostUri}`);
}

// ---------------------------------------------------------------------------
// Writing — DMs
// ---------------------------------------------------------------------------

export async function sendDM(did: string, text: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(
      `  [bluesky] DRY RUN — would DM ${did}: "${text.slice(0, 80)}..."`,
    );
    return;
  }

  const bsky = await login();

  const convoResponse = await bsky.api.call(
    "chat.bsky.convo.getConvoForMembers",
    { members: [did] },
    undefined,
    CHAT_PROXY_HEADER,
  );

  await bsky.api.call(
    "chat.bsky.convo.sendMessage",
    {},
    { convoId: convoResponse.data.convo.id, message: { text } },
    CHAT_PROXY_HEADER,
  );
  console.log(`  [bluesky] DM sent to ${did}`);
}

// ---------------------------------------------------------------------------
// Writing — social graph
// ---------------------------------------------------------------------------

export async function follow(did: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would follow ${did}`);
    return;
  }

  const bsky = await login();
  await bsky.follow(did);
  console.log(`  [bluesky] Followed ${did}`);
}

export async function unfollow(followUri: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would unfollow ${followUri}`);
    return;
  }

  const bsky = await login();
  await bsky.deleteFollow(followUri);
  console.log(`  [bluesky] Unfollowed ${followUri}`);
}

// ---------------------------------------------------------------------------
// Writing — profile
// ---------------------------------------------------------------------------

export async function updateProfile(fields: {
  description?: string;
  displayName?: string;
}): Promise<void> {
  if (CONFIG.dryRun) {
    const changes = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: "${String(v).slice(0, 60)}"`)
      .join(", ");
    console.log(`  [bluesky] DRY RUN — would update profile: ${changes}`);
    return;
  }

  const bsky = await login();
  await bsky.upsertProfile((existing) => ({
    ...existing,
    ...(fields.description !== undefined && { description: fields.description }),
    ...(fields.displayName !== undefined && { displayName: fields.displayName }),
  }));
  console.log(`  [bluesky] Updated profile`);
}

export async function updateAvatar(
  imageData: Uint8Array,
  mimeType: "image/png" | "image/jpeg",
): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would update avatar (${imageData.length} bytes, ${mimeType})`);
    return;
  }

  const bsky = await login();
  const blob = await bsky.uploadBlob(imageData, { encoding: mimeType });
  await bsky.upsertProfile((existing) => ({
    ...existing,
    avatar: blob.data.blob,
  }));
  console.log(`  [bluesky] Updated avatar`);
}

export async function updateHandle(handle: string): Promise<void> {
  if (CONFIG.dryRun) {
    console.log(`  [bluesky] DRY RUN — would update handle to: ${handle}`);
    return;
  }

  const bsky = await login();
  await bsky.com.atproto.identity.updateHandle({ handle });
  console.log(`  [bluesky] Updated handle to ${handle}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapPost(post: {
  uri: string;
  cid: string;
  author: { handle: string; displayName?: string; did: string };
  record: unknown;
  embed?: unknown;
  indexedAt: string;
  replyCount?: number;
  likeCount?: number;
  repostCount?: number;
}): BlueskyPost {
  return {
    uri: post.uri,
    cid: post.cid,
    author: {
      handle: post.author.handle,
      displayName: post.author.displayName,
      did: post.author.did,
    },
    text: (post.record as { text?: string }).text || "",
    createdAt: post.indexedAt,
    replyCount: post.replyCount,
    likeCount: post.likeCount,
    repostCount: post.repostCount,
    images: extractImages(post.embed),
    videoAlt: extractVideoAlt(post.embed),
  };
}

function extractImages(embed: unknown): BlueskyImage[] | undefined {
  if (!embed || typeof embed !== "object") return undefined;

  const e = embed as { $type?: string; images?: Array<{ thumb: string; fullsize: string; alt: string }>; media?: unknown };

  // Direct image embed: app.bsky.embed.images#view
  if (e.$type === "app.bsky.embed.images#view" && Array.isArray(e.images)) {
    return e.images.map((img) => ({
      thumb: img.thumb,
      fullsize: img.fullsize,
      alt: img.alt || "",
    }));
  }

  // Record with media: app.bsky.embed.recordWithMedia#view
  if (e.$type === "app.bsky.embed.recordWithMedia#view" && e.media) {
    return extractImages(e.media);
  }

  return undefined;
}

function extractVideoAlt(embed: unknown): string | undefined {
  if (!embed || typeof embed !== "object") return undefined;

  const e = embed as { $type?: string; alt?: string; media?: unknown };

  // Direct video embed: app.bsky.embed.video#view
  if (e.$type === "app.bsky.embed.video#view" && e.alt) {
    return e.alt;
  }

  // Record with media wrapping a video
  if (e.$type === "app.bsky.embed.recordWithMedia#view" && e.media) {
    return extractVideoAlt(e.media);
  }

  return undefined;
}

function mapProfile(profile: {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  indexedAt?: string;
}): BlueskyProfile {
  return {
    did: profile.did,
    handle: profile.handle,
    displayName: profile.displayName,
    description: profile.description,
    avatar: profile.avatar,
    followersCount: profile.followersCount,
    followsCount: profile.followsCount,
    postsCount: profile.postsCount,
    indexedAt: profile.indexedAt,
  };
}

function mapThread(thread: unknown): BlueskyThread | null {
  const t = thread as {
    $type?: string;
    post?: {
      uri: string;
      cid: string;
      author: { handle: string; displayName?: string; did: string };
      record: unknown;
      indexedAt: string;
      replyCount?: number;
      likeCount?: number;
      repostCount?: number;
    };
    parent?: unknown;
    replies?: unknown[];
  };

  if (!t.post) return null;

  return {
    post: mapPost(t.post),
    parent: t.parent ? mapThread(t.parent) ?? undefined : undefined,
    replies: t.replies
      ?.map((r) => mapThread(r))
      .filter((r): r is BlueskyThread => r !== null),
  };
}
