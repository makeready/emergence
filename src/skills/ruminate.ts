import {
  readAgentFile,
  writeAgentFile,
  appendToJournal,
  readRecentJournal,
  readPromptFile,
} from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import { CONFIG } from "../config.js";

export async function ruminate(): Promise<void> {
  console.log("[ruminate] Starting...");

  const [systemPrompt, mindset, rawNotes, recentJournal] = await Promise.all([
    readPromptFile("ruminate.md"),
    readAgentFile("mindset.md"),
    readAgentFile("raw_notes.md"),
    readRecentJournal(CONFIG.maxJournalContextLines),
  ]);

  const userContent = [
    `**Current time: ${new Date().toISOString()}**`,
    "## Current Mindset\n\n" + mindset,
    "## Raw Notes\n\n" + rawNotes,
    "## Journal (recent entries)\n\n" + recentJournal,
    '\n\n---\n\nProduce your response in three clearly labeled sections:\n\n## Updated Mindset\n(your evolved mindset)\n\n## Journal Entry\n(a timestamped reflective entry)\n\n## Updated Short-Term Memory\n(observations and threads to carry forward)',
  ].join("\n\n---\n\n");

  const response = await callSkill(systemPrompt, userContent, {
    model: CONFIG.anthropic.modelDeep,
  });

  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Journal Entry|$)/,
  );
  const journalMatch = response.match(
    /## Journal Entry\n([\s\S]*?)(?=## Updated Short-Term Memory|$)/,
  );
  const memoryMatch = response.match(
    /## Updated Short-Term Memory\n([\s\S]*?)$/,
  );

  if (mindsetMatch) {
    await writeAgentFile("mindset.md", mindsetMatch[1].trim());
    console.log("[ruminate] Updated mindset.md");
  }
  if (journalMatch) {
    await appendToJournal("\n\n" + journalMatch[1].trim());
    console.log("[ruminate] Appended to journal");
  }
  if (memoryMatch) {
    const now = new Date().toISOString();
    const HAS_TS = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] /;

    const thoughts = memoryMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        // Model kept the [ISO timestamp] prefix → preserve it (thought unchanged or minor rewording).
        // Model dropped the prefix → significant change or new thought, assign fresh timestamp.
        if (HAS_TS.test(l)) return l;
        return `[${now}] ${l}`;
      });

    await writeAgentFile(
      "short_term_memory.md",
      `# Short-Term Memory\n\n${thoughts.join("\n")}\n`,
    );
    console.log("[ruminate] Updated short_term_memory.md");
  }
}
