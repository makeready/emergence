import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import { CONFIG } from "../config.js";

const topicsDir = () => join(CONFIG.paths.agent, "topics");
const visitedLinksFile = () => join(CONFIG.paths.agent, "visited_links.json");

export async function listTopics(): Promise<string[]> {
  try {
    return (await readdir(topicsDir()))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

export async function readTopicFile(topic: string): Promise<string> {
  try {
    return await readFile(join(topicsDir(), `${topic}.md`), "utf-8");
  } catch {
    return "";
  }
}

export async function appendTopicNotes(topic: string, notes: string, url?: string): Promise<void> {
  const dir = topicsDir();
  await mkdir(dir, { recursive: true });

  const path = join(dir, `${topic}.md`);
  let existing: string;
  try {
    existing = await readFile(path, "utf-8");
  } catch {
    existing = `# ${topic}\n\n`;
  }

  const timestamp = new Date().toISOString();
  const entry = `## ${timestamp}\n\n${notes}\n`;
  await writeFile(path, existing + entry, "utf-8");

  if (url) {
    await addVisitedLink(url);
  }
}

export async function getVisitedLinks(): Promise<string[]> {
  try {
    const raw = await readFile(visitedLinksFile(), "utf-8");
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function addVisitedLink(url: string): Promise<void> {
  const links = await getVisitedLinks();
  if (links.includes(url)) return;
  links.push(url);
  const dir = join(CONFIG.paths.agent);
  await mkdir(dir, { recursive: true });
  await writeFile(visitedLinksFile(), JSON.stringify(links, null, 2), "utf-8");
}
