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
    maxCompletionTokens: 2500,
    temperature: 0.55,
    verify: false,
  },
  balanced: {
    label: "Balanced",
    model: FAST_MODEL,
    reasoningEffort: "medium",
    maxCompletionTokens: 4500,
    temperature: 0.6,
    verify: false,
  },
  deep: {
    label: "Deep",
    model: DEEP_MODEL,
    reasoningEffort: "medium",
    maxCompletionTokens: 7500,
    temperature: 0.52,
    verify: false,
  },
  max: {
    label: "Max",
    model: DEEP_MODEL,
    reasoningEffort: "high",
    maxCompletionTokens: 11000,
    temperature: 0.48,
    verify: true,
  },
};

export function normalizeThinkingMode(value: unknown): ThinkingMode {
  if (value === "auto" || value === "fast" || value === "balanced" || value === "deep" || value === "max") {
    return value;
  }
  return "auto";
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
