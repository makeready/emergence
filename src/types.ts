export interface SkillResult {
  /** Updated mindset content, if the skill modifies it */
  mindset?: string;
  /** Files to write: key is filename (relative to agent/), value is content */
  fileWrites?: Record<string, string>;
  /** Files to append to: key is filename, value is content to append */
  fileAppends?: Record<string, string>;
  /** Actions for the communicate skill */
  actions?: CommunicateAction[];
  /** Changes proposed by the iterate skill */
  changes?: IterateChange[];
}

export type CommunicateAction =
  | { action: "post"; text: string }
  | { action: "reply"; postUri: string; postCid: string; rootUri?: string; rootCid?: string; text: string }
  | { action: "dm"; did: string; text: string }
  | { action: "follow"; did: string }
  | { action: "unfollow"; followUri: string }
  | { action: "like"; uri: string; cid: string }
  | { action: "repost"; uri: string; cid: string };

export type IterateChange =
  | { change: "identity"; section: string; proposal: string; reason: string }
  | { change: "prompt"; skill: string; proposal: string; reason: string }
  | { change: "profile"; bio?: string; displayName?: string; handle?: string; reason: string };

export interface SkillContext {
  /** The skill's system prompt (loaded from prompts/) */
  systemPrompt: string;
  /** Files to include in the user message */
  files: Record<string, string>;
  /** Extra content to include (e.g., timeline data) */
  extra?: string;
}

export interface BlueskyImage {
  thumb: string;
  fullsize: string;
  alt: string;
}

export interface BlueskyPost {
  uri: string;
  cid: string;
  author: { handle: string; displayName?: string; did: string };
  text: string;
  createdAt: string;
  replyCount?: number;
  likeCount?: number;
  repostCount?: number;
  images?: BlueskyImage[];
  /** Alt text from video embeds (video content itself is ignored) */
  videoAlt?: string;
}

export interface BlueskyThread {
  post: BlueskyPost;
  parent?: BlueskyThread;
  replies?: BlueskyThread[];
}

export interface BlueskyDM {
  id: string;
  conversationId: string;
  sender: { handle: string; did: string };
  text: string;
  sentAt: string;
}

export interface BlueskyNotification {
  uri: string;
  cid: string;
  author: { handle: string; displayName?: string; did: string };
  reason: string; // 'reply' | 'mention' | 'follow' | 'like' | 'repost'
  text?: string;
  createdAt: string;
}

export interface BlueskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  indexedAt?: string;
}
