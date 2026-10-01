export type ToolPlan = {
  web: boolean;
  code: boolean;
};

export function providerTools(plan: ToolPlan) {
  const tools: Array<{ type: "browser_search" | "code_interpreter" }> = [];
  if (plan.web && process.env.TENSORRA_BROWSER_SEARCH !== "false") {
    tools.push({ type: "browser_search" });
  }
  if (plan.code && process.env.TENSORRA_CODE_INTERPRETER !== "false") {
    tools.push({ type: "code_interpreter" });
  }
  return tools;
}
