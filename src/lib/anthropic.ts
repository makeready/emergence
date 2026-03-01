import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: CONFIG.anthropic.apiKey });
  }
  return client;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } };

export interface CallSkillOptions {
  model?: string;
  maxTokens?: number;
}

export interface CycleUsage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in USD */
  cost: number;
}

// Per-million-token pricing
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

const DEFAULT_PRICING = { input: 3, output: 15 };

let cycleUsage: CycleUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };

export function resetCycleUsage(): void {
  cycleUsage = { inputTokens: 0, outputTokens: 0, cost: 0 };
}

export function getCycleUsage(): CycleUsage {
  return { ...cycleUsage };
}

/** Returns a snapshot that can be diffed against a later getCycleUsage() call. */
export function snapshotUsage(): CycleUsage {
  return { ...cycleUsage };
}

export function diffUsage(before: CycleUsage, after: CycleUsage): CycleUsage {
  return {
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    cost: after.cost - before.cost,
  };
}

export async function callConversation(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: CallSkillOptions,
): Promise<string> {
  const model = options?.model ?? CONFIG.anthropic.model;
  const maxTokens = options?.maxTokens ?? 1024;

  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens;
  const pricing = PRICING[model] ?? DEFAULT_PRICING;
  const cost = (input * pricing.input + output * pricing.output) / 1_000_000;

  cycleUsage.inputTokens += input;
  cycleUsage.outputTokens += output;
  cycleUsage.cost += cost;

  return text;
}

export async function callSkill(
  systemPrompt: string,
  userContent: string | ContentBlock[],
  options?: CallSkillOptions,
): Promise<string> {
  const model = options?.model ?? CONFIG.anthropic.model;
  const maxTokens = options?.maxTokens ?? 4096;

  const content =
    typeof userContent === "string"
      ? userContent
      : userContent;

  const imageCount =
    typeof content === "string"
      ? 0
      : content.filter((b) => b.type === "image").length;
  const label = imageCount > 0 ? ` with ${imageCount} images` : "";
  console.log(
    `  [anthropic] Calling ${model} (max ${maxTokens} tokens${label})...`,
  );

  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // Track usage
  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens;
  const pricing = PRICING[model] ?? DEFAULT_PRICING;
  const cost = (input * pricing.input + output * pricing.output) / 1_000_000;

  cycleUsage.inputTokens += input;
  cycleUsage.outputTokens += output;
  cycleUsage.cost += cost;

  console.log(
    `  [anthropic] Response: ${input} in / ${output} out ($${cost.toFixed(4)})`,
  );
  return text;
}
