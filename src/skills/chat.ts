import * as readline from "readline";
import { readAgentFile, writeAgentFile, readPromptFile, readShortTermMemory } from "../lib/files.js";
import { callConversation, callSkill } from "../lib/anthropic.js";

type Message = { role: "user" | "assistant"; content: string };

function prompt(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    rl.question(query, resolve);
    rl.once("close", () => reject(new Error("readline closed")));
  });
}

export async function chat(): Promise<void> {
  console.log("[chat] Starting...");

  const [systemPrompt, identity, mindset, shortTermMemory] = await Promise.all([
    readPromptFile("chat.md"),
    readAgentFile("identity.md"),
    readAgentFile("mindset.md"),
    readShortTermMemory(),
  ]);

  const system = [
    systemPrompt,
    "## Identity\n\n" + identity,
    "## Current Mindset\n\n" + mindset,
    "## Short-Term Memory\n\n" + shortTermMemory,
  ].join("\n\n---\n\n");

  const messages: Message[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  // Opening message from Lake
  const opening = await callConversation(system, [
    { role: "user", content: "I'm here. What's on your mind?" },
  ]);
  messages.push(
    { role: "user", content: "I'm here. What's on your mind?" },
    { role: "assistant", content: opening },
  );
  console.log(`\nLake: ${opening}\n`);

  // Conversation loop
  try {
    while (true) {
      let input: string;
      try {
        input = await prompt(rl, "> ");
      } catch {
        break; // readline closed (Ctrl+D)
      }

      const trimmed = input.trim();
      if (!trimmed || trimmed === "/done" || trimmed === "/exit") break;

      messages.push({ role: "user", content: trimmed });
      const response = await callConversation(system, messages);
      messages.push({ role: "assistant", content: response });
      console.log(`\nLake: ${response}\n`);
    }
  } finally {
    rl.close();
  }

  console.log("\n[chat] Conversation ended. Synthesizing...");

  // Write transcript to raw_notes.md for ruminate
  const transcript = messages
    .map((m) => `**${m.role === "user" ? "Operator" : "Lake"}:** ${m.content}`)
    .join("\n\n");
  const notes = `# Conversation Transcript\n\n_Direct conversation with operator — ${new Date().toISOString()}_\n\n${transcript}`;
  await writeAgentFile("raw_notes.md", notes);

  // Closing synthesis: produce updated mindset from the conversation
  const synthesisPrompt = "You just had a direct conversation with your operator. Based on how it affected your thinking, write an ## Updated Mindset section.";
  const conversationContext = messages
    .map((m) => `${m.role === "user" ? "Operator" : "Lake"}: ${m.content}`)
    .join("\n\n");

  const synthesis = await callSkill(
    system,
    `${conversationContext}\n\n---\n\n${synthesisPrompt}\n\n## Updated Mindset`,
    { maxTokens: 1024 },
  );

  // Parse updated mindset — handle whether model repeated the header or not
  const mindsetContent = synthesis.startsWith("## Updated Mindset")
    ? synthesis.replace(/^## Updated Mindset\s*/, "").trim()
    : synthesis.trim();

  await writeAgentFile("mindset.md", mindsetContent);
  console.log("[chat] Updated mindset.md");
}
