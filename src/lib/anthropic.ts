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

  console.log(
    `  [anthropic] Response: ${text.length} chars, stop=${response.stop_reason}`,
  );
  return text;
}
