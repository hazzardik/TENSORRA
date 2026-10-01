export type ToolPreferences = { web: boolean; code: boolean };

export function normalizeToolPreferences(value: unknown): ToolPreferences {
  const object = (value && typeof value === "object") ? value as Record<string, unknown> : {};
  return {
    web: object.web !== false,
    code: object.code !== false,
  };
}

export function providerTools(preferences: ToolPreferences) {
  const tools: Array<{ type: "browser_search" | "code_interpreter" }> = [];
  if (preferences.web && process.env.TENSORRA_BROWSER_SEARCH !== "false") tools.push({ type: "browser_search" });
  if (preferences.code && process.env.TENSORRA_CODE_INTERPRETER !== "false") tools.push({ type: "code_interpreter" });
  return tools;
}
