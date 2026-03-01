import { readAgentFile, writeAgentFile, truncateFile } from "../lib/files.js";
import { CONFIG } from "../config.js";

export async function sleep(): Promise<void> {
  console.log("[sleep] Starting...");

  // Archive mindset into short-term memory
  const mindset = await readAgentFile("mindset.md");
  const shortTermMemory = await readAgentFile("short_term_memory.md");

  const timestamp = new Date().toISOString();
  const archived = `\n\n### Cycle Mindset — ${timestamp}\n\n${mindset}`;
  await writeAgentFile("short_term_memory.md", shortTermMemory + archived);
  console.log("[sleep] Archived mindset to short_term_memory.md");

  // Truncate short-term memory
  await truncateFile(
    "short_term_memory.md",
    CONFIG.maxShortTermMemoryLines,
  );
  console.log("[sleep] Truncated short_term_memory.md");

  // Clear raw notes
  await writeAgentFile("raw_notes.md", "# Raw Notes\n");
  console.log("[sleep] Cleared raw_notes.md");

  // Reset mindset
  await writeAgentFile("mindset.md", "# Mindset\n\n*Awaiting next wake_up cycle.*\n");
  console.log("[sleep] Reset mindset.md");
}
