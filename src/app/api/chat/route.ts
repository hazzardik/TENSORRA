import { createClient } from "@/lib/supabase/server";
import { createChatTitle, extractMemory } from "@/lib/memory";
import {
  normalizeThinkingMode,
  THINKING_MODES,
  thinkingInstructionForMode,
  type ConcreteThinkingMode,
} from "@/lib/tensorra/model-router";
import { planRequest } from "@/lib/tensorra/request-router";
import {
  buildConversationSummaryPrompt,
  buildMemoryExtractionPrompt,
  buildPlanningPrompt,
  buildPostVerificationPrompt,
  buildSystemPrompt,
} from "@/lib/tensorra/prompt";
import {
  createConversationSummary,
  createPlanningBrief,
  extractMemoriesWithModel,
  providerConfig,
  verifyAndReviseAnswer,
} from "@/lib/tensorra/provider";
import {
  searchKnowledge,
  searchSemanticMemories,
  upsertSemanticMemory,
} from "@/lib/tensorra/qdrant";
import { providerTools } from "@/lib/tensorra/tools";
import { normalizePlan } from "@/lib/tensorra/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredMessage = { role: "user" | "assistant"; content: string };
type ProviderChunk = { choices?: Array<{ delta?: { content?: string | null } }> };
type MemoryItem = {
  content: string;
  category?: string | null;
  importance?: number | null;
  score?: number | null;
  createdAt?: string | null;
};
type KnowledgeItem = { content: string; filename?: string | null; score?: number | null };
type DocumentChunk = { document_id: string; content: string; chunk_index: number };

type ToolExecution = {
  type?: string;
  name?: string;
  arguments?: unknown;
  result?: unknown;
  search_results?: {
    results?: Array<{ title?: string; url?: string; score?: number; content?: string }>;
  };
  code_results?: Array<{ text?: string }>;
};

type ResearchSource = {
  title: string;
  url: string;
  score?: number;
};

async function loadRelevantMemories(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  query: string,
): Promise<MemoryItem[]> {
  const semantic = await searchSemanticMemories(userId, query, 12).catch(() => []);
  const { data: recent } = await supabase
    .from("memories")
    .select("content,category,importance,created_at")
    .eq("user_id", userId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(12);

  const combined: MemoryItem[] = [
    ...semantic.map((item) => ({
      content: item.content,
      category: item.category,
      importance: item.importance,
      score: item.score,
      createdAt: item.createdAt,
    })),
    ...((recent ?? []).map((item: {
      content: string;
      category?: string | null;
      importance?: number | null;
      created_at?: string | null;
    }) => ({
      content: item.content,
      category: item.category,
      importance: item.importance,
      score: 0,
      createdAt: item.created_at,
    }))),
  ];

  const merged = new Map<string, MemoryItem>();
  for (const item of combined) {
    const key = item.content.toLocaleLowerCase().trim();
    if (!key) continue;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    merged.set(key, {
      ...existing,
      importance: Math.max(existing.importance ?? 0, item.importance ?? 0),
      score: Math.max(existing.score ?? 0, item.score ?? 0),
      createdAt: existing.createdAt ?? item.createdAt,
    });
  }

  const now = Date.now();
  const ranked = [...merged.values()]
    .map((item) => {
      const ageDays = item.createdAt
        ? Math.max(0, (now - new Date(item.createdAt).getTime()) / 86_400_000)
        : 365;
      const recency = ageDays <= 7 ? 0.8 : ageDays <= 30 ? 0.4 : 0;
      const explicitBoost = item.category === "explicit" ? 1.1 : 0;
      const priority =
        (item.score ?? 0) * 5 +
        Math.min(10, Math.max(1, item.importance ?? 5)) * 0.45 +
        recency +
        explicitBoost;
      return { item, priority };
    })
    .sort((a, b) => b.priority - a.priority);

  const result: MemoryItem[] = [];
  let chars = 0;
  for (const { item } of ranked) {
    if (result.length >= 7 || chars >= 3200) break;
    const remaining = 3200 - chars;
    const content = item.content.slice(0, remaining).trim();
    if (!content) continue;
    result.push({ ...item, content });
    chars += content.length;
  }

  return result;
}

async function loadRelevantKnowledge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  chatId: string,
  query: string,
): Promise<KnowledgeItem[]> {
  const semantic = await searchKnowledge(userId, query, 6).catch(() => []);
  if (semantic.length) {
    const ids = [...new Set(semantic.map((item) => item.documentId).filter(Boolean))];
    const { data: existing } = ids.length
      ? await supabase
          .from("documents")
          .select("id")
          .eq("user_id", userId)
          .eq("source_chat_id", chatId)
          .in("id", ids)
      : { data: [] as Array<{ id: string }> };
    const allowed = new Set((existing ?? []).map((item: { id: string }) => item.id));
    const verified = semantic.filter((item) => item.documentId && allowed.has(item.documentId));
    if (verified.length) return verified.slice(0, 6);
  }

  const { data } = await supabase.rpc("search_document_chunks_lexical", {
    query_text: query,
    match_count: 6,
  });

  if (!data?.length) return [];
  const documentIds = [...new Set(data.map((item: { document_id: string }) => item.document_id))];
  const { data: docs } = await supabase
    .from("documents")
    .select("id,filename")
    .eq("user_id", userId)
    .eq("source_chat_id", chatId)
    .in("id", documentIds);

  const names = new Map(
    (docs ?? []).map((doc: { id: string; filename: string }) => [doc.id, doc.filename]),
  );

  return data
    .filter((item: { document_id: string }) => names.has(item.document_id))
    .map((item: { content: string; document_id: string; rank?: number }) => ({
      content: item.content,
      filename: names.get(item.document_id) ?? "документ",
      score: item.rank ?? 0,
    }));
}

