import { createChatTitle } from "@/lib/memory";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeThinkingMode,
  resolveAutoThinkingMode,
  type ConcreteThinkingMode,
} from "@/lib/tensorra/model-router";
import { buildSystemPrompt } from "@/lib/tensorra/prompt";
import { providerConfig } from "@/lib/tensorra/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "image";
}

function inferMime(file: File) {
  if (ACCEPTED_TYPES.has(file.type)) return file.type;
  const lower = file.name.toLocaleLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "";
}

function reasoningForMode(mode: ConcreteThinkingMode): "low" | "medium" | "high" {
  if (mode === "fast") return "low";
  if (mode === "max") return "high";
  return "medium";
}

function streamText(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
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
  if (!userId) return new Response("Требуется вход в аккаунт.", { status: 401 });

  const form = await request.formData();
  const chatId = String(form.get("chatId") ?? "").trim();
  const message = String(form.get("message") ?? "").trim() || "Разбери это изображение и объясни всё важное.";
  const image = form.get("image");

  if (!chatId || !(image instanceof File)) {
    return new Response("Не указан чат или изображение.", { status: 400 });
  }

  const mimeType = inferMime(image);
  if (!mimeType) return new Response("Поддерживаются изображения JPEG, PNG и WebP.", { status: 415 });
  if (image.size <= 0 || image.size > MAX_IMAGE_SIZE) {
    return new Response("Размер изображения не должен превышать 8 МБ.", { status: 413 });
  }

  const { data: chat, error: chatError } = await supabase
    .from("chats")
    .select("id,title,mode")
    .eq("id", chatId)
    .eq("user_id", userId)
    .single();
  if (chatError || !chat) return new Response("Чат не найден.", { status: 404 });

  const requestedMode = normalizeThinkingMode(chat.mode);
  const effectiveMode: ConcreteThinkingMode = requestedMode === "auto"
    ? resolveAutoThinkingMode(message)
    : requestedMode;
  const reasoningEffort = reasoningForMode(effectiveMode);

  const [{ data: history }, { data: memories }] = await Promise.all([
    supabase
      .from("messages")
      .select("role,content")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("memories")
      .select("content,category")
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const bytes = Buffer.from(await image.arrayBuffer());
  const storagePath = `${userId}/images/${crypto.randomUUID()}-${safeFilename(image.name)}`;

  const { error: uploadError } = await supabase.storage
    .from("tensorra-files")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) return new Response(`Не удалось сохранить изображение: ${uploadError.message}`, { status: 500 });

  const { data: userMessage, error: messageError } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      user_id: userId,
      role: "user",
      content: message,
      metadata: {
        vision: true,
        image_filename: image.name.slice(0, 240),
        attachments: [{ kind: "image", filename: image.name.slice(0, 240) }],
      },
    })
    .select("id")
    .single();

  if (messageError || !userMessage) {
    await supabase.storage.from("tensorra-files").remove([storagePath]);
    return new Response("Не удалось сохранить сообщение с изображением.", { status: 500 });
  }

  const { data: attachment } = await supabase
    .from("attachments")
    .insert({
      user_id: userId,
      chat_id: chatId,
      message_id: userMessage.id,
      kind: "image",
      filename: image.name.slice(0, 240),
      mime_type: mimeType,
      storage_path: storagePath,
      size_bytes: image.size,
    })
    .select("id")
    .single();

  await supabase.from("chats").update({
    title: chat.title === "New chat" ? createChatTitle(message) : chat.title,
    updated_at: new Date().toISOString(),
  }).eq("id", chatId).eq("user_id", userId);

  const provider = providerConfig();
  if (!provider.apiKey) return new Response("Ключ AI-провайдера не настроен.", { status: 500 });

  const prior = (((history ?? []) as Array<{ role: "user" | "assistant"; content: string }>).reverse()).slice(-16);
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const systemPrompt = buildSystemPrompt(
    (memories ?? []) as Array<{ content: string; category?: string | null }>,
    [],
    "",
    { research: false, autonomousTools: false },
  ) + "\n\nVision mode: inspect the supplied image carefully. Do not claim to see details that are not actually visible.";

  const model = process.env.TENSORRA_VISION_MODEL ?? "qwen/qwen3.8-27b";
  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: reasoningEffort === "low" ? 0.7 : 1,
      top_p: reasoningEffort === "low" ? 0.8 : 0.95,
      max_completion_tokens: effectiveMode === "max" ? 6000 : 3500,
      reasoning_effort: reasoningEffort,
      reasoning_format: "hidden",
      messages: [
        { role: "system", content: systemPrompt },
        ...prior,
        {
          role: "user",
          content: [
            { type: "text", text: message },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    cache: "no-store",
    signal: request.signal,
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return new Response(detail || "Не удалось получить ответ модели Vision.", { status: upstream.status || 502 });
  }

  const result = await upstream.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;

  const answer = result?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!answer) return new Response("Модель Vision вернула пустой ответ.", { status: 502 });

  await supabase.from("messages").insert({
    chat_id: chatId,
    user_id: userId,
    role: "assistant",
    content: answer,
    model_name: model,
    metadata: {
      vision: true,
      attachment_id: attachment?.id ?? null,
      requested_mode: requestedMode,
      effective_mode: effectiveMode,
      reasoning_effort: reasoningEffort,
    },
  });

  await supabase.from("usage_events").insert({
    user_id: userId,
    chat_id: chatId,
    event_type: "vision_completion",
    provider: "groq",
    model_name: model,
    input_tokens: result?.usage?.prompt_tokens ?? null,
    output_tokens: result?.usage?.completion_tokens ?? null,
    latency_ms: Date.now() - startedAt,
    metadata: { effective_mode: effectiveMode, mime_type: mimeType, size_bytes: image.size },
  });

  return new Response(streamText(answer), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Tensorra-Mode": effectiveMode,
      "X-Tensorra-Model": model,
      "X-Tensorra-Vision": "1",
    },
  });
}
