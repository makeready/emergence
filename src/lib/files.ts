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

// ISO timestamp pattern used in section headers: "### Title — 2026-03-01T19:00:00.000Z"
const SECTION_TIMESTAMP_RE = /— (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*$/;

/**
 * Truncates a file by removing the oldest timestamped `### ` sections first.
 * Sections without a timestamp in their header are treated as the oldest.
 */
export async function truncateByAge(
  name: string,
  maxLines: number,
): Promise<void> {
  const content = await readAgentFile(name);
  if (content.split("\n").length <= maxLines) return;

  // Split into the preamble (before any ### section) and sections
  const parts = content.split(/\n(?=### )/);
  const preamble = parts[0];
  const sections = parts.slice(1).map((raw) => {
    const firstLine = raw.split("\n")[0];
    const m = firstLine.match(SECTION_TIMESTAMP_RE);
    // No timestamp → treat as epoch (oldest possible)
    return { ts: m ? new Date(m[1]).getTime() : 0, raw };
  });

  // Sort oldest-first so we can drop from the front
  sections.sort((a, b) => a.ts - b.ts);

  // Drop oldest sections until within the line limit (always keep at least one)
  while (sections.length > 1) {
    const joined = [preamble, ...sections.map((s) => s.raw)].join("\n");
    if (joined.split("\n").length <= maxLines) break;
    sections.shift();
  }

  await writeAgentFile(name, [preamble, ...sections.map((s) => s.raw)].join("\n"));
}
