import type { SpecBundle } from "./types.js";
import { funnelSoftCapFromBundle } from "./conventions.js";

const REQUIRED_TEMPLATE_IDS = [
  "financials",
  "tech_saas",
  "consumer",
  "cyclicals",
  "manufacturing",
] as const;

const FUNNEL_SOFT_CAP = 25;
const KILL_MARKET_CAP_SLUG = "kill_market_cap_below_floor";
const CORE_SPEC_FILES = 7;

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  fileCount: number;
}

export function validateSpecBundle(bundle: SpecBundle): ValidateResult {
  const errors: string[] = [];

  for (const id of REQUIRED_TEMPLATE_IDS) {
    if (!bundle.templates[id]) {
      errors.push(`Missing required template: ${id}`);
    }
  }

  for (const entry of bundle.index.templates) {
    if (!bundle.templates[entry.id]) {
      errors.push(`Index references template "${entry.id}" that is not loaded`);
    }
  }

  const cap = funnelSoftCapFromBundle(bundle);
  if (cap !== FUNNEL_SOFT_CAP) {
    errors.push(`funnel soft cap must be ${FUNNEL_SOFT_CAP} (got ${cap})`);
  }

  for (const mapping of bundle.routingMap.mappings) {
    const template = mapping.template;
    if (typeof template === "string" && !bundle.templates[template]) {
      errors.push(`routing-map references unknown template: ${template}`);
    }

    const alsoRun = mapping.also_run;
    if (typeof alsoRun === "string" && !bundle.templates[alsoRun]) {
      errors.push(`routing-map also_run references unknown template: ${alsoRun}`);
    }
  }

  const hasMarketCapKill = bundle.killGates.gates.some(
    (gate) => gate.reason_slug === KILL_MARKET_CAP_SLUG
  );
  if (!hasMarketCapKill) {
    errors.push(`kill-gates must include reason_slug "${KILL_MARKET_CAP_SLUG}"`);
  }

  return {
    ok: errors.length === 0,
    errors,
    fileCount: CORE_SPEC_FILES + Object.keys(bundle.templates).length,
  };
}

export async function validateSpecDir(specDir: string): Promise<ValidateResult> {
  const { loadSpecBundle } = await import("./loader.js");
  const bundle = await loadSpecBundle(specDir);
  return validateSpecBundle(bundle);
}
