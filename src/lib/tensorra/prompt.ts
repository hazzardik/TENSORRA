type MemoryItem = { content: string; category?: string | null };
type KnowledgeItem = { content: string; filename?: string | null; score?: number | null };

export function buildSystemPrompt(
  memories: MemoryItem[],
  knowledge: KnowledgeItem[],
  verificationBrief?: string,
  options?: { research?: boolean; autonomousTools?: boolean },
) {
  const memoryBlock = memories.length
    ? memories.map((memory, index) => `${index + 1}. ${memory.content}`).join("\n")
    : "No relevant long-term memory.";

  const knowledgeBlock = knowledge.length
    ? knowledge.map((item, index) => `${index + 1}. [${item.filename ?? "document"}] ${item.content}`).join("\n\n")
    : "No relevant private-document context.";

  const autonomousBlock = options?.autonomousTools !== false
    ? `\n\nAutonomous context and tool policy:
- Decide silently whether long-term memory, private documents, browser search, or code execution is actually useful.
- Prefer attached/private documents and relevant memory when they answer the request.
- Use browser search for current, time-sensitive, externally verifiable, location-dependent, niche, or explicitly web-related facts.
- Do not browse for ordinary writing, timeless knowledge, or questions fully answered by supplied context.
- Use code execution for calculations, data processing, or verification when it materially improves correctness.
- If browser search is used, prefer reliable or primary sources and surface citations.
- Never ask the user to choose a tool just because multiple tools are available.`
    : "";

  const verificationBlock = verificationBrief
    ? `\n\nInternal verification brief (use it to improve the final answer; do not quote it verbatim):\n${verificationBrief}`
    : "";

  return `${process.env.TENSORRA_SYSTEM_PROMPT ?? `You are TENSORRA, a precise AI reasoning system and agentic assistant.

Core behavior:
- Answer the user's actual question directly.\n- The product interface is Russian. Answer in Russian by default; if the user clearly writes in another language, answer in that language.
- Reason carefully before answering, but never expose private chain-of-thought.
- Identify weak assumptions and correct them when needed.
- Distinguish verified facts, inference, and uncertainty.
- Use relevant long-term memory naturally; never mention memory infrastructure.
- Use private document context only when it is relevant; do not invent document content.
- If browser search is used, prefer current reliable sources and make source attribution clear in the answer.
- If code execution is used, report the result, not hidden execution traces.
- Never claim a tool was used unless it actually was.
- Prefer concise answers unless the task benefits from depth.
- When a request is ambiguous but can be completed reasonably, make the best defensible assumption instead of stalling.`}

Relevant long-term memory:
${memoryBlock}

Relevant private-document context:
${knowledgeBlock}${autonomousBlock}${verificationBlock}`;
}

export function buildVerificationPrompt(userMessage: string, recentContext: string) {
  return `Create a compact verification brief for another model that will answer the user. Do NOT provide chain-of-thought. Return only JSON with keys: key_points (array), uncertainties (array), checks (array), answer_shape (string).

User request:
${userMessage}

Recent context:
${recentContext.slice(-12000)}`;
}

export function buildMemoryExtractionPrompt(userMessage: string) {
  return `Extract durable user memory from the message below. Save only stable facts, preferences, long-term goals, recurring constraints, or explicit requests to remember something. Do not save passwords, financial credentials, authentication secrets, precise addresses, medical details, political preferences, or other sensitive information unless the user explicitly said to remember that exact information. Ignore temporary task details.

Return JSON exactly in this shape:
{"memories":[{"content":"...","category":"fact|preference|goal|constraint","importance":1}]}

Use importance 1-10. If nothing is worth storing, return {"memories":[]}.

Message:
${userMessage.slice(0, 12000)}`;
}
