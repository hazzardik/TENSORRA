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
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "File is required" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return Response.json({ error: "File must be 15 MB or smaller" }, { status: 413 });
  if (!ACCEPTED.has(file.type) && !file.name.toLocaleLowerCase().endsWith(".md")) {
    return Response.json({ error: "Supported: PDF, TXT, Markdown, JSON" }, { status: 415 });
  }

  const filename = safeFilename(file.name);
  const storagePath = `${userId}/${crypto.randomUUID()}-${filename}`;

  const { data: document, error: docError } = await supabase.from("documents").insert({
    user_id: userId,
    filename: file.name.slice(0, 240),
    mime_type: file.type || "application/octet-stream",
    storage_path: storagePath,
    size_bytes: file.size,
    status: "processing",
  }).select("id,filename,status,created_at").single();
  if (docError || !document) return Response.json({ error: "Could not create document record" }, { status: 500 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("tensorra-files").upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const text = await extractDocumentText(file);
    if (text.length < 20) throw new Error("No readable text found in this document");
    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("Document produced no searchable chunks");

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
      metadata: { extracted_chars: text.length, chunks: rows.length },
    }).eq("id", document.id).eq("user_id", userId);

    return Response.json({ document: { ...document, status: "ready", chunks: rows.length } });
  } catch (error) {
    await supabase.from("documents").update({
      status: "failed",
      metadata: { error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed" },
    }).eq("id", document.id).eq("user_id", userId);
    return Response.json({ error: error instanceof Error ? error.message : "Document processing failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { data: doc } = await supabase.from("documents").select("id,storage_path").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  if (doc.storage_path) await supabase.storage.from("tensorra-files").remove([doc.storage_path]);
  await deleteKnowledgeDocument(userId, id).catch(() => false);
  const { error } = await supabase.from("documents").delete().eq("id", id).eq("user_id", userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
