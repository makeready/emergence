import { readFile as fsRead, writeFile as fsWrite, mkdir, readdir } from "fs/promises";
import { join, dirname } from "path";
import { CONFIG } from "../config.js";

// ── People files ──────────────────────────────────────────────────────────────

function didToFilename(did: string): string {
  return did.replace(/:/g, "_") + ".md";
}

export async function readPeopleFile(did: string): Promise<string> {
  try {
    return await fsRead(join(CONFIG.paths.agent, "people", didToFilename(did)), "utf-8");
  } catch {
    return "";
  }
}

export async function writePeopleFile(did: string, content: string): Promise<void> {
  const path = join(CONFIG.paths.agent, "people", didToFilename(did));
  await mkdir(dirname(path), { recursive: true });
  await fsWrite(path, content, "utf-8");
}

export async function readAllPeopleFiles(): Promise<Record<string, string>> {
  const dir = join(CONFIG.paths.agent, "people");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return {};
  }
  const result: Record<string, string> = {};
  await Promise.all(
    files.map(async (filename) => {
      // Reverse didToFilename: "did_plc_abc123.md" → "did:plc:abc123"
      const base = filename.slice(0, -3);
      const parts = base.split("_");
      if (parts.length < 3 || parts[0] !== "did") return;
      const did = `${parts[0]}:${parts[1]}:${parts.slice(2).join("_")}`;
      const content = await readPeopleFile(did);
      if (content) result[did] = content;
    }),
  );
  return result;
}

export async function readPeopleFiles(dids: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  await Promise.all(
    dids.map(async (did) => {
      const content = await readPeopleFile(did);
      if (content) result[did] = content;
    }),
  );
  return result;
}

/**
 * Parses a `## People Updates` section from model output.
 * Each `### did:xxx (@handle)` subheading introduces a person's file content.
 * Returns a map of DID → full new file content.
 */
export function parsePeopleUpdates(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const sectionMatch = text.match(/## People Updates\n([\s\S]*?)(?=\n## |\n*$)/);
  if (!sectionMatch) return result;

  const parts = sectionMatch[1].split(/^(?=### )/m);
  for (const part of parts) {
    if (!part.startsWith("### ")) continue;
    const didMatch = part.match(/did:[^\s)]+/);
    if (!didMatch) continue;
    const did = didMatch[0];
    const firstNewline = part.indexOf("\n");
    if (firstNewline === -1) continue;
    const content = part.slice(firstNewline + 1).trim();
    if (content) result[did] = content;
  }
  return result;
}

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

// Matches individual observation lines: [2026-03-01T19:00:00.000Z] text
const OBS_TS_RE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] /;
// Matches timestamp in ### section headers: "### Title — 2026-03-01T19:00:00.000Z"
const SEC_TS_RE = /— (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*$/;

interface MemoryEntry {
  ts: number;
  raw: string; // one observation line, or a complete multi-line ### section
}

/**
 * Parses short_term_memory.md into discrete entries:
 * - Lines starting with [ISO] are individual observations
 * - Blocks starting with ### are timestamped sections (e.g. Cycle Mindset)
 * Entries without a recognisable timestamp get ts=0 (treated as oldest).
 */
function parseMemoryEntries(content: string): { header: string; entries: MemoryEntry[] } {
  const lines = content.split("\n");
  const header = lines[0];
  const entries: MemoryEntry[] = [];
  let sectionLines: string[] = [];
  let sectionTs = 0;

  const flushSection = () => {
    if (sectionLines.length === 0) return;
    while (sectionLines.length > 0 && !sectionLines[sectionLines.length - 1].trim()) {
      sectionLines.pop();
    }
    if (sectionLines.length > 0) {
      entries.push({ ts: sectionTs, raw: sectionLines.join("\n") });
    }
    sectionLines = [];
  };

  for (const line of lines.slice(1)) {
    if (line.startsWith("### ")) {
      flushSection();
      const m = line.match(SEC_TS_RE);
      sectionTs = m ? new Date(m[1]).getTime() : 0;
      sectionLines = [line];
    } else if (sectionLines.length > 0) {
      sectionLines.push(line);
    } else if (line.trim()) {
      const m = line.match(OBS_TS_RE);
      entries.push({ ts: m ? new Date(m[1]).getTime() : 0, raw: line });
    }
    // blank lines outside sections are skipped
  }
  flushSection();

  return { header, entries };
}

/**
 * Returns "N cycles ago" (or "this cycle") based on how many recorded
 * cycle-end times postdate ts.
 */
function cyclesAgo(ts: number, cycleTimes: number[]): string {
  const count = cycleTimes.filter((t) => t > ts).length;
  if (count === 0) return "this cycle";
  if (count === 1) return "1 cycle ago";
  return `${count} cycles ago`;
}

function formatEntryForContext(entry: MemoryEntry, cycleTimes: number[]): string {
  if (entry.ts === 0) return entry.raw;
  const age = cyclesAgo(entry.ts, cycleTimes);
  if (OBS_TS_RE.test(entry.raw)) {
    return entry.raw.replace(OBS_TS_RE, `[${age}] `);
  }
  return entry.raw.replace(SEC_TS_RE, `— ${age}`);
}

const CYCLE_LOG_MAX = 100;

export async function appendCycleLog(timestamp: string): Promise<void> {
  const raw = await readAgentFile("cycle_log.json");
  let times: string[] = [];
  try { times = JSON.parse(raw); } catch { /* start fresh */ }
  times.push(timestamp);
  if (times.length > CYCLE_LOG_MAX) times = times.slice(times.length - CYCLE_LOG_MAX);
  await writeAgentFile("cycle_log.json", JSON.stringify(times));
}

async function readCycleLog(): Promise<number[]> {
  const raw = await readAgentFile("cycle_log.json");
  try {
    return (JSON.parse(raw) as string[]).map((t) => new Date(t).getTime());
  } catch {
    return [];
  }
}

/**
 * Reads short_term_memory.md for model input, sorting entries oldest-first
 * (newest last, for LLM recency benefit). Timestamps are shown as relative
 * ages; a header note explains that recency implies greater weight.
 */
export async function readShortTermMemory(): Promise<string> {
  const [content, cycleTimes] = await Promise.all([
    readAgentFile("short_term_memory.md"),
    readCycleLog(),
  ]);
  const { header, entries } = parseMemoryEntries(content);
  if (entries.length <= 1) return content;

  entries.sort((a, b) => a.ts - b.ts);
  const note = "_(oldest → newest; entries closer to the bottom are more recent and carry greater weight)_";
  return `${header}\n${note}\n\n${entries.map((e) => formatEntryForContext(e, cycleTimes)).join("\n")}\n`;
}

/**
 * Truncates short_term_memory.md by removing the oldest entries first.
 * Handles both individual [timestamp] observation lines and ### sections.
 * Entries without a timestamp are treated as the oldest.
 */
export async function truncateByAge(
  name: string,
  maxLines: number,
): Promise<void> {
  const content = await readAgentFile(name);
  if (content.split("\n").length <= maxLines) return;

  const { header, entries } = parseMemoryEntries(content);
  entries.sort((a, b) => a.ts - b.ts); // oldest first

  while (entries.length > 1) {
    const body = entries.map((e) => e.raw).join("\n");
    if (`${header}\n\n${body}\n`.split("\n").length <= maxLines) break;
    entries.shift();
  }

  const body = entries.map((e) => e.raw).join("\n");
  await writeAgentFile(name, `${header}\n\n${body}\n`);
}
