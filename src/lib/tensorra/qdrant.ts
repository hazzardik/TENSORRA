const MODEL = "sentence-transformers/all-minilm-l6-v2";
const MEMORY_COLLECTION = process.env.QDRANT_MEMORY_COLLECTION ?? "tensorra_memory";
const KNOWLEDGE_COLLECTION = process.env.QDRANT_KNOWLEDGE_COLLECTION ?? "tensorra_knowledge";

function config() {
  const url = process.env.QDRANT_URL?.replace(/\/$/, "");
  const apiKey = process.env.QDRANT_API_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

async function qdrantFetch(path: string, init: RequestInit) {
  const cfg = config();
  if (!cfg) return null;
  return fetch(`${cfg.url}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "api-key": cfg.apiKey,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function ensureCollection(name: string) {
  const cfg = config();
  if (!cfg) return false;

  const check = await qdrantFetch(`/collections/${name}`, { method: "GET" });
  if (check?.ok) return true;

  const created = await qdrantFetch(`/collections/${name}`, {
    method: "PUT",
    body: JSON.stringify({ vectors: { size: 384, distance: "Cosine" } }),
  });

  return Boolean(created?.ok);
}

export async function upsertSemanticMemory(args: {
  id: string;
  userId: string;
  content: string;
  category: string;
  importance: number;
}) {
  if (!(await ensureCollection(MEMORY_COLLECTION))) return false;

  const response = await qdrantFetch(`/collections/${MEMORY_COLLECTION}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: [{
        id: args.id,
        vector: { text: args.content, model: MODEL },
        payload: {
          user_id: args.userId,
          content: args.content,
          category: args.category,
          importance: args.importance,
          created_at: new Date().toISOString(),
        },
      }],
    }),
  });

  return Boolean(response?.ok);
}

export async function searchSemanticMemories(userId: string, query: string, limit = 8) {
  if (!(await ensureCollection(MEMORY_COLLECTION))) return [] as Array<{
    content: string;
    category: string;
    score: number;
    importance: number;
    createdAt: string | null;
  }>;

  const response = await qdrantFetch(`/collections/${MEMORY_COLLECTION}/points/query`, {
    method: "POST",
    body: JSON.stringify({
      query: { text: query, model: MODEL },
      filter: { must: [{ key: "user_id", match: { value: userId } }] },
      with_payload: true,
      limit,
      score_threshold: 0.25,
    }),
  });

  if (!response?.ok) return [];
  const data = (await response.json().catch(() => null)) as
    | { result?: { points?: Array<{ score?: number; payload?: Record<string, unknown> }> } }
    | null;

  return (data?.result?.points ?? []).map((point) => ({
    content: typeof point.payload?.content === "string" ? point.payload.content : "",
    category: typeof point.payload?.category === "string" ? point.payload.category : "fact",
    score: typeof point.score === "number" ? point.score : 0,
    importance: typeof point.payload?.importance === "number"
      ? point.payload.importance
      : Number(point.payload?.importance) || 5,
    createdAt: typeof point.payload?.created_at === "string"
      ? point.payload.created_at
      : null,
  })).filter((item) => item.content);
}

export async function upsertKnowledgeChunks(args: {
  userId: string;
  documentId: string;
  filename: string;
  chunks: Array<{ id: string; content: string; chunkIndex: number }>;
}) {
  if (!args.chunks.length || !(await ensureCollection(KNOWLEDGE_COLLECTION))) return false;

  const response = await qdrantFetch(`/collections/${KNOWLEDGE_COLLECTION}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: args.chunks.map((chunk) => ({
        id: chunk.id,
        vector: { text: chunk.content, model: MODEL },
        payload: {
          user_id: args.userId,
          document_id: args.documentId,
          filename: args.filename,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
        },
      })),
    }),
  });

  return Boolean(response?.ok);
}

export async function searchKnowledge(userId: string, query: string, limit = 8) {
  if (!(await ensureCollection(KNOWLEDGE_COLLECTION))) return [] as Array<{ content: string; filename: string; documentId: string; score: number }>;

  const response = await qdrantFetch(`/collections/${KNOWLEDGE_COLLECTION}/points/query`, {
    method: "POST",
    body: JSON.stringify({
      query: { text: query, model: MODEL },
      filter: { must: [{ key: "user_id", match: { value: userId } }] },
      with_payload: true,
      limit,
      score_threshold: 0.22,
    }),
  });

  if (!response?.ok) return [];
  const data = (await response.json().catch(() => null)) as
    | { result?: { points?: Array<{ score?: number; payload?: Record<string, unknown> }> } }
    | null;

  return (data?.result?.points ?? []).map((point) => ({
    content: typeof point.payload?.content === "string" ? point.payload.content : "",
    filename: typeof point.payload?.filename === "string" ? point.payload.filename : "document",
    documentId: typeof point.payload?.document_id === "string" ? point.payload.document_id : "",
    score: typeof point.score === "number" ? point.score : 0,
  })).filter((item) => item.content);
}

export async function deleteKnowledgeDocument(userId: string, documentId: string) {
  if (!(await ensureCollection(KNOWLEDGE_COLLECTION))) return false;
  const response = await qdrantFetch(`/collections/${KNOWLEDGE_COLLECTION}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({
      filter: {
        must: [
          { key: "user_id", match: { value: userId } },
          { key: "document_id", match: { value: documentId } },
        ],
      },
    }),
  });
  return Boolean(response?.ok);
}
