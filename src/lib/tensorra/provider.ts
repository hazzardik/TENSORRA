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


type VerificationAudit = {
  pass?: boolean;
  issues?: unknown[];
  missing?: unknown[];
  revision_instructions?: unknown[];
};

async function runStructuredHelper(args: {
  prompt: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  maxCompletionTokens: number;
  signal?: AbortSignal;
}) {
  const provider = providerConfig();
  if (!provider.apiKey) return "";

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      stream: false,
      temperature: 0.15,
      max_completion_tokens: args.maxCompletionTokens,
      reasoning_effort: args.reasoningEffort,
      include_reasoning: false,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: args.prompt }],
    }),
    cache: "no-store",
    signal: args.signal,
  });

  if (!response.ok) return "";
  const data = await response.json().catch(() => null) as
    | { choices?: Array<{ message?: { content?: string | null } }> }
    | null;
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function createPlanningBrief(
  prompt: string,
  signal?: AbortSignal,
) {
  return runStructuredHelper({
    prompt,
    model: process.env.TENSORRA_FAST_MODEL ?? "openai/gpt-oss-20b",
    reasoningEffort: "medium",
    maxCompletionTokens: 1000,
    signal,
  });
}

export async function createConversationSummary(
  prompt: string,
  signal?: AbortSignal,
) {
  return runStructuredHelper({
    prompt,
    model: process.env.TENSORRA_FAST_MODEL ?? "openai/gpt-oss-20b",
    reasoningEffort: "low",
    maxCompletionTokens: 1200,
    signal,
  });
}

export async function verifyAndReviseAnswer(args: {
  verificationPrompt: string;
  revisionPrompt: string;
  systemPrompt: string;
  config: ModelConfig;
  draft: string;
  signal?: AbortSignal;
}) {
  const verification = await runStructuredHelper({
    prompt: args.verificationPrompt,
    model: args.config.model,
    reasoningEffort: "high",
    maxCompletionTokens: 1400,
    signal: args.signal,
  });

  if (!verification) {
    return {
      answer: args.draft,
      verification: "",
      verified: false,
      revised: false,
    };
  }

  let audit: VerificationAudit | null = null;
  try {
    audit = JSON.parse(verification) as VerificationAudit;
  } catch {
    audit = null;
  }

  const hasIssues =
    audit?.pass === false ||
    Boolean(audit?.issues?.length) ||
    Boolean(audit?.missing?.length) ||
    Boolean(audit?.revision_instructions?.length);

  if (!hasIssues) {
    return {
      answer: args.draft,
      verification,
      verified: true,
      revised: false,
    };
  }

  const provider = providerConfig();
  if (!provider.apiKey) {
    return {
      answer: args.draft,
      verification,
      verified: false,
      revised: false,
    };
  }

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: args.config.model,
      stream: false,
      temperature: Math.min(args.config.temperature, 0.35),
      max_completion_tokens: args.config.maxCompletionTokens,
      reasoning_effort: "high",
      include_reasoning: false,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.revisionPrompt },
      ],
    }),
    cache: "no-store",
    signal: args.signal,
  });

  if (!response.ok) {
    return {
      answer: args.draft,
      verification,
      verified: false,
      revised: false,
    };
  }

  const data = await response.json().catch(() => null) as
    | { choices?: Array<{ message?: { content?: string | null } }> }
    | null;
  const revised = data?.choices?.[0]?.message?.content?.trim();

  return {
    answer: revised || args.draft,
    verification,
    verified: Boolean(revised),
    revised: Boolean(revised),
  };
}