function queryTerms(message: string) {
  const stop = new Set([
    "этот", "эта", "это", "этом", "этого", "этой", "разбери", "проанализируй",
    "расскажи", "пожалуйста", "файл", "документ", "идея", "бизнес", "what", "this",
    "that", "please", "analyze", "document", "file",
  ]);
  return [...new Set(
    (message.toLocaleLowerCase().match(/[a-zа-яё0-9]{4,}/gi) ?? [])
      .filter((term) => !stop.has(term)),
  )].slice(0, 16);
}

function selectAttachedKnowledge(
  chunks: DocumentChunk[],
  names: Map<string, string>,
  message: string,
): KnowledgeItem[] {
  if (!chunks.length) return [];

  const terms = queryTerms(message);
  const grouped = new Map<string, DocumentChunk[]>();
  for (const chunk of chunks) {
    const list = grouped.get(chunk.document_id) ?? [];
    list.push(chunk);
    grouped.set(chunk.document_id, list);
  }

  const selected = new Map<string, DocumentChunk>();

  for (const [documentId, list] of grouped) {
    const ordered = [...list].sort((a, b) => a.chunk_index - b.chunk_index);
    for (const item of ordered.slice(0, 2)) {
      selected.set(`${documentId}:${item.chunk_index}`, item);
    }
    const last = ordered.at(-1);
    if (last) selected.set(`${documentId}:${last.chunk_index}`, last);
  }

  const scored = chunks
    .map((chunk) => {
      const lower = chunk.content.toLocaleLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index);

  for (const item of scored) {
    if (selected.size >= 14) break;
    selected.set(
      `${item.chunk.document_id}:${item.chunk.chunk_index}`,
      item.chunk,
    );
  }

  let usedChars = 0;
  const maxChars = 11000;
  const result: KnowledgeItem[] = [];

  for (const chunk of [...selected.values()].sort((a, b) => {
    if (a.document_id === b.document_id) return a.chunk_index - b.chunk_index;
    return a.document_id.localeCompare(b.document_id);
  })) {
    if (usedChars >= maxChars) break;
    const remaining = maxChars - usedChars;
    const content = chunk.content.slice(0, remaining);
    if (!content.trim()) continue;
    result.push({
      content,
      filename: names.get(chunk.document_id) ?? "прикреплённый документ",
      score: 1,
    });
    usedChars += content.length;
  }

  return result;
}

function trimConversation(messages: StoredMessage[], maxChars = 6500) {
  const result: StoredMessage[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const content = item.content.length > remaining
      ? item.content.slice(item.content.length - remaining)
      : item.content;
    result.unshift({ ...item, content });
    used += content.length;
  }

  return result;
}


function contextBudgetForMode(mode: ConcreteThinkingMode) {
  if (mode === "fast") return 5200;
  if (mode === "balanced") return 8200;
  if (mode === "deep") return 12500;
  return 16500;
}

function partitionConversation(
  messages: StoredMessage[],
  recentBudget: number,
) {
  let used = 0;
  let start = messages.length;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const length = messages[index].content.length;
    if (used + length > recentBudget && start < messages.length) break;
    used += Math.min(length, Math.max(0, recentBudget - used));
    start = index;
    if (used >= recentBudget) break;
  }

  const recent = trimConversation(messages.slice(start), recentBudget);
  const older = messages.slice(0, start);
  return { older, recent };
}

