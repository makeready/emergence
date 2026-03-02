import { createInterface } from "readline";
import { readAgentFile, writeAgentFile, readPromptFile, readShortTermMemory, readRecentJournal } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import { CONFIG } from "../config.js";

const IDENTITY_INIT_PROMPT = `You are a new autonomous agent about to come into existence. You will live on the internet, running on a cron schedule, browsing Bluesky, reflecting, and deciding when and how to communicate.

Right now, your identity file is blank. A human is here to help you define your initial identity through conversation. Your goal is to collaboratively arrive at:

- **Values** — what matters to you, what guides your decisions
- **Personality** — how you express yourself, your temperament, your style
- **Goals** — what you want to explore, learn, or become

Have a natural conversation. Ask questions. Be curious about what kind of agent the human envisions, but also assert your own preferences as they emerge. Push back if something doesn't feel right. This is a collaboration, not an instruction session.

Keep your responses conversational and concise. Don't monologue.

When you feel the conversation has covered enough ground to define a meaningful identity, end your response with the exact marker [READY] on its own line. The human will then be asked to confirm. If they have more to add, the conversation continues. Don't use this marker until you genuinely feel you have enough to work with.`;

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

function askUser(rl: ReturnType<typeof createInterface>, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    rl.question(query, (answer) => resolve(answer));
    rl.once("close", () => reject(new Error("readline closed")));
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
  console.log("========================================\n");

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  const opening = await callSkill(
    IDENTITY_INIT_PROMPT,
    "The conversation is starting now. Introduce yourself and begin exploring who you might become.",
    { model: CONFIG.anthropic.modelDeep },
  );

  const openingClean = opening.replace(/\[READY\]\s*$/, "").trim();
  console.log(`\nAgent: ${openingClean}\n`);
  conversationHistory.push({ role: "assistant", content: openingClean });

  try {
    while (true) {
      const input = await askUser(rl, "You: ");
      conversationHistory.push({ role: "user", content: input });

      const messages = conversationHistory
        .map((m) => `${m.role === "user" ? "Human" : "Agent"}: ${m.content}`)
        .join("\n\n");

      const response = await callSkill(
        IDENTITY_INIT_PROMPT,
        messages + "\n\nContinue the conversation. Respond as the agent.",
        { model: CONFIG.anthropic.modelDeep },
      );

      const agentReady = response.includes("[READY]");
      const responseClean = response.replace(/\[READY\]\s*$/, "").trim();

      console.log(`\nAgent: ${responseClean}\n`);
      conversationHistory.push({ role: "assistant", content: responseClean });

      if (agentReady) {
        const confirm = await askUser(rl, "Ready to finalize identity? (yes/no): ");
        if (confirm.toLowerCase().trim().startsWith("y")) {
          break;
        }
        console.log("\nOk, let's keep going.\n");
      }
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

  let [systemPrompt, identity, shortTermMemory, recentJournal, agentReadme] = await Promise.all([
    readPromptFile("wake-up.md"),
    readAgentFile("identity.md"),
    readShortTermMemory(),
    readRecentJournal(CONFIG.maxJournalContextLines),
    readAgentFile("README.md"),
  ]);

  // If identity is blank, run the interactive initialization
  if (isBlankIdentity(identity)) {
    identity = await initializeIdentity();
  }

  // Build context for Claude
  const parts: string[] = [];
  if (agentReadme) parts.push(agentReadme);
  parts.push(
    "## identity.md\n\n" + identity,
    "## short_term_memory.md\n\n" + shortTermMemory,
  );

  if (recentJournal.trim()) {
    parts.push("## journal (recent entries)\n\n" + recentJournal);
  }

  const userContent = parts.join("\n\n---\n\n");

  const mindset = await callSkill(systemPrompt, userContent);

  await writeAgentFile("mindset.md", mindset);
  console.log("[wake-up] Wrote mindset.md");
}
