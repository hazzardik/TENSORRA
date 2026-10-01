import { createClient } from "@/lib/supabase/server";
import { deleteKnowledgeDocument } from "@/lib/tensorra/qdrant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    return Response.json(
      { error: "Требуется вход в аккаунт." },
      { status: 401 },
    );
  }

  const chatId = new URL(request.url).searchParams.get("id")?.trim();
  if (!chatId) {
    return Response.json(
      { error: "Не указан идентификатор чата." },
      { status: 400 },
    );
  }

  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!chat) {
    return Response.json(
      { error: "Чат не найден." },
      { status: 404 },
    );
  }

  const [{ data: documents }, { data: attachments }] = await Promise.all([
    supabase
      .from("documents")
      .select("id,storage_path")
      .eq("user_id", userId)
      .eq("source_chat_id", chatId),
    supabase
      .from("attachments")
      .select("storage_path")
      .eq("user_id", userId)
      .eq("chat_id", chatId),
  ]);

  const storagePaths = [...new Set([
    ...(documents ?? [])
      .map((item: { storage_path: string | null }) => item.storage_path)
      .filter((value): value is string => Boolean(value)),
    ...(attachments ?? [])
      .map((item: { storage_path: string | null }) => item.storage_path)
      .filter((value): value is string => Boolean(value)),
  ])];

  if (storagePaths.length) {
    await supabase.storage
      .from("tensorra-files")
      .remove(storagePaths)
      .catch(() => undefined);
  }

  await Promise.all(
    (documents ?? []).map((document: { id: string }) =>
      deleteKnowledgeDocument(userId, document.id).catch(() => false),
    ),
  );

  const { error } = await supabase
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);

  if (error) {
    return Response.json(
      { error: "Не удалось удалить чат." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
