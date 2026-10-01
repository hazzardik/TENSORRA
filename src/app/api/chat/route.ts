import { createClient } from "@/lib/supabase/server";
import { createChatTitle, extractMemory } from "@/lib/memory";
import {
  normalizeThinkingMode,
  resolveAutoThinkingMode,
  THINKING_MODES,
  type ConcreteThinkingMode,
} from "@/lib/tensorra/model-router";
import { buildMemoryExtractionPrompt, buildSystemPrompt, buildVerificationPrompt } from "@/lib/tensorra/prompt";
import { createVerificationBrief, extractMemoriesWithModel, providerConfig } from "@/lib/tensorra/provider";
import { searchKnowledge, searchSemanticMemories, upsertSemanticMemory } from "@/lib/tensorra/qdrant";
import { providerTools } from "@/lib/tensorra/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredMessage = { role: "user" | "assistant"; content: string };
type ProviderChunk = { choices?: Array<{ delta?: { content?: string | null } }> };
type MemoryItem = { content: string; category?: string | null };
type KnowledgeItem = { content: string; filename?: string | null; score?: number | null };

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
  const semantic = await searchSemanticMemories(userId, query, 8).catch(() => []);
  const { data: recent } = await supabase
    .from("memories")
    .select("content,category")
    .eq("user_id", userId)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(12);

  const combined: MemoryItem[] = [
    ...semantic.map((item) => ({ content: item.content, category: item.category })),
    ...((recent ?? []) as MemoryItem[]),
  ];

  const seen = new Set<string>();
  return combined.filter((item) => {
    const key = item.content.toLocaleLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

async function loadRelevantKnowledge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  query: string,
): Promise<KnowledgeItem[]> {
  const semantic = await searchKnowledge(userId, query, 8).catch(() => []);
  if (semantic.length) {
    const ids = [...new Set(semantic.map((item) => item.documentId).filter(Boolean))];
    const { data: existing } = ids.length
      ? await supabase.from("documents").select("id").eq("user_id", userId).in("id", ids)
      : { data: [] as Array<{ id: string }> };
    const allowed = new Set((existing ?? []).map((item: { id: string }) => item.id));
    const verified = semantic.filter((item) => item.documentId && allowed.has(item.documentId));
    if (verified.length) return verified.slice(0, 8);
  }

  const { data } = await supabase.rpc("search_document_chunks_lexical", {
    query_text: query,
    match_count: 8,
  });

  if (!data?.length) return [];
  const documentIds = [...new Set(data.map((item: { document_id: string }) => item.document_id))];
  const { data: docs } = await supabase.from("documents").select("id,filename").in("id", documentIds);
  const names = new Map((docs ?? []).map((doc: { id: string; filename: string }) => [doc.id, doc.filename]));

  return data.map((item: { content: string; document_id: string; rank?: number }) => ({
    content: item.content,
    filename: names.get(item.document_id) ?? "document",
    score: item.rank ?? 0,
  }));
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
    async start(controller) {
      const parts = text.match(/.{1,72}(?:\s|$)|.{1,72}/gs) ?? [text];
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => null) as {
    chatId?: string;
    message?: string;
    documentIds?: string[];
  } | null;
  const chatId = body?.chatId?.trim();
  const message = body?.message?.trim();
  const attachedDocumentIds = [...new Set(
    (body?.documentIds ?? []).filter((id) => typeof id === "string" && id.length > 0),
  )].slice(0, 6);

  if (!chatId || !message) return new Response("chatId and message are required", { status: 400 });
  if (message.length > 30000) return new Response("Message is too long", { status: 413 });

  const { data: chat, error: chatError } = await supabase
    .from("chats")
    .select("id,title,mode")
    .eq("id", chatId)
    .eq("user_id", userId)
    .single();
  if (chatError || !chat) return new Response("Chat not found", { status: 404 });

  const requestedMode = normalizeThinkingMode(chat.mode);
  const effectiveMode: ConcreteThinkingMode = requestedMode === "auto"
    ? resolveAutoThinkingMode(message)
    : requestedMode;
  const modelConfig = THINKING_MODES[effectiveMode];

  const { data: attachedDocs } = attachedDocumentIds.length
    ? await supabase.from("documents")
        .select("id,filename")
        .eq("user_id", userId)
        .in("id", attachedDocumentIds)
    : { data: [] as Array<{ id: string; filename: string }> };

  const verifiedDocumentIds = (attachedDocs ?? []).map((doc: { id: string }) => doc.id);

  const { error: insertError } = await supabase.from("messages").insert({
    chat_id: chatId,
    user_id: userId,
    role: "user",
    content: message,
    metadata: {
      attachments: (attachedDocs ?? []).map((doc: { id: string; filename: string }) => ({
        kind: "document",
        document_id: doc.id,
        filename: doc.filename,
      })),
    },
  });
  if (insertError) return new Response("Could not save message", { status: 500 });

  await supabase.from("chats").update({
    title: chat.title === "New chat" ? createChatTitle(message) : chat.title,
    updated_at: new Date().toISOString(),
  }).eq("id", chatId).eq("user_id", userId);

  const explicitMemory = extractMemory(message);
  if (explicitMemory) {
    await saveMemory(supabase, userId, chatId, { content: explicitMemory, category: "explicit", importance: 9 });
  }

  const attachedKnowledgePromise = verifiedDocumentIds.length
    ? supabase.from("document_chunks")
        .select("document_id,content,chunk_index")
        .eq("user_id", userId)
        .in("document_id", verifiedDocumentIds)
        .order("chunk_index", { ascending: true })
        .limit(48)
    : Promise.resolve({ data: [] as Array<{ document_id: string; content: string; chunk_index: number }> });

  const [{ data: history }, relevantMemories, relevantKnowledge, { data: attachedChunks }] = await Promise.all([
    supabase.from("messages")
      .select("role,content")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(50),
    loadRelevantMemories(supabase, userId, message),
    loadRelevantKnowledge(supabase, userId, message),
    attachedKnowledgePromise,
  ]);

  const attachedNames = new Map(
    (attachedDocs ?? []).map((doc: { id: string; filename: string }) => [doc.id, doc.filename]),
  );
  const attachedKnowledge: KnowledgeItem[] = (attachedChunks ?? []).map(
    (chunk: { document_id: string; content: string }) => ({
      content: chunk.content,
      filename: attachedNames.get(chunk.document_id) ?? "attached document",
      score: 1,
    }),
  );
  const mergedKnowledge = [...attachedKnowledge, ...relevantKnowledge]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.content === item.content) === index)
    .slice(0, 18);

  const conversation = (((history ?? []) as StoredMessage[]).reverse()).slice(-50);
  const recentContext = conversation.map((item) => `${item.role}: ${item.content}`).join("\n");

  let verificationBrief = "";
  if (modelConfig.verify) {
    verificationBrief = await createVerificationBrief(
      [{ role: "user", content: buildVerificationPrompt(message, recentContext) }],
      modelConfig,
      request.signal,
    ).catch(() => "");
  }

  const systemPrompt = buildSystemPrompt(relevantMemories, mergedKnowledge, verificationBrief, { autonomousTools: true });
  const provider = providerConfig();
  if (!provider.apiKey) return new Response("GROQ_API_KEY (or AI_API_KEY) is not configured", { status: 500 });

  const tools = providerTools();
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

  // Groq built-in browser/code tools currently have the most predictable behavior in a non-streaming
  // Chat Completions request. TENSORRA re-streams the finished answer to keep one client protocol.
  if (tools.length) {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ ...basePayload, stream: false, tools }),
      cache: "no-store",
      signal: request.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return new Response(detail || "AI provider request failed", { status: upstream.status || 502 });
    }

    const data = await upstream.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string | null; executed_tools?: ToolExecution[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const answer = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) return new Response("TENSORRA returned an empty response", { status: 502 });

    const executedTools = data?.choices?.[0]?.message?.executed_tools ?? [];
    const sourceMap = new Map<string, ResearchSource>();
    for (const tool of executedTools) {
      for (const result of tool.search_results?.results ?? []) {
        if (typeof result.url !== "string" || !/^https?:\/\//i.test(result.url)) continue;
        const url = result.url.slice(0, 2000);
        if (sourceMap.has(url)) continue;
        sourceMap.set(url, {
          title: (typeof result.title === "string" && result.title.trim() ? result.title.trim() : url).slice(0, 240),
          url,
          score: typeof result.score === "number" ? result.score : undefined,
        });
        if (sourceMap.size >= 10) break;
      }
      if (sourceMap.size >= 10) break;
    }
    const sources = [...sourceMap.values()];

    await saveAssistantMessage({
      supabase, userId, chatId, content: answer, modelName: modelConfig.model,
      requestedMode, effectiveMode, reasoningEffort: modelConfig.reasoningEffort,
      verified: modelConfig.verify, toolsEnabled: toolNames, sources,
    });
    for (const tool of executedTools.slice(0, 12)) {
      await supabase.from("tool_runs").insert({
        user_id: userId,
        chat_id: chatId,
        tool_name: tool.type ?? tool.name ?? "unknown",
        status: "ok",
        input: (tool.arguments && typeof tool.arguments === "object") ? tool.arguments : {},
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
      provider: "groq",
      model_name: modelConfig.model,
      input_tokens: data?.usage?.prompt_tokens ?? null,
      output_tokens: data?.usage?.completion_tokens ?? null,
      latency_ms: Date.now() - startedAt,
      metadata: { requested_mode: requestedMode, effective_mode: effectiveMode, tools: toolNames, autonomous_tools: true },
    });

    const autoMemories = await extractMemoriesWithModel(buildMemoryExtractionPrompt(message)).catch(() => []);
    for (const item of autoMemories) {
      if (explicitMemory && item.content.toLocaleLowerCase() === explicitMemory.toLocaleLowerCase()) continue;
      await saveMemory(supabase, userId, chatId, item);
    }

    return new Response(responseStreamFromText(answer), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Tensorra-Mode": effectiveMode,
        "X-Tensorra-Model": modelConfig.model,
        "X-Tensorra-Tools": toolNames.join(","),
        "X-Tensorra-Autonomous-Tools": "1",
      },
    });
  }

  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ ...basePayload, stream: true }),
    cache: "no-store",
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(detail || "AI provider request failed", { status: upstream.status || 502 });
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
            } catch { /* malformed SSE line */ }
          }
        }

        if (complete.trim()) {
          await saveAssistantMessage({
            supabase, userId, chatId, content: complete, modelName: modelConfig.model,
            requestedMode, effectiveMode, reasoningEffort: modelConfig.reasoningEffort,
            verified: modelConfig.verify, toolsEnabled: [],
          });
          await supabase.from("usage_events").insert({
            user_id: userId,
            chat_id: chatId,
            event_type: "completion",
            provider: "groq",
            model_name: modelConfig.model,
            latency_ms: Date.now() - startedAt,
            metadata: { requested_mode: requestedMode, effective_mode: effectiveMode, autonomous_tools: true },
          });
        }

        const autoMemories = await extractMemoriesWithModel(buildMemoryExtractionPrompt(message)).catch(() => []);
        for (const item of autoMemories) {
          if (explicitMemory && item.content.toLocaleLowerCase() === explicitMemory.toLocaleLowerCase()) continue;
          await saveMemory(supabase, userId, chatId, item);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
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
      "X-Tensorra-Model": modelConfig.model,
      "X-Tensorra-Autonomous-Tools": "1",
    },
  });
}
