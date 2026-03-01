import { readFile as fsRead, writeFile as fsWrite, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { CONFIG } from "../config.js";

function agentPath(name: string): string {
  return join(CONFIG.paths.agent, name);
}

function promptPath(name: string): string {
  return join(CONFIG.paths.prompts, name);
}

export async function readAgentFile(name: string): Promise<string> {
  try {
    return await fsRead(agentPath(name), "utf-8");
  } catch {
    return "";
  }
}

export async function writeAgentFile(
  name: string,
  content: string,
): Promise<void> {
  const path = agentPath(name);
  await mkdir(dirname(path), { recursive: true });
  await fsWrite(path, content, "utf-8");
}

export async function appendAgentFile(
  name: string,
  content: string,
): Promise<void> {
  const existing = await readAgentFile(name);
  await writeAgentFile(name, existing + content);
}

export async function readPromptFile(name: string): Promise<string> {
  return await fsRead(promptPath(name), "utf-8");
}

export async function truncateFile(
  name: string,
  maxLines: number,
): Promise<void> {
  const content = await readAgentFile(name);
  const lines = content.split("\n");
  if (lines.length <= maxLines) return;

  // Keep the first line (header) and the last (maxLines - 1) lines
  const header = lines[0];
  const kept = lines.slice(lines.length - (maxLines - 1));
  await writeAgentFile(name, [header, "", "*(older entries truncated)*", "", ...kept].join("\n"));
}
