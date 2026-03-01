import { readAgentFile, writeAgentFile, readPromptFile } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import { CONFIG } from "../config.js";

export async function wakeUp(): Promise<void> {
  console.log("[wake-up] Starting...");

  const [systemPrompt, identity, shortTermMemory, journal] = await Promise.all([
    readPromptFile("wake-up.md"),
    readAgentFile("identity.md"),
    readAgentFile("short_term_memory.md"),
    readAgentFile("journal.md"),
  ]);

  // Build context for Claude
  const parts: string[] = [
    "## identity.md\n\n" + identity,
    "## short_term_memory.md\n\n" + shortTermMemory,
  ];

  // Include recent journal if short-term memory has unresolved questions
  // or if there's journal content worth referencing
  const journalLines = journal.split("\n");
  if (journalLines.length > 2) {
    const recentJournal = journalLines
      .slice(-CONFIG.maxJournalContextLines)
      .join("\n");
    parts.push("## journal.md (recent entries)\n\n" + recentJournal);
  }

  const userContent = parts.join("\n\n---\n\n");

  const mindset = await callSkill(systemPrompt, userContent);

  await writeAgentFile("mindset.md", mindset);
  console.log("[wake-up] Wrote mindset.md");
}
