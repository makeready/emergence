import { CONFIG, validateConfig } from "./config.js";
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

  for (const skill of skills) {
    if (skill.skipIf?.()) {
      console.log(`[${skill.name}] Skipped (precondition not met)\n`);
      continue;
    }

    const start = Date.now();
    try {
      await skill.run();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[${skill.name}] Done (${elapsed}s)\n`);
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`[${skill.name}] FAILED after ${elapsed}s:`, err);
      // Continue with remaining skills — partial cycles are better than no cycle
    }
  }

  const totalElapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  console.log(`=== Cycle complete (${totalElapsed}s) ===\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
