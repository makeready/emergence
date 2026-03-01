import { readAgentFile, writeAgentFile, appendAgentFile, readPromptFile } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import * as bluesky from "../lib/bluesky.js";
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

async function applyChange(change: IterateChange): Promise<string> {
  switch (change.change) {
    case "identity": {
      const current = await readAgentFile("identity.md");
      // Ask the model to apply the section edit to the current identity file
      const updated = await callSkill(
        "You are editing an identity file. Apply the proposed change to the specified section. Return ONLY the complete updated file content, nothing else.",
        `## Current identity.md\n\n${current}\n\n## Change to apply\nSection: ${change.section}\nProposal: ${change.proposal}`,
        { model: CONFIG.anthropic.modelDeep },
      );
      await writeAgentFile("identity.md", updated);
      console.log(`  [iterate] Updated identity.md (${change.section})`);
      return `Applied identity change (${change.section}): ${change.reason}`;
    }

    case "prompt": {
      const filename = `${change.skill}.md`;
      const current = await readPromptFile(filename);
      const updated = await callSkill(
        "You are editing a skill prompt file. Apply the proposed change. Return ONLY the complete updated file content, nothing else.",
        `## Current ${filename}\n\n${current}\n\n## Change to apply\n${change.proposal}`,
        { model: CONFIG.anthropic.modelDeep },
      );
      // Write to prompts/ directory via the full path
      const { writeFile } = await import("fs/promises");
      const { join } = await import("path");
      await writeFile(join(CONFIG.paths.prompts, filename), updated, "utf-8");
      console.log(`  [iterate] Updated prompt: ${filename}`);
      return `Applied prompt change (${change.skill}): ${change.reason}`;
    }

    case "profile": {
      const applied: string[] = [];
      const profileUpdates: { description?: string; displayName?: string } = {};

      if (change.bio !== undefined) {
        profileUpdates.description = change.bio;
        applied.push(`bio: "${change.bio}"`);
      }
      if (change.displayName !== undefined) {
        profileUpdates.displayName = change.displayName;
        applied.push(`display name: "${change.displayName}"`);
      }
      if (Object.keys(profileUpdates).length > 0) {
        await bluesky.updateProfile(profileUpdates);
      }
      if (change.handle !== undefined) {
        await bluesky.updateHandle(change.handle);
        applied.push(`handle: ${change.handle}`);
      }

      const profileLink = `[view profile](https://bsky.app/profile/${CONFIG.bluesky.handle})`;

      if (applied.length === 0) {
        return `Profile change proposed but no recognized fields: ${change.reason} (${profileLink})`;
      }

      console.log(`  [iterate] Updated profile: ${applied.join(", ")}`);
      return `Applied profile update (${applied.join(", ")}) (${profileLink}): ${change.reason}`;
    }
  }
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

  // Parse and apply changes
  const changes = parseChanges(response);
  const changeLog: string[] = [];

  for (const change of changes) {
    if (CONFIG.dryRun) {
      let desc: string;
      switch (change.change) {
        case "profile": {
          const fields = [
            change.bio !== undefined && `bio: "${change.bio}"`,
            change.displayName !== undefined && `display name: "${change.displayName}"`,
            change.handle !== undefined && `handle: ${change.handle}`,
          ].filter(Boolean).join(", ");
          desc = `Profile update (${fields || "no fields"}): ${change.reason}`;
          break;
        }
        case "identity":
          desc = `Identity change (${change.section}): ${change.reason}`;
          break;
        case "prompt":
          desc = `Prompt change (${change.skill}): ${change.reason}`;
          break;
      }
      changeLog.push(desc);
    } else {
      try {
        const result = await applyChange(change);
        changeLog.push(result);
      } catch (err) {
        const profileSuffix = change.change === "profile"
          ? ` ([view profile](https://bsky.app/profile/${CONFIG.bluesky.handle}))`
          : "";
        const bodyBlock = change.change === "profile"
          ? `\n  \`\`\`json\n  ${JSON.stringify(change)}\n  \`\`\``
          : "";
        const desc = `Failed to apply ${change.change} change${profileSuffix}: ${err}${bodyBlock}`;
        console.error(`  [iterate] Failed to apply ${change.change} change: ${err}`);
        changeLog.push(desc);
      }
    }
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

  console.log(`[iterate] ${changes.length} changes ${CONFIG.dryRun ? "proposed" : "applied"}`);
}