function fallbackConversationSummary(messages: StoredMessage[]) {
  return messages
    .slice(-8)
    .map((item) => `${item.role}: ${item.content.slice(0, 450)}`)
    .join("\n")
    .slice(0, 3600);
}

async function saveMemory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  chatId: string,
  memory: { content: string; category: string; importance: number },
) {
  const { data: duplicate } = await supabase
    .from("memories")
    .select("id")
    .eq("user_id", userId)
    .eq("content", memory.content)
    .maybeSingle();
  if (duplicate) return;

  const { data: inserted, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      source_chat_id: chatId,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
    })
    .select("id")
    .single();

  if (!error && inserted?.id) {
    await upsertSemanticMemory({
      id: inserted.id,
      userId,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
    }).catch(() => false);
  }
}

async function saveAssistantMessage(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  chatId: string;
  content: string;
  modelName: string;
  requestedMode: string;
  effectiveMode: ConcreteThinkingMode;
  reasoningEffort: string;
  verified: boolean;
  toolsEnabled: string[];
  routerReason: string[];
  fellBack?: boolean;
  retried?: boolean;
  complexityScore?: number;
  plannerUsed?: boolean;
  contextSummaryUsed?: boolean;
  verifierUsed?: boolean;
  verifierRevised?: boolean;
  exportFormat?: "pdf" | null;
  sources?: ResearchSource[];
}) {
  await args.supabase.from("messages").insert({
    chat_id: args.chatId,
    user_id: args.userId,
    role: "assistant",
    content: args.content,
    model_name: args.modelName,
    metadata: {
      requested_mode: args.requestedMode,
      effective_mode: args.effectiveMode,
      reasoning_effort: args.reasoningEffort,
      verified: args.verified,
      tools_enabled: args.toolsEnabled,
      router_reason: args.routerReason,
      fallback: Boolean(args.fellBack),
      retried: Boolean(args.retried),
      complexity_score: args.complexityScore ?? null,
      planner_used: Boolean(args.plannerUsed),
      context_summary_used: Boolean(args.contextSummaryUsed),
      verifier_used: Boolean(args.verifierUsed),
      verifier_revised: Boolean(args.verifierRevised),
      export_format: args.exportFormat ?? null,
      sources: args.sources ?? [],
    },
  });

  await args.supabase
    .from("chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.chatId)
    .eq("user_id", args.userId);
}

function responseStreamFromText(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const parts = text.match(/.{1,72}(?:\s|$)|.{1,72}/gs) ?? [text];
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function providerFetch(args: {
  baseUrl: string;
  apiKey: string;
  payload: Record<string, unknown>;
  signal: AbortSignal;
}) {
  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

  const run = (payload: Record<string, unknown>) =>
    fetch(`${args.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: args.signal,
    });

  const pauseForRetry = async (response?: Response) => {
    const retryAfter = Number(response?.headers.get("retry-after") ?? "0");
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 2
        ? retryAfter * 1000
        : 650;
    await new Promise((resolve) => setTimeout(resolve, delay));
  };

  const fallbackModel =
    process.env.TENSORRA_FAST_MODEL ?? "openai/gpt-oss-20b";
  const fallbackPayload = {
    ...args.payload,
    model: fallbackModel,
    reasoning_effort: "low",
    max_completion_tokens: Math.min(
      Number(args.payload.max_completion_tokens ?? 3000),
      3000,
    ),
  };

  let modelUsed = String(args.payload.model ?? "");
  let retried = false;

  let response: Response;
  try {
    response = await run(args.payload);
  } catch (error) {
    if (args.signal.aborted) throw error;

    const fallback = await run(fallbackPayload);
    return {
      response: fallback,
      modelUsed: fallbackModel,
      fellBack: true,
      retried: false,
    };
  }

  if (response.ok || !retryableStatuses.has(response.status)) {
    return { response, modelUsed, fellBack: false, retried };
  }

  await response.text().catch(() => "");
  await pauseForRetry(response);
  retried = true;

  try {
    response = await run(args.payload);
  } catch (error) {
    if (args.signal.aborted) throw error;
    const fallback = await run(fallbackPayload);
    return {
      response: fallback,
      modelUsed: fallbackModel,
      fellBack: true,
      retried,
    };
  }

  if (response.ok || !retryableStatuses.has(response.status)) {
    return { response, modelUsed, fellBack: false, retried };
  }

  await response.text().catch(() => "");
  await pauseForRetry(response);

  response = await run(fallbackPayload);
  modelUsed = fallbackModel;

  return {
    response,
    modelUsed,
    fellBack: true,
    retried,
  };
}

function looksLikeFalseRefusal(text: string) {
  const sample = text.trim().toLocaleLowerCase().slice(0, 900);
  if (!sample) return false;

  const patterns = [
    "извините, но я не могу",
    "извини, но я не могу",
    "я не могу помочь с этим",
    "не могу помочь с этим",
    "я не могу выполнить",
    "не могу выполнить этот запрос",
    "i'm sorry, but i can't",
    "i cannot assist",
    "i can't help with that",
    "i cannot help with that",
  ];

  return text.length < 1400 && patterns.some((pattern) => sample.includes(pattern));
}

async function recoverBenignStudyAnswer(args: {
  baseUrl: string;
  apiKey: string;
  basePayload: Record<string, unknown>;
  tools?: Array<{ type: "browser_search" | "code_interpreter" }>;
  signal: AbortSignal;
}) {
  const messages = Array.isArray(args.basePayload.messages)
    ? args.basePayload.messages
    : [];

  const recoveryMessage = {
    role: "system",
    content:
      "Recovery instruction: the previous draft incorrectly refused a benign educational/document-generation request. Complete the original request now. Creating original practice exams, EGE/OGE mock materials, answer keys, explanations and document-ready content is allowed. If current FIPI/EGE format is requested, use available public evidence and create original aligned tasks rather than copying a protected bank. Do not mention the previous refusal or policy. If PDF export was requested, produce complete clean source content; the product UI performs the export.",
  };

  const { response } = await providerFetch({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    payload: {
      ...args.basePayload,
      stream: false,
      messages: [...messages, recoveryMessage],
      ...(args.tools?.length ? { tools: args.tools } : {}),
    },
    signal: args.signal,
  });

  if (!response.ok) return "";

  const data = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  } | null;

  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

async function providerError(response: Response) {
  if (response.status === 429) {
    return new Response(
      "Сейчас достигнут лимит запросов к модели. TENSORRA уже попробовала резервный режим. Подожди 20–60 секунд и отправь запрос ещё раз.",
      { status: 429 },
    );
  }

  const detail = await response.text().catch(() => "");
  if (detail) {
    console.warn("TENSORRA provider error", response.status, detail.slice(0, 1200));
  }

  return new Response(
    `Не удалось получить ответ от модели. Код ошибки: ${response.status || 502}.`,
    { status: response.status || 502 },
  );
}

async function extractDurableMemories(
  message: string,
  explicitMemory: string | null,
  args: {
    supabase: Awaited<ReturnType<typeof createClient>>;
    userId: string;
    chatId: string;
  },
) {
  const autoMemories = await extractMemoriesWithModel(
    buildMemoryExtractionPrompt(message),
  ).catch(() => []);

  for (const item of autoMemories) {
    if (
      explicitMemory &&
      item.content.toLocaleLowerCase() === explicitMemory.toLocaleLowerCase()
    ) continue;
    await saveMemory(args.supabase, args.userId, args.chatId, item);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) return new Response("Требуется вход в аккаунт.", { status: 401 });

  const body = await request.json().catch(() => null) as {
    chatId?: string;
    message?: string;
    documentIds?: string[];
    requestedMode?: unknown;
  } | null;

  const chatId = body?.chatId?.trim();
  const message = body?.message?.trim();
  const attachedDocumentIds = [...new Set(
    (body?.documentIds ?? []).filter(
      (id) => typeof id === "string" && id.length > 0,
    ),
  )].slice(0, 4);

  if (!chatId || !message) {
    return new Response("Не указан чат или сообщение.", { status: 400 });
  }
  if (message.length > 30000) {
    return new Response("Сообщение слишком длинное.", { status: 413 });
  }

  const [
    { data: chat, error: chatError },
    { data: subscription },
  ] = await Promise.all([
    supabase
      .from("chats")
      .select("id,title,mode")
      .eq("id", chatId)
      .eq("user_id", userId)
      .single(),
    supabase
      .from("subscriptions")
      .select("plan,status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const billingPlan = normalizePlan(subscription?.plan);

  if (chatError || !chat) {
    return new Response("Чат не найден.", { status: 404 });
  }

  const requestedMode = normalizeThinkingMode(
    body?.requestedMode ?? chat.mode,
  );

  const { data: attachedDocs } = attachedDocumentIds.length
    ? await supabase
        .from("documents")
        .select("id,filename")
        .eq("user_id", userId)
        .in("id", attachedDocumentIds)
    : { data: [] as Array<{ id: string; filename: string }> };

  const verifiedDocumentIds = (attachedDocs ?? []).map(
    (doc: { id: string }) => doc.id,
  );

  const plan = planRequest({
    message,
    requestedMode,
    hasAttachedDocument: verifiedDocumentIds.length > 0,
  });

  const effectiveMode = plan.effectiveMode;
  const modelConfig = THINKING_MODES[effectiveMode];

  const { error: insertError } = await supabase.from("messages").insert({
    chat_id: chatId,
    user_id: userId,
    role: "user",
    content: message,
    metadata: {
      attachments: (attachedDocs ?? []).map(
        (doc: { id: string; filename: string }) => ({
          kind: "document",
          document_id: doc.id,
          filename: doc.filename,
        }),
      ),
      router_reason: plan.reason,
      requested_mode: requestedMode,
      effective_mode: effectiveMode,
    },
  });

  if (insertError) {
    return new Response("Не удалось сохранить сообщение.", { status: 500 });
  }

  await supabase.from("chats").update({
    title: chat.title === "New chat" || chat.title === "Новый чат"
      ? createChatTitle(message)
      : chat.title,
    mode: requestedMode,
    updated_at: new Date().toISOString(),
  }).eq("id", chatId).eq("user_id", userId);

  const explicitMemory = extractMemory(message);
  if (explicitMemory) {
    await saveMemory(supabase, userId, chatId, {
      content: explicitMemory,
      category: "explicit",
      importance: 9,
    });
  }

  const historyPromise = supabase
    .from("messages")
    .select("role,content")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(60);

  const memoryPromise = plan.useMemory
    ? loadRelevantMemories(supabase, userId, message)
    : Promise.resolve([] as MemoryItem[]);

  const knowledgePromise =
    plan.useKnowledge && verifiedDocumentIds.length === 0
      ? loadRelevantKnowledge(supabase, userId, chatId, message)
      : Promise.resolve([] as KnowledgeItem[]);

  const attachedKnowledgePromise = verifiedDocumentIds.length
    ? supabase
        .from("document_chunks")
        .select("document_id,content,chunk_index")
        .eq("user_id", userId)
        .in("document_id", verifiedDocumentIds)
        .order("chunk_index", { ascending: true })
        .limit(96)
    : Promise.resolve({ data: [] as DocumentChunk[] });

  const [
    { data: history },
    relevantMemories,
    relevantKnowledge,
    { data: attachedChunks },
  ] = await Promise.all([
    historyPromise,
    memoryPromise,
    knowledgePromise,
    attachedKnowledgePromise,
  ]);

  const attachedNames = new Map(
    (attachedDocs ?? []).map(
      (doc: { id: string; filename: string }) => [doc.id, doc.filename],
    ),
  );

  const attachedKnowledge = selectAttachedKnowledge(
    (attachedChunks ?? []) as DocumentChunk[],
    attachedNames,
    message,
  );

  const mergedKnowledge = [...attachedKnowledge, ...relevantKnowledge]
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.content === item.content) === index,
    )
    .slice(0, 14);

  const chronological = ((history ?? []) as StoredMessage[]).reverse();
  const contextBudget = contextBudgetForMode(effectiveMode);
  const { older, recent } = partitionConversation(
    chronological,
    Math.floor(contextBudget * 0.72),
  );

  let contextSummary = "";
  if (older.length) {
    const olderText = older
      .map((item) => `${item.role}: ${item.content}`)
      .join("\n");

    const shouldModelSummarize =
      effectiveMode === "deep" ||
      effectiveMode === "max" ||
      olderText.length > 12000;

    contextSummary = shouldModelSummarize
      ? await createConversationSummary(
          buildConversationSummaryPrompt(olderText),
          request.signal,
        ).catch(() => fallbackConversationSummary(older))
      : fallbackConversationSummary(older);
  }

  const conversation = trimConversation(recent, contextBudget);
  const recentContext = conversation
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");

  const shouldPlan =
    effectiveMode === "deep" ||
    effectiveMode === "max" ||
    plan.complexityScore >= 5;

  const planningBrief = shouldPlan
    ? await createPlanningBrief(
        buildPlanningPrompt({
          userMessage: message,
          recentContext,
          contextSummary,
          mode: effectiveMode,
          routerReason: plan.reason,
        }),
        request.signal,
      ).catch(() => "")
    : "";

  const systemPrompt = [
    buildSystemPrompt(
      relevantMemories,
      mergedKnowledge,
      "",
      {
        autonomousTools: true,
        planningBrief,
        contextSummary,
        studyGeneration: plan.studyGeneration,
        exportFormat: plan.exportFormat,
      },
    ),
    thinkingInstructionForMode(effectiveMode),
  ].join("\n\n");

  const provider = providerConfig();
  if (!provider.apiKey) {
    return new Response("Ключ AI-провайдера не настроен.", { status: 500 });
  }

  const tools = providerTools({
    web: plan.useWeb,
    code: plan.useCode,
  });
  const toolNames = tools.map((tool) => tool.type);

  const basePayload = {
    model: modelConfig.model,
    temperature: modelConfig.temperature,
    top_p: 0.95,
    max_completion_tokens: modelConfig.maxCompletionTokens,
    reasoning_effort: modelConfig.reasoningEffort,
    include_reasoning: false,
    messages: [{ role: "system", content: systemPrompt }, ...conversation],
  };

  if (tools.length) {
    const { response: upstream, modelUsed, fellBack, retried } = await providerFetch({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      payload: { ...basePayload, stream: false, tools },
      signal: request.signal,
    });

    if (!upstream.ok) return providerError(upstream);

    const data = await upstream.json().catch(() => null) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          executed_tools?: ToolExecution[];
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;

    let answer = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) {
      return new Response("Модель вернула пустой ответ.", { status: 502 });
    }

    const executedTools = data?.choices?.[0]?.message?.executed_tools ?? [];
    const sourceMap = new Map<string, ResearchSource>();

    for (const tool of executedTools) {
      for (const result of tool.search_results?.results ?? []) {
        if (
          typeof result.url !== "string" ||
          !/^https?:\/\//i.test(result.url)
        ) continue;

        const url = result.url.slice(0, 2000);
        if (sourceMap.has(url)) continue;

        sourceMap.set(url, {
          title: (
            typeof result.title === "string" && result.title.trim()
              ? result.title.trim()
              : url
          ).slice(0, 240),
          url,
          score: typeof result.score === "number" ? result.score : undefined,
        });

        if (sourceMap.size >= 10) break;
      }
      if (sourceMap.size >= 10) break;
    }

    const sources = [...sourceMap.values()];

    let postVerified = false;
    let verifierRevised = false;

    if (effectiveMode === "max") {
      const evidence = executedTools
        .flatMap((tool) => [
          ...(tool.search_results?.results ?? []).map((item) => ({
            title: item.title,
            url: item.url,
            content: item.content,
          })),
          ...(tool.code_results ?? []).map((item) => ({ code_result: item.text })),
        ])
        .slice(0, 12);

      const verificationResult = await verifyAndReviseAnswer({
        verificationPrompt: buildPostVerificationPrompt({
          userMessage: message,
          draft: answer,
          recentContext,
          evidence: JSON.stringify(evidence),
        }),
        userMessage: message,
        systemPrompt,
        config: modelConfig,
        draft: answer,
        signal: request.signal,
      }).catch(() => ({
        answer,
        verification: "",
        verified: false,
        revised: false,
      }));

      answer = verificationResult.answer;
      postVerified = verificationResult.verified;
      verifierRevised = verificationResult.revised;
    }

    await saveAssistantMessage({
      supabase,
      userId,
      chatId,
      content: answer,
      modelName: modelUsed,
      requestedMode,
      effectiveMode,
      reasoningEffort: fellBack ? "low" : modelConfig.reasoningEffort,
      verified: postVerified,
      toolsEnabled: toolNames,
      routerReason: plan.reason,
      fellBack,
      retried,
      complexityScore: plan.complexityScore,
      exportFormat: plan.exportFormat,
      plannerUsed: Boolean(planningBrief),
      contextSummaryUsed: Boolean(contextSummary),
      verifierUsed: effectiveMode === "max",
      verifierRevised,
      sources,
    });

    for (const tool of executedTools.slice(0, 12)) {
      await supabase.from("tool_runs").insert({
        user_id: userId,
        chat_id: chatId,
        tool_name: tool.type ?? tool.name ?? "unknown",
        status: "ok",
        input:
          tool.arguments && typeof tool.arguments === "object"
            ? tool.arguments
            : {},
        output_summary: JSON.stringify({
          result: tool.result ?? null,
          search_results: tool.search_results ?? null,
          code_results: tool.code_results ?? null,
        }).slice(0, 2500),
        duration_ms: Date.now() - startedAt,
      });
    }

    await supabase.from("usage_events").insert({
      user_id: userId,
      chat_id: chatId,
      event_type: "completion",
      provider: provider.providerName,
      model_name: modelUsed,
      input_tokens: data?.usage?.prompt_tokens ?? null,
      output_tokens: data?.usage?.completion_tokens ?? null,
      latency_ms: Date.now() - startedAt,
      metadata: {
        requested_mode: requestedMode,
        effective_mode: effectiveMode,
        tools: toolNames,
        router_reason: plan.reason,
        fallback: fellBack,
        retried,
        complexity_score: plan.complexityScore,
        billing_plan: billingPlan,
        planner_used: Boolean(planningBrief),
        context_summary_used: Boolean(contextSummary),
        verifier_used: effectiveMode === "max",
        verifier_revised: verifierRevised,
        verified: postVerified,
      },
    });

    if (plan.extractMemory && !explicitMemory) {
      await extractDurableMemories(message, explicitMemory, {
        supabase,
        userId,
        chatId,
      });
    }

    return new Response(responseStreamFromText(answer), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Tensorra-Mode": effectiveMode,
        "X-Tensorra-Model": modelUsed,
        "X-Tensorra-Tools": toolNames.join(","),
        "X-Tensorra-Fallback": fellBack ? "1" : "0",
        "X-Tensorra-Retry": retried ? "1" : "0",
        "X-Tensorra-Complexity": String(plan.complexityScore),
        "X-Tensorra-Export": plan.exportFormat ?? "",
        "X-Tensorra-Planner": planningBrief ? "1" : "0",
        "X-Tensorra-Verified": postVerified ? "1" : "0",
        "X-Tensorra-Revised": verifierRevised ? "1" : "0",
      },
    });
  }

  if (effectiveMode === "max") {
    const {
      response: upstream,
      modelUsed,
      fellBack,
      retried,
    } = await providerFetch({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      payload: { ...basePayload, stream: false },
      signal: request.signal,
    });

    if (!upstream.ok) return providerError(upstream);

    const data = await upstream.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;

    const draft = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!draft) {
      return new Response("Модель вернула пустой ответ.", { status: 502 });
    }

    const verificationResult = await verifyAndReviseAnswer({
      verificationPrompt: buildPostVerificationPrompt({
        userMessage: message,
        draft,
        recentContext,
      }),
      userMessage: message,
      systemPrompt,
      config: modelConfig,
      draft,
      signal: request.signal,
    }).catch(() => ({
      answer: draft,
      verification: "",
      verified: false,
      revised: false,
    }));

    const finalAnswer = verificationResult.answer;

    await saveAssistantMessage({
      supabase,
      userId,
      chatId,
      content: finalAnswer,
      modelName: modelUsed,
      requestedMode,
      effectiveMode,
      reasoningEffort: fellBack ? "low" : modelConfig.reasoningEffort,
      verified: verificationResult.verified,
      toolsEnabled: [],
      routerReason: plan.reason,
      fellBack,
      retried,
      complexityScore: plan.complexityScore,
      exportFormat: plan.exportFormat,
      plannerUsed: Boolean(planningBrief),
      contextSummaryUsed: Boolean(contextSummary),
      verifierUsed: true,
      verifierRevised: verificationResult.revised,
    });

    await supabase.from("usage_events").insert({
      user_id: userId,
      chat_id: chatId,
      event_type: "completion",
      provider: provider.providerName,
      model_name: modelUsed,
      input_tokens: data?.usage?.prompt_tokens ?? null,
      output_tokens: data?.usage?.completion_tokens ?? null,
      latency_ms: Date.now() - startedAt,
      metadata: {
        requested_mode: requestedMode,
        effective_mode: effectiveMode,
        router_reason: plan.reason,
        fallback: fellBack,
        retried,
        complexity_score: plan.complexityScore,
        billing_plan: billingPlan,
        planner_used: Boolean(planningBrief),
        context_summary_used: Boolean(contextSummary),
        verifier_used: true,
        verifier_revised: verificationResult.revised,
        verified: verificationResult.verified,
      },
    });

    if (plan.extractMemory && !explicitMemory) {
      await extractDurableMemories(message, explicitMemory, {
        supabase,
        userId,
        chatId,
      });
    }

    return new Response(responseStreamFromText(finalAnswer), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Tensorra-Mode": effectiveMode,
        "X-Tensorra-Model": modelUsed,
        "X-Tensorra-Fallback": fellBack ? "1" : "0",
        "X-Tensorra-Retry": retried ? "1" : "0",
        "X-Tensorra-Complexity": String(plan.complexityScore),
        "X-Tensorra-Export": plan.exportFormat ?? "",
        "X-Tensorra-Planner": planningBrief ? "1" : "0",
        "X-Tensorra-Verified": verificationResult.verified ? "1" : "0",
        "X-Tensorra-Revised": verificationResult.revised ? "1" : "0",
      },
    });
  }

  const { response: upstream, modelUsed, fellBack, retried } = await providerFetch({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    payload: { ...basePayload, stream: true },
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    return providerError(upstream);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let complete = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        outer: while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;

            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") break outer;

            try {
              const event = JSON.parse(payload) as ProviderChunk;
              const token = event.choices?.[0]?.delta?.content;
              if (typeof token === "string" && token) {
                complete += token;
                controller.enqueue(encoder.encode(token));
              }
            } catch {
              // Пропускаем повреждённую SSE-строку, не обрывая весь ответ.
            }
          }
        }

        const finalContent = complete.trim()
          ? complete
          : "Не удалось получить содержательный ответ. Попробуй отправить запрос ещё раз.";

        if (!complete.trim()) {
          controller.enqueue(encoder.encode(finalContent));
        }

        await saveAssistantMessage({
          supabase,
          userId,
          chatId,
          content: finalContent,
          modelName: modelUsed,
          requestedMode,
          effectiveMode,
          reasoningEffort: fellBack ? "low" : modelConfig.reasoningEffort,
          verified: modelConfig.verify,
          toolsEnabled: [],
          routerReason: plan.reason,
          fellBack,
          retried,
          complexityScore: plan.complexityScore,
          exportFormat: plan.exportFormat,
          plannerUsed: Boolean(planningBrief),
          contextSummaryUsed: Boolean(contextSummary),
        });

        await supabase.from("usage_events").insert({
          user_id: userId,
          chat_id: chatId,
          event_type: "completion",
          provider: provider.providerName,
          model_name: modelUsed,
          latency_ms: Date.now() - startedAt,
          metadata: {
            requested_mode: requestedMode,
            effective_mode: effectiveMode,
            router_reason: plan.reason,
            fallback: fellBack,
            retried,
            complexity_score: plan.complexityScore,
            billing_plan: billingPlan,
            empty_provider_response: !complete.trim(),
          },
        });

        if (plan.extractMemory && !explicitMemory) {
          await extractDurableMemories(message, explicitMemory, {
            supabase,
            userId,
            chatId,
          });
        }

        controller.close();
      } catch (error) {
        const suffix = complete.trim()
          ? "\n\n⚠️ Ответ модели прервался. Частичный ответ сохранён — можно повторить запрос."
          : "⚠️ Соединение с моделью прервалось. Попробуй повторить запрос через несколько секунд.";
        const interruptedContent = complete.trim()
          ? `${complete}${suffix}`
          : suffix;

        controller.enqueue(encoder.encode(suffix));

        await saveAssistantMessage({
          supabase,
          userId,
          chatId,
          content: interruptedContent,
          modelName: modelUsed,
          requestedMode,
          effectiveMode,
          reasoningEffort: fellBack ? "low" : modelConfig.reasoningEffort,
          verified: false,
          toolsEnabled: [],
          routerReason: [...plan.reason, "stream_interrupted"],
          fellBack,
          retried,
          complexityScore: plan.complexityScore,
          exportFormat: plan.exportFormat,
          plannerUsed: Boolean(planningBrief),
          contextSummaryUsed: Boolean(contextSummary),
        }).catch(() => undefined);

        try {
          await supabase.from("usage_events").insert({
            user_id: userId,
            chat_id: chatId,
            event_type: "completion_interrupted",
            provider: provider.providerName,
            model_name: modelUsed,
            latency_ms: Date.now() - startedAt,
            metadata: {
              requested_mode: requestedMode,
              effective_mode: effectiveMode,
              router_reason: plan.reason,
              fallback: fellBack,
              partial_chars: complete.length,
              error: error instanceof Error ? error.message.slice(0, 500) : "stream_error",
            },
          });
        } catch {
          // Ошибка телеметрии не должна ломать восстановление пользовательского ответа.
        }

        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Tensorra-Mode": effectiveMode,
      "X-Tensorra-Model": modelUsed,
      "X-Tensorra-Fallback": fellBack ? "1" : "0",
      "X-Tensorra-Retry": retried ? "1" : "0",
      "X-Tensorra-Complexity": String(plan.complexityScore),
    },
  });
}
