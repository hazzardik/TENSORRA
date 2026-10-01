import { ModelConfig } from "./model-router";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function providerConfig() {
  const baseUrl = (process.env.AI_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const apiKey = process.env.GROQ_API_KEY ?? process.env.AI_API_KEY;
  return { baseUrl, apiKey };
}

export async function createVerificationBrief(
  messages: ChatMessage[],
  config: ModelConfig,
  signal?: AbortSignal,
) {
  const provider = providerConfig();
  if (!provider.apiKey) return "";

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      temperature: 0.2,
      max_completion_tokens: 1400,
      reasoning_effort: "high",
      include_reasoning: false,
      response_format: { type: "json_object" },
      messages,
    }),
    cache: "no-store",
    signal,
  });

  if (!response.ok) return "";
  const data = await response.json().catch(() => null) as
    | { choices?: Array<{ message?: { content?: string | null } }> }
    | null;
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function extractMemoriesWithModel(prompt: string, signal?: AbortSignal) {
  const provider = providerConfig();
  if (!provider.apiKey) return [] as Array<{ content: string; category: string; importance: number }>;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.TENSORRA_FAST_MODEL ?? "openai/gpt-oss-20b",
      stream: false,
      temperature: 0.1,
      max_completion_tokens: 700,
      reasoning_effort: "low",
      include_reasoning: false,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    cache: "no-store",
    signal,
  });

  if (!response.ok) return [];
  const data = await response.json().catch(() => null) as
    | { choices?: Array<{ message?: { content?: string | null } }> }
    | null;
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as { memories?: Array<Record<string, unknown>> };
    return (parsed.memories ?? [])
      .map((item) => ({
        content: typeof item.content === "string" ? item.content.trim().slice(0, 1200) : "",
        category: typeof item.category === "string" ? item.category.slice(0, 40) : "fact",
        importance: Math.max(1, Math.min(10, Number(item.importance) || 5)),
      }))
      .filter((item) => item.content.length >= 3)
      .slice(0, 4);
  } catch {
    return [];
  }
}
