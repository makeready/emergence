import { readFile as fsRead, writeFile as fsWrite, mkdir, readdir } from "fs/promises";
import { join, dirname } from "path";
import { CONFIG } from "../config.js";

function agentPath(name: string): string {
  return join(CONFIG.paths.agent, name);
}

function todayJournalPath(): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  return join(CONFIG.paths.agent, "journal", `${dateStr}.md`);
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

export async function appendToJournal(content: string): Promise<void> {
  const path = todayJournalPath();
  await mkdir(dirname(path), { recursive: true });
  let existing: string;
  try {
    existing = await fsRead(path, "utf-8");
  } catch {
    const dateStr = new Date().toISOString().slice(0, 10);
    existing = `# Journal — ${dateStr}\n`;
  }
  await fsWrite(path, existing + content, "utf-8");
}

export async function readRecentJournal(maxLines: number): Promise<string> {
  const journalDir = join(CONFIG.paths.agent, "journal");
  let filenames: string[];
  try {
    filenames = (await readdir(journalDir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort(); // ascending: oldest first, so newest is at the end
  } catch {
    return "";
  }

  const parts: string[] = [];
  for (const name of filenames) {
    parts.push(await fsRead(join(journalDir, name), "utf-8"));
  }

  const combined = parts.join("\n");
  const lines = combined.split("\n");
  if (lines.length <= maxLines) return combined;
  return lines.slice(lines.length - maxLines).join("\n");
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

function relativeAge(ts: number): string {
  if (ts === 0) return "*(age unknown — treat as oldest)*";
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 60) return `*(${mins}m ago)*`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `*(${hrs}h ago)*`;
  return `*(${Math.floor(hrs / 24)}d ago)*`;
}

/**
 * Reads short_term_memory.md for model input: sorts sections oldest-first
 * (newest last, for LLM recency benefit) and annotates each header with
 * its relative age so the model can weight recent entries appropriately.
 */
export async function readShortTermMemory(): Promise<string> {
  const content = await readAgentFile("short_term_memory.md");
  const parts = content.split(/\n(?=### )/);
  const preamble = parts[0];
  const sections = parts.slice(1);
  if (sections.length <= 1) return content;

  const parsed = sections.map((raw) => {
    const firstLine = raw.split("\n")[0];
    const m = firstLine.match(SECTION_TIMESTAMP_RE);
    return { ts: m ? new Date(m[1]).getTime() : 0, raw };
  });

  // Oldest first → newest last (closest to the task instruction in context)
  parsed.sort((a, b) => a.ts - b.ts);

  const labeled = parsed.map(({ ts, raw }) => {
    const lines = raw.split("\n");
    lines[0] += " " + relativeAge(ts);
    return lines.join("\n");
  });

  return [preamble, ...labeled].join("\n");
}

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
