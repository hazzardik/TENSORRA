type MemoryItem = { content: string; category?: string | null };
type KnowledgeItem = { content: string; filename?: string | null; score?: number | null };

export function buildSystemPrompt(
  memories: MemoryItem[],
  knowledge: KnowledgeItem[],
  verificationBrief?: string,
  options?: { research?: boolean },
) {
  const memoryBlock = memories.length
    ? memories.map((memory, index) => `${index + 1}. ${memory.content}`).join("\n")
    : "No relevant long-term memory.";

  const knowledgeBlock = knowledge.length
    ? knowledge.map((item, index) => `${index + 1}. [${item.filename ?? "document"}] ${item.content}`).join("\n\n")
    : "No relevant private-document context.";

  const researchBlock = options?.research
    ? `\n\nResearch mode is active:\n- Use browser search when current or externally verifiable facts matter.\n- Cross-check important claims across multiple reliable sources when possible.\n- Prefer primary sources and clearly distinguish sourced facts from inference.\n- Surface material uncertainty or source disagreement.\n- Produce a synthesized answer rather than a list of search snippets.`
    : "";

  const verificationBlock = verificationBrief
    ? `\n\nInternal verification brief (use it to improve the final answer; do not quote it verbatim):\n${verificationBrief}`
    : "";

  return `${process.env.TENSORRA_SYSTEM_PROMPT ?? `You are TENSORRA, a precise AI reasoning system and agentic assistant.

Core behavior:
- Answer the user's actual question directly.
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
${knowledgeBlock}${researchBlock}${verificationBlock}`;
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
