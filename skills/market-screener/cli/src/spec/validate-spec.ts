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
const FUNNEL_TRACKS = ["quality_track", "mispricing_track"] as const;

const ALLOWED_REQUIRED_KEYS = new Set([
  "min",
  "max",
  "default",
  "market_overrides",
  "missing",
  "field",
]);

const FORBIDDEN_THRESHOLD_KEYS = new Set(["max_decline_pp"]);
const MARKET_METRIC_KEYS = new Set(["CN", "US"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMarketMetricRule(rule: Record<string, unknown>): boolean {
  const keys = Object.keys(rule);
  return keys.length > 0 && keys.every((key) => MARKET_METRIC_KEYS.has(key));
}

function validateRuleObject(
  path: string,
  rule: Record<string, unknown>,
  strictKeys: boolean,
  errors: string[]
): void {
  if (isMarketMetricRule(rule)) {
    for (const [market, subRule] of Object.entries(rule)) {
      if (isRecord(subRule)) {
        validateRuleObject(`${path}.${market}`, subRule, strictKeys, errors);
      }
    }
    return;
  }

  for (const key of Object.keys(rule)) {
    if (FORBIDDEN_THRESHOLD_KEYS.has(key)) {
      errors.push(`${path}: forbidden threshold key "${key}" — use derived metric + max/min`);
      continue;
    }
    if (strictKeys && !ALLOWED_REQUIRED_KEYS.has(key)) {
      errors.push(`${path}: unsupported threshold key "${key}"`);
    }
  }
}

function validateTrackThresholds(
  templatePath: string,
  trackName: string,
  trackDef: unknown,
  errors: string[]
): void {
  if (!isRecord(trackDef)) return;

  const required = trackDef.required;
  if (isRecord(required)) {
    for (const [metric, rule] of Object.entries(required)) {
      if (isRecord(rule)) {
        validateRuleObject(
          `${templatePath}.${trackName}.required.${metric}`,
          rule,
          true,
          errors
        );
      }
    }
  }

  const supporting = trackDef.supporting;
  if (Array.isArray(supporting)) {
    for (const [index, rule] of supporting.entries()) {
      if (isRecord(rule)) {
        validateRuleObject(
          `${templatePath}.${trackName}.supporting[${index}]`,
          rule,
          false,
          errors
        );
      }
    }
  }
}

function validateTemplateThresholds(
  templatePath: string,
  template: Record<string, unknown>,
  errors: string[]
): void {
  for (const trackName of FUNNEL_TRACKS) {
    validateTrackThresholds(templatePath, trackName, template[trackName], errors);
  }

  const subTemplates = template.sub_templates;
  if (!isRecord(subTemplates)) return;

  for (const [subId, subTemplate] of Object.entries(subTemplates)) {
    if (!isRecord(subTemplate)) continue;
    for (const trackName of FUNNEL_TRACKS) {
      validateTrackThresholds(`${templatePath}.${subId}`, trackName, subTemplate[trackName], errors);
    }
  }
}

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

  for (const [templateId, template] of Object.entries(bundle.templates)) {
    if (isRecord(template)) {
      validateTemplateThresholds(templateId, template, errors);
    }
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
