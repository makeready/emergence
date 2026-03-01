import { readAgentFile, writeAgentFile, appendAgentFile, readPromptFile } from "../lib/files.js";
import { callSkill } from "../lib/anthropic.js";
import * as bluesky from "../lib/bluesky.js";
import type { CommunicateAction } from "../types.js";
import { CONFIG } from "../config.js";

function parseActions(response: string): CommunicateAction[] {
  const actions: CommunicateAction[] = [];
  const jsonPattern = /```json\s*\n([\s\S]*?)```|(\{[^\n]*"action"[^\n]*\})/g;
  let match;

  while ((match = jsonPattern.exec(response)) !== null) {
    const jsonStr = match[1] || match[2];
    // Handle multiple JSON objects in a single block
    for (const line of jsonStr.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          actions.push(JSON.parse(trimmed));
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
  return actions;
}

async function executeAction(action: CommunicateAction): Promise<string> {
  switch (action.action) {
    case "post":
      await bluesky.post(action.text);
      return `Posted: "${action.text}"`;
    case "reply":
      await bluesky.reply(
        action.text,
        action.postUri,
        action.postCid,
        action.rootUri,
        action.rootCid,
      );
      return `Replied to ${action.postUri}: "${action.text}"`;
    case "dm":
      await bluesky.sendDM(action.did, action.text);
      return `DM to ${action.did}: "${action.text}"`;
    case "follow":
      await bluesky.follow(action.did);
      return `Followed ${action.did}`;
    case "unfollow":
      await bluesky.unfollow(action.followUri);
      return `Unfollowed ${action.followUri}`;
    case "like":
      await bluesky.like(action.uri, action.cid);
      return `Liked ${action.uri}`;
    case "repost":
      await bluesky.repost(action.uri, action.cid);
      return `Reposted ${action.uri}`;
  }
}

export async function communicate(): Promise<void> {
  console.log("[communicate] Starting...");

  const [systemPrompt, mindset] = await Promise.all([
    readPromptFile("communicate.md"),
    readAgentFile("mindset.md"),
  ]);

  const userContent = "## Current Mindset\n\n" + mindset +
    '\n\n---\n\nProduce your response in two clearly labeled sections:\n\n## Updated Mindset\n(your mindset after deciding what to communicate)\n\n## Actions\n(your chosen actions as JSON, or "No actions — choosing silence.")';

  const response = await callSkill(systemPrompt, userContent, {
    model: CONFIG.anthropic.modelDeep,
  });

  // Parse and execute actions
  const actions = parseActions(response);
  const actionLog: string[] = [];

  for (const action of actions) {
    try {
      const result = await executeAction(action);
      actionLog.push(result);
    } catch (err) {
      const desc = `Failed to ${action.action}: ${err}`;
      console.error(`  [communicate] ${desc}`);
      actionLog.push(desc);
    }
  }

  if (actions.length === 0) {
    actionLog.push("Chose silence — no actions taken.");
  }

  // Log actions to journal
  const logEntry = `\n\n### Communication Log — ${new Date().toISOString()}\n${CONFIG.dryRun ? "*(dry run)*\n" : ""}${actionLog.map((a) => "- " + a).join("\n")}`;
  await appendAgentFile("journal.md", logEntry);

  // Update mindset
  const mindsetMatch = response.match(
    /## Updated Mindset\n([\s\S]*?)(?=## Actions|$)/,
  );
  if (mindsetMatch) {
    await writeAgentFile("mindset.md", mindsetMatch[1].trim());
    console.log("[communicate] Updated mindset.md");
  }

  console.log(`[communicate] ${actions.length} actions processed`);
}
