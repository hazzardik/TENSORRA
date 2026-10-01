const MEMORY_PREFIXES = [
  /^\s*запомни(?:,|:|\s)+(.*)$/i,
  /^\s*помни(?:,|:|\s)+(.*)$/i,
  /^\s*remember(?: that)?(?:,|:|\s)+(.*)$/i,
];

export function extractMemory(text: string): string | null {
  for (const pattern of MEMORY_PREFIXES) {
    const match = text.match(pattern);
    const memory = match?.[1]?.trim();
    if (memory && memory.length >= 3) return memory.slice(0, 1200);
  }
  return null;
}

export function createChatTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 46 ? `${clean.slice(0, 46).trim()}…` : clean;
}
