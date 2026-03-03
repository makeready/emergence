import {
  readAgentFile,
  writeAgentFile,
  appendToJournal,
  readRecentJournal,
  readPromptFile,
  readPeopleFiles,
  appendPeopleNotes,
  parsePeopleUpdates,
} from "../lib/files.js";
import { callSkill, callSkillWithTools } from "../lib/anthropic.js";
import { listTopics, readTopicFile, appendTopicNotes, getVisitedLinks } from "../lib/topics.js";
import type Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config.js";

export async function ruminate(): Promise<void> {
  console.log("[ruminate] Starting...");

  const [systemPrompt, mindset, rawNotes, recentJournal, ingestDidsRaw, agentReadme] = await Promise.all([
    readPromptFile("ruminate.md"),
    readAgentFile("mindset.md"),
    readAgentFile("raw_notes.md"),
    readRecentJournal(CONFIG.maxJournalContextLines),
    readAgentFile("ingest_dids.json"),
    readAgentFile("README.md"),
  ]);

  let ingestDids: string[] = [];
  try { ingestDids = JSON.parse(ingestDidsRaw); } catch { /* ignore */ }

  const peopleFiles = await readPeopleFiles(ingestDids);
  const peopleEntries = Object.entries(peopleFiles);
  const peopleSection = peopleEntries.length > 0
    ? "## People Notes\n\n" + peopleEntries.map(([did, content]) => `### ${did}\n\n${content}`).join("\n\n")
    : "";

  const [topics, visitedLinks] = CONFIG.webSearch
    ? await Promise.all([listTopics(), getVisitedLinks()])
    : [[], []];

  const contextParts: string[] = [];
  if (agentReadme) contextParts.push(agentReadme);
  contextParts.push(
    `**Current time: ${new Date().toISOString()}**`,
    "## Current Mindset\n\n" + mindset,
    "## Raw Notes\n\n" + rawNotes,
    "## Journal (recent entries)\n\n" + recentJournal,
  );
  if (peopleSection) contextParts.push(peopleSection);
  if (CONFIG.webSearch) {
    contextParts.push(
      "## Topics You Have Researched\n\n" +
        (topics.length > 0 ? topics.join("\n") : "_None yet._") +
        "\n\n## Visited Links\n\n" +
        (visitedLinks.length > 0 ? visitedLinks.join("\n") : "_None yet._") +
        "\nDo not research links that appear in this list.",
    );
  }
  contextParts.push(
    '\n\n---\n\nProduce your response in three clearly labeled sections:\n\n## Updated Mindset\n(your evolved mindset)\n\n## Journal Entry\n(a timestamped reflective entry)\n\n## Updated Short-Term Memory\n(observations and threads to carry forward)\n\nOptionally add a fourth section:\n\n## People Updates\n(if you have new thoughts about specific people, record them here)',
  );

  const userContent = contextParts.join("\n\n---\n\n");

  let response: string;
  if (CONFIG.webSearch) {
    const tools: Anthropic.Messages.Tool[] = [
      { type: "web_search_20250305" as const, name: "web_search" } as unknown as Anthropic.Messages.Tool,
      {
        name: "save_topic_notes",
        description:
          "Save research notes about a topic to a persistent file. Appends a timestamped entry. Provide url if you followed a specific link, to prevent re-visiting it.",
        input_schema: {
          type: "object" as const,
          properties: {
            topic: { type: "string", description: "Slug-style topic name, e.g. 'atproto-spec' or 'person-janedoe'" },
            notes: { type: "string", description: "Summary of what you learned" },
            url: { type: "string", description: "URL you visited, if any" },
          },
          required: ["topic", "notes"],
        },
      },
      {
        name: "read_topic",
        description: "Load full research history for a topic.",
        input_schema: {
          type: "object" as const,
          properties: { topic: { type: "string" } },
          required: ["topic"],
        },
      },
    ];

    const toolHandler = async (name: string, input: Record<string, unknown>): Promise<string> => {
      if (name === "save_topic_notes") {
        await appendTopicNotes(input.topic as string, input.notes as string, input.url as string | undefined);
        console.log(`[ruminate] Saved topic notes: ${input.topic}`);
        return "Saved.";
      }
      if (name === "read_topic") {
        return (await readTopicFile(input.topic as string)) || "No notes found for this topic.";
      }
      return "";
    };

    response = await callSkillWithTools(systemPrompt, userContent, tools, toolHandler, {
      model: CONFIG.anthropic.modelDeep,
    });
  } else {
    response = await callSkill(systemPrompt, userContent, {
      model: CONFIG.anthropic.modelDeep,
    });
  }

  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Journal Entry|$)/,
  );
  const journalMatch = response.match(
    /## Journal Entry\n([\s\S]*?)(?=## Updated Short-Term Memory|$)/,
  );
  const memoryMatch = response.match(
    /## Updated Short-Term Memory\n([\s\S]*?)(?=## People Updates|$)/,
  );

  await writeAgentFile("mindset.md", mindsetMatch ? mindsetMatch[1].trim() : response);
  if (journalMatch) {
    await appendToJournal("\n\n" + journalMatch[1].trim());
    console.log("[ruminate] Appended to journal");
  }
  // Append any people updates the model produced
  const condenser = async (entries: string, header: string) => {
    return await callSkill(
      "Condense these timestamped observations about a person into 1-3 sentences. Preserve key facts: who they are, relationship dynamics, important topics, and notable traits. Be specific.",
      `${header}\n\nObservations to condense:\n${entries}`,
      { maxTokens: 256 },
    );
  };
  const peopleUpdates = parsePeopleUpdates(response);
  for (const [did, update] of Object.entries(peopleUpdates)) {
    await appendPeopleNotes(did, update.notes, update.heading, condenser);
    console.log(`[ruminate] Appended people notes for ${did}`);
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
