import { readAgentFile, writeAgentFile, appendAgentFile, readPromptFile } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import type { IterateChange } from "../types.js";
import { CONFIG } from "../config.js";

function parseChanges(response: string): IterateChange[] {
  const changes: IterateChange[] = [];
  const jsonPattern = /```json\s*\n([\s\S]*?)```|(\{[^\n]*"change"[^\n]*\})/g;
  let match;

  while ((match = jsonPattern.exec(response)) !== null) {
    const jsonStr = match[1] || match[2];
    for (const line of jsonStr.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          changes.push(JSON.parse(trimmed));
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
  return changes;
}

export async function iterate(): Promise<void> {
  console.log("[iterate] Starting...");

  const [systemPrompt, mindset, identity, shortTermMemory] = await Promise.all([
    readPromptFile("iterate.md"),
    readAgentFile("mindset.md"),
    readAgentFile("identity.md"),
    readAgentFile("short_term_memory.md"),
  ]);

  const userContent = [
    "## Current Mindset\n\n" + mindset,
    "## Identity\n\n" + identity,
    "## Short-Term Memory\n\n" + shortTermMemory,
    '\n\n---\n\nProduce your response in two clearly labeled sections:\n\n## Updated Mindset\n(your reflections on your own evolution)\n\n## Proposed Changes\n(any changes as JSON, or "No changes proposed.")',
  ].join("\n\n---\n\n");

  const response = await callSkill(systemPrompt, userContent, {
    model: CONFIG.anthropic.modelDeep,
  });

  // Parse proposed changes
  const changes = parseChanges(response);
  const changeLog: string[] = [];

  for (const change of changes) {
    let desc: string;
    switch (change.change) {
      case "profile":
        desc = `Profile update: "${change.text}" — ${change.reason}`;
        break;
      case "identity":
        desc = `Identity change (${change.section}): ${change.reason}`;
        break;
      case "prompt":
        desc = `Prompt change (${change.skill}): ${change.reason}`;
        break;
    }
    changeLog.push(desc);
  }

  if (changes.length === 0) {
    changeLog.push("No changes proposed.");
  }

  // Log to journal
  const logEntry = `\n\n### Iteration Log — ${new Date().toISOString()}\n${CONFIG.dryRun ? "*(dry run — changes not applied)*\n" : ""}${changeLog.map((c) => "- " + c).join("\n")}`;
  await appendAgentFile("journal.md", logEntry);

  // Update mindset
  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Proposed Changes|$)/,
  );
  if (mindsetMatch) {
    await writeAgentFile("mindset.md", mindsetMatch[1].trim());
    console.log("[iterate] Updated mindset.md");
  }

  console.log(`[iterate] ${changes.length} changes proposed`);
}
