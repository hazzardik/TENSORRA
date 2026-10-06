import { productionModelFor } from "./model-registry";
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

const FAST_MODEL = productionModelFor("fast");
const DEEP_MODEL = productionModelFor("deep");

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
      "For definition/translation/short-answer requests, usually stay within 1-3 sentences unless the user asks for examples.",
      "Do not add formulas, legal caveats, platform details, or broad exploration unless they materially help the request.",
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
      "Depth means better reasoning, not a longer final answer. Default to a compact complete response and expand only when the user asks for detail.",
      "Avoid repetitive sub-bullets, generic legal caveats, or speculative platform rules that were not requested.",
      "Give a structured answer with stronger justification and more depth than BALANCED.",
      "Do not reveal private chain-of-thought; provide conclusions and concise supporting rationale instead.",
    ].join(" ");
  }

  return [
    "Thinking profile: MAXIMUM.",
    "Use a rigorous multi-pass approach before answering. Check assumptions, compare alternatives, consider counterarguments, edge cases, risks, and verification needs.",
    "Prefer completeness and robustness over speed, while keeping the final response organized and readable. Completeness does not mean padding: remove repetition and unsupported caveats.",
    "Do not reveal private chain-of-thought; provide conclusions, evidence, checks, and concise rationale instead.",
  ].join(" ");
}

export type AutoThinkingDecision = {
  mode: ConcreteThinkingMode;
  score: number;
  reasons: string[];
};

const includesAny = (text: string, signals: string[]) =>
  signals.some((signal) => text.includes(signal));

export function resolveAutoThinkingDecision(
  message: string,
  options?: { hasAttachment?: boolean; vision?: boolean },
): AutoThinkingDecision {
  const text = message.toLocaleLowerCase();
  const length = message.length;
  let score = 0;
  const reasons: string[] = [];

  if (length > 700) {
    score += 1;
    reasons.push("long");
  }
  if (length > 1800) {
    score += 2;
    reasons.push("very-long");
  }
  if (length > 4200) {
    score += 2;
    reasons.push("large-context");
  }

  const analysisSignals = [
    "сравни", "проанализируй", "разбери", "почему", "обоснуй", "докажи",
    "стратег", "архитект", "спроектируй", "разработай", "риски", "trade-off",
    "compare", "analyze", "why", "strategy", "architecture", "design", "prove",
  ];
  if (includesAny(text, analysisSignals)) {
    score += 2;
    reasons.push("analysis");
  }

  const technicalSignals = [
    "код", "ошибка", "debug", "уязвим", "security", "математ", "алгоритм",
    "формула", "статистик", "данные", "api", "database", "sql", "typescript",
    "python", "javascript", "react", "next.js",
  ];
  if (includesAny(text, technicalSignals)) {
    score += 2;
    reasons.push("technical");
  }

  const verificationSignals = [
    "проверь", "перепроверь", "точно", "критически", "контраргумент",
    "исследование", "research", "verify", "fact-check", "rigorous", "максимально подробно",
  ];
  if (includesAny(text, verificationSignals)) {
    score += 2;
    reasons.push("verification");
  }

  const multiStepSignals = [
    "пошагово", "план действий", "несколько вариантов", "варианты решения",
    "плюсы и минусы", "этапы", "roadmap", "step by step", "pros and cons",
  ];
  if (includesAny(text, multiStepSignals)) {
    score += 2;
    reasons.push("multi-step");
  }

  const questionCount = (message.match(/[?？]/g) ?? []).length;
  if (questionCount >= 3) {
    score += 1;
    reasons.push("multi-question");
  }

  if (options?.hasAttachment) {
    score += 2;
    reasons.push("attachment");
  }
  if (options?.vision) {
    score += 1;
    reasons.push("vision");
  }

  const fastSignals = [
    "кратко", "коротко", "быстро", "одним словом", "переведи", "что значит",
    "brief", "short answer", "translate",
  ];
  if (length < 320 && includesAny(text, fastSignals)) {
    score -= 3;
    reasons.push("explicit-fast");
  }

  const maxSignals = [
    "максимум", "максимально глубоко", "глубокое исследование", "deep research",
    "проанализируй полностью", "design the architecture",
  ];
  if (includesAny(text, maxSignals)) {
    score += 4;
    reasons.push("max-signal");
  }

  const mode: ConcreteThinkingMode =
    score <= -1 ? "fast" :
    score <= 2 ? "balanced" :
    score <= 6 ? "deep" :
    "max";

  return { mode, score, reasons };
}

export function resolveAutoThinkingMode(message: string): ConcreteThinkingMode {
  return resolveAutoThinkingDecision(message).mode;
}
