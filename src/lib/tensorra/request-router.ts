import type { ConcreteThinkingMode, ThinkingMode } from "./model-router";
import { resolveAutoThinkingDecision } from "./model-router";

export type RequestPlan = {
  effectiveMode: ConcreteThinkingMode;
  useWeb: boolean;
  useCode: boolean;
  useMemory: boolean;
  useKnowledge: boolean;
  extractMemory: boolean;
  complexityScore: number;
  reason: string[];
};

const includesAny = (text: string, signals: string[]) =>
  signals.some((signal) => text.includes(signal));

export function planRequest(args: {
  message: string;
  requestedMode: ThinkingMode;
  hasAttachedDocument: boolean;
}): RequestPlan {
  const text = args.message.toLocaleLowerCase();
  const reason: string[] = [];

  const explicitWeb = includesAny(text, [
    "найди в интернете", "поищи в интернете", "проверь в интернете", "в интернете",
    "официальный сайт", "актуальная информация", "актуально", "сегодня", "сейчас",
    "последние новости", "новости", "последние данные", "курс", "цена сейчас",
    "latest", "today", "current", "news", "search the web", "look up",
  ]);

  const currentness = includesAny(text, [
    "сегодня", "сейчас", "на данный момент", "последн", "актуальн", "новост",
    "кто сейчас", "какой сейчас", "сколько сейчас", "current", "latest", "today",
  ]);

  const codeSignals = includesAny(text, [
    "посчитай", "вычисли", "рассчитай", "процент", "статистик", "таблиц",
    "python", "код", "алгоритм", "csv", "данные", "график", "формула",
    "calculate", "compute", "python", "code", "dataset", "csv",
  ]);

  const memorySignals = includesAny(text, [
    "помнишь", "мы обсуждали", "раньше", "до этого", "мой план", "мои цели",
    "мне нравится", "я предпочитаю", "как я говорил", "про меня", "мой проект",
    "мой стартап", "remember", "earlier", "my plan", "my goals", "my project",
  ]);

  const knowledgeSignals = includesAny(text, [
    "файл", "документ", "pdf", "в документе", "в файле", "прикреп",
    "этот материал", "эта презентация", "этот текст", "business idea", "документе",
  ]);

  const durableMemorySignals = includesAny(text, [
    "запомни", "помни что", "я предпочитаю", "мне нравится", "моя цель",
    "я планирую", "в будущем", "всегда отвечай", "не забывай",
    "remember", "my preference", "my goal", "i plan",
  ]);

  const autoDecision = resolveAutoThinkingDecision(
    args.message,
    { hasAttachment: args.hasAttachedDocument },
  );

  const effectiveMode: ConcreteThinkingMode =
    args.requestedMode === "auto"
      ? autoDecision.mode
      : args.requestedMode;

  const complexityScore =
    args.requestedMode === "auto"
      ? autoDecision.score
      : 0;

  if (args.requestedMode === "auto") {
    reason.push(...autoDecision.reasons.map((item) => `auto:${item}`));
    reason.push(`auto-score:${autoDecision.score}`);
  } else {
    reason.push(`manual-mode:${args.requestedMode}`);
  }

  const useWeb = explicitWeb || currentness;
  const useCode = codeSignals;
  const useMemory = memorySignals;
  const useKnowledge = args.hasAttachedDocument || knowledgeSignals;
  const extractMemory = durableMemorySignals;

  if (useWeb) reason.push("web");
  if (useCode) reason.push("code");
  if (useMemory) reason.push("memory");
  if (useKnowledge) reason.push("knowledge");
  if (extractMemory) reason.push("memory-write");

  return {
    effectiveMode,
    useWeb,
    useCode,
    useMemory,
    useKnowledge,
    extractMemory,
    complexityScore,
    reason,
  };
}
