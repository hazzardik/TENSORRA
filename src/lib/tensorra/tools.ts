export function providerTools() {
  const tools: Array<{ type: "browser_search" | "code_interpreter" }> = [];
  if (process.env.TENSORRA_BROWSER_SEARCH !== "false") tools.push({ type: "browser_search" });
  if (process.env.TENSORRA_CODE_INTERPRETER !== "false") tools.push({ type: "code_interpreter" });
  return tools;
}
