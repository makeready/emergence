import { CONFIG, validateConfig } from "./config.js";
import { readAgentFile } from "./lib/files.js";
import {
  resetCycleUsage,
  getCycleUsage,
  snapshotUsage,
  diffUsage,
  type CycleUsage,
} from "./lib/anthropic.js";
import { wakeUp } from "./skills/wake-up.js";
import { ingest } from "./skills/ingest.js";
import { ruminate } from "./skills/ruminate.js";
import { communicate } from "./skills/communicate.js";
import { iterate } from "./skills/iterate.js";
import { sleep } from "./skills/sleep.js";

interface Skill {
  name: string;
  run: () => Promise<void>;
  /** Skip this skill if the condition returns true */
  skipIf?: () => boolean;
}

const skills: Skill[] = [
  { name: "wake_up", run: wakeUp },
  {
    name: "ingest",
    run: ingest,
    skipIf: () => !CONFIG.bluesky.handle,
  },
  { name: "ruminate", run: ruminate },
  { name: "communicate", run: communicate },
  { name: "iterate", run: iterate },
  { name: "sleep", run: sleep },
];

async function main(): Promise<void> {
  const cycleStart = Date.now();
  console.log(`\n=== Emergence Cycle — ${new Date().toISOString()} ===`);
  console.log(`Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Model: ${CONFIG.anthropic.model}\n`);

  validateConfig();
  resetCycleUsage();

  const skillStats: { name: string; usage: CycleUsage; elapsed: number }[] = [];

  for (const skill of skills) {
    if (skill.skipIf?.()) {
      console.log(`[${skill.name}] Skipped (precondition not met)\n`);
      continue;
    }

    const start = Date.now();
    const before = snapshotUsage();
    try {
      await skill.run();
      const elapsed = (Date.now() - start) / 1000;
      const usage = diffUsage(before, getCycleUsage());
      skillStats.push({ name: skill.name, usage, elapsed });

      const mindset = await readAgentFile("mindset.md");
      console.log(`[${skill.name}] Done (${elapsed.toFixed(1)}s)`);
      console.log(`--- mindset ---\n${mindset.trim()}\n---\n`);
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      const usage = diffUsage(before, getCycleUsage());
      skillStats.push({ name: skill.name, usage, elapsed });
      console.error(`[${skill.name}] FAILED after ${elapsed.toFixed(1)}s:`, err);
    }
  }

  // Print usage summary
  const total = getCycleUsage();
  const totalElapsed = (Date.now() - cycleStart) / 1000;

  console.log("=== Usage Summary ===");
  console.log(
    `${"Skill".padEnd(14)} ${"Input".padStart(8)} ${"Output".padStart(8)} ${"Cost".padStart(9)} ${"Time".padStart(7)}`,
  );
  console.log("-".repeat(50));
  for (const s of skillStats) {
    console.log(
      `${s.name.padEnd(14)} ${String(s.usage.inputTokens).padStart(8)} ${String(s.usage.outputTokens).padStart(8)} ${("$" + s.usage.cost.toFixed(4)).padStart(9)} ${(s.elapsed.toFixed(1) + "s").padStart(7)}`,
    );
  }
  console.log("-".repeat(50));
  console.log(
    `${"TOTAL".padEnd(14)} ${String(total.inputTokens).padStart(8)} ${String(total.outputTokens).padStart(8)} ${("$" + total.cost.toFixed(4)).padStart(9)} ${(totalElapsed.toFixed(1) + "s").padStart(7)}`,
  );
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
