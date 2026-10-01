import { createClient } from "@/lib/supabase/server";
import { chunkText, extractDocumentText, safeFilename } from "@/lib/tensorra/documents";
import { deleteKnowledgeDocument, upsertKnowledgeChunks } from "@/lib/tensorra/qdrant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPTED = new Set(["application/pdf", "text/plain", "text/markdown", "application/json"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const chatId = String(form.get("chatId") ?? "").trim() || null;
  if (!(file instanceof File)) return Response.json({ error: "Файл не найден в запросе." }, { status: 400 });

  if (chatId) {
    const { data: chat } = await supabase
      .from("chats")
      .select("id")
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!chat) return Response.json({ error: "Чат не найден." }, { status: 404 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return Response.json({ error: "Размер файла не должен превышать 15 МБ." }, { status: 413 });
  if (!ACCEPTED.has(file.type) && !file.name.toLocaleLowerCase().endsWith(".md")) {
    return Response.json({ error: "Поддерживаются PDF, TXT, Markdown и JSON." }, { status: 415 });
  }

  const filename = safeFilename(file.name);
  const storagePath = `${userId}/${crypto.randomUUID()}-${filename}`;

  const { data: document, error: docError } = await supabase.from("documents").insert({
    user_id: userId,
    filename: file.name.slice(0, 240),
    mime_type: file.type || "application/octet-stream",
    storage_path: storagePath,
    size_bytes: file.size,
    source_chat_id: chatId,
    status: "processing",
  }).select("id,filename,status,created_at").single();
  if (docError || !document) return Response.json({ error: "Не удалось создать запись документа." }, { status: 500 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("tensorra-files").upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const text = await extractDocumentText(file);
    if (text.length < 20) throw new Error("В документе не удалось найти читаемый текст.");
    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("Не удалось подготовить документ для поиска.");

    const rows = chunks.map((content, chunkIndex) => ({
      id: crypto.randomUUID(),
      document_id: document.id,
      user_id: userId,
      chunk_index: chunkIndex,
      content,
      token_count: Math.ceil(content.length / 4),
      metadata: {},
    }));

    for (let index = 0; index < rows.length; index += 80) {
      const { error } = await supabase.from("document_chunks").insert(rows.slice(index, index + 80));
      if (error) throw error;
    }

    await upsertKnowledgeChunks({
      userId,
      documentId: document.id,
      filename: document.filename,
      chunks: rows.map((row) => ({ id: row.id, content: row.content, chunkIndex: row.chunk_index })),
    }).catch(() => false);

    await supabase.from("documents").update({
      status: "ready",
      metadata: {
        extracted_chars: text.length,
        chunks: rows.length,
        source: chatId ? "chat_attachment" : "upload",
      },
    }).eq("id", document.id).eq("user_id", userId);

    let attachment = null;
    if (chatId) {
      const { data } = await supabase.from("attachments").insert({
        user_id: userId,
        chat_id: chatId,
        kind: "file",
        filename: file.name.slice(0, 240),
        mime_type: file.type || "application/octet-stream",
        storage_path: storagePath,
        size_bytes: file.size,
        metadata: { document_id: document.id },
      }).select("id").single();
      attachment = data;
    }

    return Response.json({
      kind: "document",
      document: { ...document, status: "ready", chunks: rows.length },
      attachment,
    });
  } catch (error) {
    await supabase.from("documents").update({
      status: "failed",
      metadata: { error: error instanceof Error ? error.message.slice(0, 500) : "Ошибка обработки документа" },
    }).eq("id", document.id).eq("user_id", userId);
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось обработать документ" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Не указан идентификатор документа." }, { status: 400 });

  const { data: doc } = await supabase.from("documents").select("id,storage_path").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!doc) return Response.json({ error: "Документ не найден." }, { status: 404 });

  if (doc.storage_path) await supabase.storage.from("tensorra-files").remove([doc.storage_path]);
  await deleteKnowledgeDocument(userId, id).catch(() => false);
  const { error } = await supabase.from("documents").delete().eq("id", id).eq("user_id", userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
