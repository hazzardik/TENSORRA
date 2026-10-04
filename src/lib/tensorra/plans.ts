export type TensorraPlanId = "free" | "plus" | "pro" | "team";

export type TensorraEntitlements = {
  maxMode: "balanced" | "deep" | "max";
  memory: boolean;
  documents: boolean;
  web: boolean;
  code: boolean;
  vision: boolean;
  verifier: boolean;
  priorityCompute: boolean;
};

export type TensorraPlanDefinition = {
  id: TensorraPlanId;
  label: string;
  shortLabel: string;
  entitlements: TensorraEntitlements;
};

export const TENSORRA_PLANS: Record<TensorraPlanId, TensorraPlanDefinition> = {
  free: {
    id: "free",
    label: "TENSORRA Free",
    shortLabel: "Free",
    entitlements: {
      maxMode: "max",
      memory: true,
      documents: true,
      web: true,
      code: true,
      vision: true,
      verifier: true,
      priorityCompute: false,
    },
  },
  plus: {
    id: "plus",
    label: "TENSORRA Plus",
    shortLabel: "Plus",
    entitlements: {
      maxMode: "max",
      memory: true,
      documents: true,
      web: true,
      code: true,
      vision: true,
      verifier: true,
      priorityCompute: true,
    },
  },
  pro: {
    id: "pro",
    label: "TENSORRA Pro",
    shortLabel: "Pro",
    entitlements: {
      maxMode: "max",
      memory: true,
      documents: true,
      web: true,
      code: true,
      vision: true,
      verifier: true,
      priorityCompute: true,
    },
  },
  team: {
    id: "team",
    label: "TENSORRA Team",
    shortLabel: "Team",
    entitlements: {
      maxMode: "max",
      memory: true,
      documents: true,
      web: true,
      code: true,
      vision: true,
      verifier: true,
      priorityCompute: true,
    },
  },
};

export function normalizePlan(value: unknown): TensorraPlanId {
  return value === "plus" || value === "pro" || value === "team"
    ? value
    : "free";
}

export function planDefinition(value: unknown) {
  return TENSORRA_PLANS[normalizePlan(value)];
}
