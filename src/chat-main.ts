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
import { chat } from "./skills/chat.js";
import { ruminate } from "./skills/ruminate.js";
import { communicate } from "./skills/communicate.js";
import { iterate } from "./skills/iterate.js";
import { sleep } from "./skills/sleep.js";

const skills = [
  { name: "wake_up",   run: wakeUp },
  { name: "chat",      run: chat },
  { name: "ruminate",  run: ruminate },
  { name: "communicate", run: communicate },
  { name: "iterate",   run: iterate },
  { name: "sleep",     run: sleep },
];

async function main(): Promise<void> {
  const cycleStart = Date.now();
  console.log(`\n=== Emergence Chat — ${new Date().toISOString()} ===`);
  console.log(`Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Model: ${CONFIG.anthropic.model}`);
  console.log(`Type your message and press Enter. Enter nothing (or /done) to end the conversation.\n`);

  validateConfig();
  resetCycleUsage();

  const skillStats: { name: string; usage: CycleUsage; elapsed: number }[] = [];

  for (const skill of skills) {
    const start = Date.now();
    const before = snapshotUsage();
    try {
      await skill.run();
      const elapsed = (Date.now() - start) / 1000;
      const usage = diffUsage(before, getCycleUsage());
      skillStats.push({ name: skill.name, usage, elapsed });

      if (skill.name !== "chat") {
        const mindset = await readAgentFile("mindset.md");
        console.log(`[${skill.name}] Done (${elapsed.toFixed(1)}s)`);
        console.log(`--- mindset ---\n${mindset.trim()}\n---\n`);
      } else {
        console.log(`[${skill.name}] Done (${elapsed.toFixed(1)}s)\n`);
      }
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      const usage = diffUsage(before, getCycleUsage());
      skillStats.push({ name: skill.name, usage, elapsed });
      console.error(`[${skill.name}] FAILED after ${elapsed.toFixed(1)}s:`, err);
    }
  }

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
