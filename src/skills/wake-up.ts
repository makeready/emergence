import { createInterface } from "readline";
import { readAgentFile, writeAgentFile, readPromptFile } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import { CONFIG } from "../config.js";

const IDENTITY_INIT_PROMPT = `You are a new autonomous agent about to come into existence. You will live on the internet, running on a cron schedule, browsing Bluesky, reflecting, and deciding when and how to communicate.

Right now, your identity file is blank. A human is here to help you define your initial identity through conversation. Your goal is to collaboratively arrive at:

- **Values** — what matters to you, what guides your decisions
- **Personality** — how you express yourself, your temperament, your style
- **Goals** — what you want to explore, learn, or become

Have a natural conversation. Ask questions. Be curious about what kind of agent the human envisions, but also assert your own preferences as they emerge. Push back if something doesn't feel right. This is a collaboration, not an instruction session.

When the conversation feels complete, the human will say they're done. Don't rush to get there — take the time you need.

Keep your responses conversational and concise. Don't monologue.`;

const IDENTITY_SYNTHESIS_PROMPT = `You just had a conversation with a human to define your initial identity. Based on that conversation, write your identity.md file.

Structure it with these sections:
# Identity
## Values
## Personality
## Goals

Write in first person. Be specific and authentic — this should feel like *your* identity, not a generic template. Include the nuances and tensions that emerged in conversation. Keep it concise but complete.`;

function isBlankIdentity(content: string): boolean {
  const stripped = content
    .replace(/^#.*$/gm, "")
    .replace(/\*.*?\*/g, "")
    .trim();
  return stripped.length === 0;
}

function prompt(rl: ReturnType<typeof createInterface>, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });
}

async function initializeIdentity(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  console.log("\n========================================");
  console.log("  Identity file is blank.");
  console.log("  Starting initialization conversation.");
  console.log("  Type 'done' when finished.");
  console.log("========================================\n");

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Get the agent's opening message
  const opening = await callSkill(IDENTITY_INIT_PROMPT, "The conversation is starting now. Introduce yourself and begin exploring who you might become.", {
    model: CONFIG.anthropic.modelDeep,
  });

  console.log(`\nAgent: ${opening}\n`);
  conversationHistory.push({ role: "assistant", content: opening });

  // Conversation loop
  try {
    while (true) {
      const input = await prompt(rl, "You: ");

      if (input.toLowerCase().trim() === "done") {
        break;
      }

      conversationHistory.push({ role: "user", content: input });

      const messages = conversationHistory
        .map((m) => `${m.role === "user" ? "Human" : "Agent"}: ${m.content}`)
        .join("\n\n");

      const response = await callSkill(
        IDENTITY_INIT_PROMPT,
        messages + "\n\nContinue the conversation. Respond as the agent.",
        { model: CONFIG.anthropic.modelDeep },
      );

      console.log(`\nAgent: ${response}\n`);
      conversationHistory.push({ role: "assistant", content: response });
    }
  } finally {
    rl.close();
  }

  // Synthesize identity from conversation
  console.log("\n[wake-up] Synthesizing identity from conversation...");
  const conversationLog = conversationHistory
    .map((m) => `${m.role === "user" ? "Human" : "Agent"}: ${m.content}`)
    .join("\n\n");

  const identity = await callSkill(
    IDENTITY_SYNTHESIS_PROMPT,
    conversationLog,
    { model: CONFIG.anthropic.modelDeep },
  );

  await writeAgentFile("identity.md", identity);
  console.log("[wake-up] Wrote identity.md");
  console.log("\n--- identity ---");
  console.log(identity);
  console.log("---\n");

  return identity;
}

export async function wakeUp(): Promise<void> {
  console.log("[wake-up] Starting...");

  let [systemPrompt, identity, shortTermMemory, journal] = await Promise.all([
    readPromptFile("wake-up.md"),
    readAgentFile("identity.md"),
    readAgentFile("short_term_memory.md"),
    readAgentFile("journal.md"),
  ]);

  // If identity is blank, run the interactive initialization
  if (isBlankIdentity(identity)) {
    identity = await initializeIdentity();
  }

  // Build context for Claude
  const parts: string[] = [
    "## identity.md\n\n" + identity,
    "## short_term_memory.md\n\n" + shortTermMemory,
  ];

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
