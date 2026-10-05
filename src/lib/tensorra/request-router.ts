import type { ConcreteThinkingMode, ThinkingMode } from "./model-router";
import { resolveAutoThinkingDecision } from "./model-router";

export type RequestPlan = {
  effectiveMode: ConcreteThinkingMode;
  useWeb: boolean;
  useCode: boolean;
  useMemory: boolean;
  useKnowledge: boolean;
  extractMemory: boolean;
  studyGeneration: boolean;
  exportFormat: "pdf" | null;
  complexityScore: number;
  reason: string[];
};

const includesAny = (text: string, signals: string[]) =>
  signals.some((signal) => text.includes(signal));

export function planRequest(args: {
  message: string;
  requestedMode: ThinkingMode;
  hasAttachedDocument: boolean;
  recentContext?: string;
}): RequestPlan {
  const text = args.message.toLocaleLowerCase();
  const contextText = (args.recentContext ?? "").toLocaleLowerCase();
  const reason: string[] = [];

  const continuationSignals = includesAny(text, [
    "а если", "а теперь", "а 20", "тогда", "так же", "также",
    "сделай это", "сделай так", "продолж", "еще", "ещё",
    "в pdf", "в пдф", "такой же", "тот же", "по этому", "из этих",
    "what about", "then", "same", "continue", "do that",
  ]);

  const continuationStart =
    /^(?:а\b|и\b|да\b|нет\b|тогда\b|ещ[её]\b|продолж|сделай|добавь|измени|переделай|так\s*же|также|тот\s*же|такой\s*же|в\s+(?:pdf|пдф))/i.test(text.trim());

  const isLikelyContinuation =
    text.length <= 320 &&
    (continuationSignals || continuationStart);

  const routedText = isLikelyContinuation && contextText
    ? `${contextText.slice(-5000)}\n${text}`
    : text;

  const explicitWeb = includesAny(routedText, [
    "найди в интернете", "поищи в интернете", "проверь в интернете", "в интернете",
    "официальный сайт", "актуальная информация", "актуально", "сегодня", "сейчас",
    "нынешн", "текущ", "последние новости", "новости", "последние данные",
    "фипи", "егэ 2026", "егэ 2027", "демоверси", "кодификатор", "спецификац",
    "latest", "today", "current", "news", "search the web", "look up",
  ]);

  const currentness = includesAny(routedText, [
    "сегодня", "сейчас", "на данный момент", "последн", "актуальн", "нынешн",
    "текущ", "новост", "кто сейчас", "какой сейчас", "сколько сейчас",
    "демоверси", "кодификатор", "спецификац", "current", "latest", "today",
  ]);

  const codeSignals = includesAny(routedText, [
    "посчитай", "вычисли", "рассчитай", "процент", "статистик", "таблиц",
    "python", "код", "алгоритм", "csv", "данные", "график", "формула",
    "calculate", "compute", "python", "code", "dataset", "csv",
  ]);

  const memorySignals = includesAny(routedText, [
    "помнишь", "мы обсуждали", "раньше", "до этого", "мой план", "мои цели",
    "мне нравится", "я предпочитаю", "как я говорил", "про меня", "мой проект",
    "мой стартап", "remember", "earlier", "my plan", "my goals", "my project",
  ]);

  const personalDecisionSignals = includesAny(routedText, [
    "для меня", "мне стоит", "мне лучше", "посоветуй мне", "мой проект",
    "мой стартап", "мой план", "моя цель", "мои цели", "я хочу", "я планирую",
    "for me", "should i", "my project", "my startup", "my plan", "my goal", "i want",
  ]);

  const knowledgeSignals = includesAny(routedText, [
    "файл", "документ", "pdf", "в документе", "в файле", "прикреп",
    "этот материал", "эта презентация", "этот текст", "business idea", "документе",
  ]);

  const durableMemorySignals = includesAny(text, [
    "запомни", "помни что", "я предпочитаю", "мне нравится", "моя цель",
    "я планирую", "в будущем", "всегда отвечай", "не забывай",
    "remember", "my preference", "my goal", "i plan",
  ]);


  const studyGeneration = (
    includesAny(routedText, [
      "егэ", "огэ", "фипи", "вариант", "пробник", "тренировочн",
      "домашн", "контрольн", "тест", "задани", "study guide", "mock exam",
      "practice test",
    ]) &&
    includesAny(routedText, [
      "состав", "созда", "сделай", "подготов", "сгенер", "придум",
      "собери", "generate", "create", "make",
    ])
  );

  const exportFormat: "pdf" | null = includesAny(routedText, [
    "в pdf", "в пдф", "pdf-файл", "pdf файл", "скинь pdf", "скинь в pdf",
    "download pdf", "as pdf",
  ]) ? "pdf" : null;

  const autoDecision = resolveAutoThinkingDecision(
    args.message,
    { hasAttachment: args.hasAttachedDocument },
  );

  let effectiveMode: ConcreteThinkingMode =
    args.requestedMode === "auto"
      ? autoDecision.mode
      : args.requestedMode;

  if (
    args.requestedMode === "auto" &&
    studyGeneration &&
    (effectiveMode === "fast" || effectiveMode === "balanced")
  ) {
    effectiveMode = "deep";
  }

  const complexityScore =
    args.requestedMode === "auto"
      ? autoDecision.score + (studyGeneration ? 3 : 0)
      : 0;

  if (args.requestedMode === "auto") {
    reason.push(...autoDecision.reasons.map((item) => `auto:${item}`));
    reason.push(`auto-score:${autoDecision.score}`);
    if (studyGeneration && effectiveMode === "deep") {
      reason.push("study-quality:deep");
    }
  } else {
    reason.push(`manual-mode:${args.requestedMode}`);
  }

  const yearReference = /\b20(?:2\d|3\d)\b/.test(text);
  const useWeb =
    explicitWeb ||
    currentness ||
    (studyGeneration && routedText.includes("фипи")) ||
    (studyGeneration && yearReference);
  const useCode =
    codeSignals ||
    (studyGeneration && includesAny(routedText, [
      "математ", "алгебр", "геометр", "вероятност", "статист", "физик",
      "math", "algebra", "geometry", "probability", "statistics", "physics",
    ]));
  const useMemory = memorySignals || personalDecisionSignals;
  const useKnowledge = args.hasAttachedDocument || knowledgeSignals;
  const extractMemory = durableMemorySignals;

  if (useWeb) reason.push("web");
  if (useCode) reason.push("code");
  if (useMemory) reason.push(personalDecisionSignals ? "memory-context" : "memory");
  if (useKnowledge) reason.push("knowledge");
  if (extractMemory) reason.push("memory-write");
  if (studyGeneration) reason.push("study-generation");
  if (isLikelyContinuation && contextText) reason.push("contextual-follow-up");
  if (exportFormat) reason.push(`export:${exportFormat}`);

  return {
    effectiveMode,
    useWeb,
    useCode,
    useMemory,
    useKnowledge,
    extractMemory,
    studyGeneration,
    exportFormat,
    complexityScore,
    reason,
  };
}
