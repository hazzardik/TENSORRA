export type ThinkingMode = "auto" | "fast" | "balanced" | "deep" | "max";
export type ConcreteThinkingMode = Exclude<ThinkingMode, "auto">;

export type ModelConfig = {
  label: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  maxCompletionTokens: number;
  temperature: number;
  verify: boolean;
};

const FAST_MODEL = process.env.TENSORRA_FAST_MODEL ?? "openai/gpt-oss-20b";
const DEEP_MODEL = process.env.TENSORRA_DEEP_MODEL ?? "openai/gpt-oss-120b";

export const THINKING_MODES: Record<ConcreteThinkingMode, ModelConfig> = {
  fast: {
    label: "Fast",
    model: FAST_MODEL,
    reasoningEffort: "low",
    maxCompletionTokens: 1200,
    temperature: 0.62,
    verify: false,
  },
  balanced: {
    label: "Balanced",
    model: FAST_MODEL,
    reasoningEffort: "medium",
    maxCompletionTokens: 2600,
    temperature: 0.56,
    verify: false,
  },
  deep: {
    label: "Deep",
    model: DEEP_MODEL,
    reasoningEffort: "high",
    maxCompletionTokens: 4600,
    temperature: 0.48,
    verify: false,
  },
  max: {
    label: "Max",
    model: DEEP_MODEL,
    reasoningEffort: "high",
    maxCompletionTokens: 6500,
    temperature: 0.42,
    verify: true,
  },
};

export function normalizeThinkingMode(value: unknown): ThinkingMode {
  if (value === "auto" || value === "fast" || value === "balanced" || value === "deep" || value === "max") {
    return value;
  }
  return "auto";
}


export function thinkingInstructionForMode(mode: ConcreteThinkingMode) {
  if (mode === "fast") {
    return [
      "Thinking profile: FAST.",
      "Answer directly and efficiently. Prefer a short, useful answer over exhaustive coverage.",
      "Do not skip necessary facts, but avoid unnecessary branches, long caveats, or broad exploration.",
    ].join(" ");
  }

  if (mode === "balanced") {
    return [
      "Thinking profile: BALANCED.",
      "Reason carefully, identify the main trade-offs, and give a practical structured answer.",
      "Cover the important alternatives without turning the response into an exhaustive research report.",
    ].join(" ");
  }

  if (mode === "deep") {
    return [
      "Thinking profile: DEEP.",
      "Analyze the problem from multiple angles. Challenge weak assumptions, surface meaningful trade-offs, failure modes, and alternatives.",
      "Give a structured answer with stronger justification and more depth than BALANCED.",
      "Do not reveal private chain-of-thought; provide conclusions and concise supporting rationale instead.",
    ].join(" ");
  }

  return [
    "Thinking profile: MAXIMUM.",
    "Use a rigorous multi-pass approach before answering. Check assumptions, compare alternatives, consider counterarguments, edge cases, risks, and verification needs.",
    "Prefer completeness and robustness over speed, while keeping the final response organized and readable.",
    "Do not reveal private chain-of-thought; provide conclusions, evidence, checks, and concise rationale instead.",
  ].join(" ");
}

export function resolveAutoThinkingMode(message: string): ConcreteThinkingMode {
  const text = message.toLocaleLowerCase();
  const length = message.length;

  const maxSignals = [
    "глубоко", "максимально подробно", "исследуй", "исследование", "архитектур", "докажи",
    "проанализируй полностью", "deep research", "rigorous", "prove", "design the architecture",
  ];
  if (length > 4500 || maxSignals.some((signal) => text.includes(signal))) return "max";

  const deepSignals = [
    "сравни", "проанализируй", "почему", "код", "ошибка", "уязвим", "математ", "алгоритм",
    "latest", "сейчас", "сегодня", "актуаль", "compare", "analyze", "debug", "security", "research",
  ];
  if (length > 1400 || deepSignals.some((signal) => text.includes(signal))) return "deep";

  const fastSignals = ["кратко", "быстро", "одним словом", "переведи", "что значит", "коротко", "brief", "translate"];
  if (length < 260 && fastSignals.some((signal) => text.includes(signal))) return "fast";

  return "balanced";
}
