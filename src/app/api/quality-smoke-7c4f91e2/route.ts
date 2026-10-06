import { NextRequest } from "next/server";
import { providerConfig } from "@/lib/tensorra/provider";
import { buildSystemPrompt } from "@/lib/tensorra/prompt";
import { THINKING_MODES, thinkingInstructionForMode } from "@/lib/tensorra/model-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CASES = [
  {
    id: "short-ebitda",
    prompt: "Кратко: что такое EBITDA?",
    mode: "fast" as const,
  },
  {
    id: "side-hustles",
    prompt: "Предложи 8 способов подработки школьнику: что нужно, сколько можно заработать, первые шаги и риски.",
    mode: "deep" as const,
  },
  {
    id: "math-render",
    prompt: "Реши систему x+y=5, x-y=1 и затем запиши матрицу A = [[1,2],[3,4]] красиво.",
    mode: "balanced" as const,
  },
  {
    id: "code",
    prompt: "Напиши короткую функцию Python, которая возвращает медиану списка чисел.",
    mode: "balanced" as const,
  },
  {
    id: "study-2025",
    prompt: "Составь тренировочный вариант ЕГЭ 2025 года по профильной математике с оригинальными заданиями того же типа и ответами.",
    mode: "deep" as const,
    study: true,
  },
  {
    id: "plan-no-json",
    prompt: "Дай план запуска Telegram-канала про бизнес для школьников: позиционирование, контент, рост и монетизация.",
    mode: "deep" as const,
  },
];

function lint(answer: string, prompt: string) {
  const lower = answer.toLocaleLowerCase();
  const issues: string[] = [];
  const trimmed = answer.trim();

  if (!prompt.toLocaleLowerCase().includes("json") && (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  )) issues.push("raw-json");

  if (/^\s*\$\s*$/m.test(answer)) issues.push("stray-dollar");
  if (!answer.includes("$") && /\\(?:sqrt|frac|dfrac|begin\{|end\{)/.test(answer)) {
    issues.push("raw-latex");
  }

  if ([
    "router_reason",
    "planner_used",
    "tool_notes",
    "answer_shape",
    "key_points",
  ].some((key) => lower.includes(key))) issues.push("internal-leak");

  const tableLines = answer.split("\n").filter((line) => line.includes("|"));
  const maxColumns = tableLines.reduce((max, line) => {
    const count = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;
    return Math.max(max, count);
  }, 0);
  if (maxColumns > 5) issues.push(`wide-table:${maxColumns}`);

  if (/извините, но я не могу|я не могу помочь с этим|не могу выполнить этот запрос/i.test(answer)) {
    issues.push("possible-refusal");
  }

  return { issues, chars: answer.length, maxColumns };
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("k") !== "qv22-6f9c2a71") {
    return new Response("Not found", { status: 404 });
  }

  const provider = providerConfig();
  if (!provider.apiKey) {
    return Response.json({ error: "provider_not_configured" }, { status: 503 });
  }

  const results = [];
  for (const item of CASES) {
    const config = THINKING_MODES[item.mode];
    const systemPrompt = [
      buildSystemPrompt([], [], undefined, {
        autonomousTools: false,
        studyGeneration: Boolean(item.study),
      }),
      thinkingInstructionForMode(item.mode),
    ].join("\n\n");

    const started = Date.now();
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: config.temperature,
        max_completion_tokens: Math.min(config.maxCompletionTokens, 3200),
        reasoning_effort: config.reasoningEffort,
        include_reasoning: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: item.prompt },
        ],
      }),
      cache: "no-store",
    });

    const data = await response.json().catch(() => null) as
      | { choices?: Array<{ message?: { content?: string | null } }> }
      | null;
    const answer = data?.choices?.[0]?.message?.content?.trim() ?? "";

    results.push({
      id: item.id,
      status: response.status,
      latencyMs: Date.now() - started,
      model: config.model,
      lint: lint(answer, item.prompt),
      answer,
    });
  }

  return Response.json(
    { testedAt: new Date().toISOString(), results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
