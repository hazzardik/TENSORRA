export type TensorraModelRole = "fast" | "deep" | "vision";
export type TensorraModelStage = "production" | "candidate" | "shadow" | "disabled";

export type RegisteredModel = {
  key: string;
  label: string;
  model: string;
  role: TensorraModelRole;
  stage: TensorraModelStage;
  provider: string;
};

function modelProvider(model: string) {
  if (process.env.TENSORRA_MODEL_BASE_URL?.trim()) return "tensorra-model";
  if (model.includes("/")) return model.split("/")[0] || "openai-compatible";
  return "openai-compatible";
}

const defaults: Record<TensorraModelRole, string> = {
  fast: "openai/gpt-oss-20b",
  deep: "openai/gpt-oss-120b",
  vision: "qwen/qwen3.8-27b",
};

function envForRole(role: TensorraModelRole) {
  if (role === "fast") {
    return (
      process.env.TENSORRA_PRODUCTION_FAST_MODEL ??
      process.env.TENSORRA_FAST_MODEL ??
      defaults.fast
    );
  }

  if (role === "deep") {
    return (
      process.env.TENSORRA_PRODUCTION_DEEP_MODEL ??
      process.env.TENSORRA_DEEP_MODEL ??
      defaults.deep
    );
  }

  return (
    process.env.TENSORRA_PRODUCTION_VISION_MODEL ??
    process.env.TENSORRA_VISION_MODEL ??
    defaults.vision
  );
}

function candidateEnv(role: TensorraModelRole) {
  if (role === "fast") return process.env.TENSORRA_CANDIDATE_FAST_MODEL?.trim();
  if (role === "deep") return process.env.TENSORRA_CANDIDATE_DEEP_MODEL?.trim();
  return process.env.TENSORRA_CANDIDATE_VISION_MODEL?.trim();
}

function shadowEnv(role: TensorraModelRole) {
  if (role === "fast") return process.env.TENSORRA_SHADOW_FAST_MODEL?.trim();
  if (role === "deep") return process.env.TENSORRA_SHADOW_DEEP_MODEL?.trim();
  return process.env.TENSORRA_SHADOW_VISION_MODEL?.trim();
}

export function productionModelFor(role: TensorraModelRole) {
  return envForRole(role);
}

export function candidateModelFor(role: TensorraModelRole) {
  return candidateEnv(role) || null;
}

export function shadowModelFor(role: TensorraModelRole) {
  return shadowEnv(role) || candidateEnv(role) || null;
}

export function shadowSampleRate() {
  const parsed = Number(process.env.TENSORRA_SHADOW_SAMPLE_RATE ?? "0");
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function stableFraction(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function shouldShadowRequest(key: string) {
  const rate = shadowSampleRate();
  return rate > 0 && stableFraction(key) < rate;
}

export function registrySnapshot(): RegisteredModel[] {
  const items: RegisteredModel[] = [];

  for (const role of ["fast", "deep", "vision"] as const) {
    const production = productionModelFor(role);
    items.push({
      key: `${role}:production`,
      label: `${role.toUpperCase()} production`,
      model: production,
      role,
      stage: "production",
      provider: modelProvider(production),
    });

    const candidate = candidateModelFor(role);
    if (candidate && candidate !== production) {
      items.push({
        key: `${role}:candidate`,
        label: `${role.toUpperCase()} candidate`,
        model: candidate,
        role,
        stage: "candidate",
        provider: modelProvider(candidate),
      });
    }

    const shadow = shadowModelFor(role);
    if (shadow && shadow !== production && shadow !== candidate) {
      items.push({
        key: `${role}:shadow`,
        label: `${role.toUpperCase()} shadow`,
        model: shadow,
        role,
        stage: "shadow",
        provider: modelProvider(shadow),
      });
    }
  }

  return items;
}
