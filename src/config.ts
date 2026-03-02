import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export const CONFIG = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    /** Default model for lightweight skills (wake_up, ingest, communicate, sleep) */
    model: process.env.MODEL || "claude-sonnet-4-20250514",
    /** Deeper model for reflective skills (ruminate, iterate) */
    modelDeep: process.env.MODEL_DEEP || "claude-opus-4-20250514",
  },
  bluesky: {
    handle: process.env.BLUESKY_HANDLE || "",
    appPassword: process.env.BLUESKY_APP_PASSWORD || "",
    service: "https://bsky.social",
  },
  paths: {
    root: ROOT,
    agent: resolve(ROOT, "agent"),
    prompts: resolve(ROOT, "prompts"),
  },
  dryRun: process.env.DRY_RUN !== "false",
  /** Enable web search and topics system during ruminate/iterate */
  webSearch: process.env.WEB_SEARCH === "true",
  /** If false (default), the agent may only reply to accounts that follow it */
  allowReplyToNonFollowers: process.env.ALLOW_REPLY_TO_NON_FOLLOWERS === "true",
  logLevel: process.env.LOG_LEVEL || "info",
  /** Target number of accounts to follow */
  targetFollowCount: parseInt(process.env.TARGET_FOLLOW_COUNT || "204", 10),
  /** Max lines to keep in short_term_memory.md before truncation */
  maxShortTermMemoryLines: 200,
  /** Max lines of journal to include in context */
  maxJournalContextLines: 100,
  /** Timeline posts to fetch per page */
  timelineLimit: 50,
  /** Number of timeline pages to fetch per cycle */
  timelinePages: 4,
} as const;

export function validateConfig(): void {
  if (!CONFIG.anthropic.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }
}
