/**
 * 筛选政策：读取并校验 A 股策略、美股模板及价格观察参数。
 * 财务事实的定义位于 financial-model.ts；此处保留旧政策目录的读取兼容。
 */
import { z } from "zod";
import fs from "node:fs/promises";
import { parse } from "yaml";
import path from "node:path";
import { DEFAULT_POLICY_DIR } from "../shared/runtime.js";

// 模板政策契约：供美股运行及历史模板结果解释使用。
export const IndexSchema = z.object({
  version: z.string(),
  status: z.string(),
  tightening_profile: z.string(),
  templates: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      tracks: z.array(z.string()).optional(),
    }),
  ),
  principles: z
    .object({
      funnel_soft_cap_per_market: z.number().optional(),
    })
    .optional(),
  machine_rules: z
    .object({
      exclusions: z.string().optional(),
      metrics: z.string().optional(),
      selection: z.string().optional(),
      universe: z.string().optional(),
      conventions: z.string().optional(),
      routing: z
        .object({
          us: z.string().optional(),
          cn: z.string().optional(),
          gics_and_proxy: z.string().optional(),
          cn_primary: z.string().optional(),
        })
        .optional(),
      landmine_pricing: z.string().optional(),
      landmine: z.string().optional(),
    })
    .optional(),
});

export const ExclusionRulesSchema = z.object({
  version: z.string().optional(),
  universe: z.record(z.unknown()),
  gates: z.array(z.record(z.unknown())),
  flags_not_exclusions: z.array(z.record(z.unknown())).optional(),
  live_quote_prefilter: z.record(z.unknown()).optional(),
  enrichment_failures: z.record(z.unknown()).optional(),
});

export const RoutingMapSchema = z.object({
  version: z.string().optional(),
  classifier: z.record(z.unknown()).optional(),
  mappings: z.array(z.record(z.unknown())),
  industry_proxy_map: z.array(z.record(z.unknown())).optional(),
  ambiguous_union_rules: z.record(z.unknown()).optional(),
});

export const CnIndustryMapSchema = z.object({
  version: z.string().optional(),
  taxonomy: z.string().optional(),
  legacy_l1_aliases: z.record(z.string()).optional(),
  l1_defaults: z.record(z.record(z.unknown())).optional(),
  l2_overrides: z.array(z.record(z.unknown())).optional(),
  proxy_keyword_excludes: z.array(z.record(z.unknown())).optional(),
  proxy_keyword_additions: z.array(z.record(z.unknown())).optional(),
});

export const SectorTemplateSchema = z
  .object({
    version: z.string().optional(),
    template: z.string(),
    tracks: z.array(z.string()),
  })
  .passthrough();

export type IndexSpec = z.infer<typeof IndexSchema>;
export type ExclusionRulesSpec = z.infer<typeof ExclusionRulesSchema>;
export type RoutingMapSpec = z.infer<typeof RoutingMapSchema>;
export type CnIndustryMapSpec = z.infer<typeof CnIndustryMapSchema>;
export type SectorTemplateSpec = z.infer<typeof SectorTemplateSchema>;

export interface SpecBundle {
  specDir: string;
  index: IndexSpec;
  exclusionRules: ExclusionRulesSpec;
  routing: {
    us: RoutingMapSpec;
    cn?: CnIndustryMapSpec;
  };
  metricPolicy: Record<string, unknown>;
  selectionPolicy: Record<string, unknown>;
  landminePricing: Record<string, unknown>;
  templates: Record<string, SectorTemplateSpec>;
}

const positive = z.number().finite().positive();
const ratio = z.number().finite().min(0).max(1);
// A 股策略参数：质量、金融及 NCAV 的阈值；事实是否可靠由财务模型与证据校验决定。
export const cnPolicySchema = z
  .object({
    version: z.string().min(1),
    /** Accepted only for old policy files; segment shares no longer gate qualification. */
    business: z
      .object({ materialShare: ratio.refine((n) => n > 0) })
      .strict()
      .optional(),
    quality: z
      .object({
        roeMedian: positive,
        roeRecentMedian: positive,
        ocfConversion: positive,
        debtEquity: positive,
        debtOcf: positive,
      })
      .strict(),
    financial: z
      .object({
        futuresRiskCoverage: positive,
        trustRiskCoverage: positive,
        trustCapitalEquity: positive,
        nplCeiling: positive,
        nplIncrease: positive,
        provisionCoverage: positive,
        capitalMargin: positive,
        bankLcr: positive,
        bankNsfr: positive,
        brokerRiskCoverage: positive,
        brokerRelativeMargin: positive,
        leaseLiquidityRelativeMargin: positive,
      })
      .strict(),
    insurance: z
      .object({
        coreSolvency: positive,
        comprehensiveSolvency: positive,
        combinedRatio: positive,
        latestCombinedRatio: positive,
      })
      .strict(),
    priority: z
      .object({
        roeMedian: positive,
        roeRecentFloor: positive,
        fcfConversion: positive,
        earningsHaircut: ratio,
        earningsYield: positive,
        normalEarningsYield: positive.optional(),
        displayLimit: z.number().int().nonnegative(),
        backupLimit: z.number().int().nonnegative().optional(),
      })
      .strict().refine(p => p.normalEarningsYield === undefined || p.normalEarningsYield < p.earningsYield,
        "Normal-price earnings yield must be below the low-price threshold"),
    /** 独立策略有自己的必要条件，不继承质量漏斗的前置通过资格。 */
    strategies: z
      .object({
        financialDiscount: z
          .object({
            maxPb: positive,
            earningsHaircut: ratio,
            minEarningsYield: positive,
            positiveProfitYears: z.number().int().min(1).max(5),
            /** Historical policy alias; new policies use priority.backupLimit. */
            displayLimit: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        ncav: z
          .object({ marketCapRatio: ratio.refine((n) => n > 0) })
          .strict()
          .optional(),
        financial: z
          .object({
            methods: z
              .array(
                z.enum([
                  "bank",
                  "broker",
                  "pc_insurance",
                  "life_insurance",
                  "insurance_group",
                  "trust",
                  "futures",
                ]),
              )
              .min(1),
            positiveProfitYears: z.number().int().min(1).max(5),
            roeMedian: positive,
            roeRecentMedian: positive,
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CnPolicy = z.infer<typeof cnPolicySchema>;
export function parseCnPolicy(text: string): CnPolicy {
  return cnPolicySchema.parse(parse(text));
}
export async function loadCnPolicy(file: string): Promise<CnPolicy> {
  try {
    return parseCnPolicy(await fs.readFile(file, "utf8"));
  } catch (error) {
    // 自定义政策目录可沿用旧文件名；损坏的新文件必须报错，不能被旧文件掩盖。
    if (!isMissingFile(error) || path.basename(file) !== "cn-screening.yaml") throw error;
    return parseCnPolicy(
      await fs.readFile(path.join(path.dirname(file), "cn-quality.yaml"), "utf8"),
    );
  }
}

export type TemplateLiveViability = "full" | "proxy" | "quant_too_hard";

export function templateLiveViability(
  bundle: SpecBundle,
  templateId: string,
  subTemplateId?: string,
): TemplateLiveViability {
  const manifest = (
    bundle.metricPolicy as {
      template_live_viability?: Record<
        string,
        TemplateLiveViability | Record<string, TemplateLiveViability>
      >;
    }
  ).template_live_viability;
  if (!manifest) return "full";

  const entry = manifest[templateId];
  if (!entry) return "full";
  if (typeof entry === "string") return entry;
  if (subTemplateId && entry[subTemplateId]) return entry[subTemplateId];
  return "full";
}

export function funnelSoftCapFromBundle(bundle: SpecBundle): number {
  const selection = bundle.selectionPolicy as {
    funnel_soft_cap?: { max_candidates_per_market?: number };
  };
  return (
    selection.funnel_soft_cap?.max_candidates_per_market ??
    bundle.index.principles?.funnel_soft_cap_per_market ??
    20
  );
}

export function deferredWatchlistCapFromBundle(bundle: SpecBundle): number {
  const selection = bundle.selectionPolicy as {
    deferred_watchlist_cap?: { max_deferred_per_market?: number };
  };
  return selection.deferred_watchlist_cap?.max_deferred_per_market ?? 20;
}

export interface TemplateSeatPoolConfig {
  floor: number;
  cap: number;
}

export interface TemplateSeatAllocationConfig {
  pools: Record<string, TemplateSeatPoolConfig>;
  flex: { confluence_weight_multiplier: number };
  backfill: { tier1: string; tier2: string };
}

const DEFAULT_SEAT_ALLOCATION: TemplateSeatAllocationConfig = {
  pools: {
    healthcare_quality: { floor: 2, cap: 5 },
    consumer_quality: { floor: 2, cap: 4 },
    manufacturing_quality: { floor: 2, cap: 4 },
    cyclicals_quality: { floor: 0, cap: 3 },
    financials_quality: { floor: 0, cap: 3 },
    tech_saas_quality: { floor: 0, cap: 3 },
    healthcare_mispricing: { floor: 0, cap: 1 },
    consumer_mispricing: { floor: 0, cap: 1 },
    cyclicals_mispricing: { floor: 0, cap: 1 },
    manufacturing_mispricing: { floor: 0, cap: 1 },
    financials_mispricing: { floor: 0, cap: 1 },
    tech_saas_mispricing: { floor: 0, cap: 1 },
  },
  flex: { confluence_weight_multiplier: 2 },
  backfill: { tier1: "same_template_quality", tier2: "global_quality" },
};

export function seatAllocationFromBundle(bundle: SpecBundle): TemplateSeatAllocationConfig {
  const selection = bundle.selectionPolicy as {
    template_seat_allocation?: Partial<TemplateSeatAllocationConfig>;
  };
  const configured = selection.template_seat_allocation;
  if (!configured?.pools) return DEFAULT_SEAT_ALLOCATION;

  return {
    pools: configured.pools,
    flex: configured.flex ?? DEFAULT_SEAT_ALLOCATION.flex,
    backfill: configured.backfill ?? DEFAULT_SEAT_ALLOCATION.backfill,
  };
}

export interface NorthStarSpec {
  metric: string;
  direction: "desc" | "asc";
}

export function parseNorthStar(raw: string): NorthStarSpec {
  const [metric, dir] = raw.split(":");
  if (dir === "asc") return { metric, direction: "asc" };
  return { metric, direction: "desc" };
}

export function northStarForPool(bundle: SpecBundle, poolKey: string): NorthStarSpec | undefined {
  const map = (bundle.selectionPolicy as { pool_tie_break_north_star?: Record<string, string> })
    .pool_tie_break_north_star;
  if (!map) return undefined;

  const raw =
    map[poolKey] ?? (poolKey.endsWith("_quality") ? map.default_quality : map.default_mispricing);
  return raw ? parseNorthStar(raw) : undefined;
}

export interface ManifestReviewThresholds {
  promote_min_rate: number;
  demote_warn_rate: number;
  min_routed: number;
}

export function manifestReviewThresholdsFromBundle(bundle: SpecBundle): ManifestReviewThresholds {
  const mc = (
    bundle.metricPolicy as {
      metric_coverage?: { manifest_review?: Partial<ManifestReviewThresholds> };
    }
  ).metric_coverage?.manifest_review;
  return {
    promote_min_rate: mc?.promote_min_rate ?? 0.7,
    demote_warn_rate: mc?.demote_warn_rate ?? 0.5,
    min_routed: mc?.min_routed ?? 5,
  };
}

async function readYamlFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return parse(raw);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// 当前文件将模板内联；对旧调用者构造原有接口，不重新生成旧目录。
async function loadTemplateBundle(
  policyDir: string,
  legacy: Record<string, unknown>,
): Promise<SpecBundle> {
  const templatesRaw = legacy.templates as Record<string, unknown> | undefined;
  const templateEntries = Object.entries(templatesRaw ?? {}).map(([id, value]) => {
    const template = SectorTemplateSchema.parse(value);
    return {
      id,
      // This is a stable compatibility value for historical bundle consumers;
      // compact policy keeps the template inline rather than at this path.
      file: `templates/${id.replaceAll("_", "-")}.yaml`,
      tracks: template.tracks,
    };
  });
  const selectionPolicy = (legacy.selectionPolicy ?? {}) as Record<string, unknown>;
  const softCap = (
    selectionPolicy.funnel_soft_cap as { max_candidates_per_market?: unknown } | undefined
  )?.max_candidates_per_market;
  const index = IndexSchema.parse({
    version: legacy.version,
    status: legacy.status,
    tightening_profile: legacy.tightening_profile,
    templates: templateEntries,
    principles: typeof softCap === "number" ? { funnel_soft_cap_per_market: softCap } : undefined,
    // Retained only in the returned compatibility index. Compact policy does
    // not resolve or read any of these former standalone files.
    machine_rules: {
      exclusions: "exclusion-rules.yaml",
      metrics: "metric-policy.yaml",
      selection: "selection-policy.yaml",
      routing: { us: "routing-us.yaml", cn: "routing-cn.yaml" },
      landmine_pricing: "landmine-pricing.yaml",
    },
  });
  const templates: SpecBundle["templates"] = {};
  for (const entry of templateEntries) {
    templates[entry.id] = SectorTemplateSchema.parse(templatesRaw?.[entry.id]);
  }
  return {
    specDir: policyDir,
    index,
    exclusionRules: ExclusionRulesSchema.parse(legacy.exclusionRules),
    routing: {
      us: RoutingMapSchema.parse((legacy.routing as Record<string, unknown> | undefined)?.us),
      cn: CnIndustryMapSchema.parse((legacy.routing as Record<string, unknown> | undefined)?.cn),
    },
    metricPolicy: (legacy.metricPolicy ?? {}) as Record<string, unknown>,
    selectionPolicy,
    landminePricing: (await readYamlFile(path.join(policyDir, "landmine.yaml"))) as Record<
      string,
      unknown
    >,
    templates,
  };
}

/**
 * Load the bundled single-file policy. A directory using the former index.yaml
 * layout remains accepted for user-maintained historical policy overrides.
 */
export async function loadSpecBundle(specDir = DEFAULT_POLICY_DIR): Promise<SpecBundle> {
  const resolvedDir = path.resolve(specDir);
  for (const filename of ["template-screening.yaml", "legacy.yaml"]) {
    try {
      const bundle = await readYamlFile(path.join(resolvedDir, filename));
      return loadTemplateBundle(resolvedDir, bundle as Record<string, unknown>);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  return loadLegacyOverride(resolvedDir);
}

/** Load pricing policy without parsing the template/routing bundle. */
export async function loadLandminePricing(
  policyDir = DEFAULT_POLICY_DIR,
): Promise<Record<string, unknown>> {
  const resolvedDir = path.resolve(policyDir);
  try {
    return (await readYamlFile(path.join(resolvedDir, "landmine.yaml"))) as Record<string, unknown>;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    const index = IndexSchema.parse(await readYamlFile(path.join(resolvedDir, "index.yaml")));
    const filename =
      index.machine_rules?.landmine_pricing ??
      index.machine_rules?.landmine ??
      "landmine-pricing.yaml";
    return (await readYamlFile(path.join(resolvedDir, filename))) as Record<string, unknown>;
  }
}

// 外部旧政策目录兼容：仅在未提供当前模板文件时读取旧索引。
async function loadLegacyOverride(specDir: string): Promise<SpecBundle> {
  const indexRaw = await readYamlFile(path.join(specDir, "index.yaml"));
  const index = IndexSchema.parse(indexRaw);
  const rules = index.machine_rules ?? {};
  const exclusionRulesPath =
    rules.exclusions ?? rules.universe?.split("#")[0] ?? "exclusion-rules.yaml";
  const metricPolicyPath = rules.metrics ?? rules.conventions ?? "metric-policy.yaml";
  const selectionPolicyPath = rules.selection ?? metricPolicyPath;
  const landminePricingPath = rules.landmine_pricing ?? rules.landmine ?? "landmine-pricing.yaml";

  const exclusionRules = ExclusionRulesSchema.parse(
    await readYamlFile(path.join(specDir, exclusionRulesPath)),
  );
  const routingRefs = index.machine_rules?.routing;
  const usRoutingPath = routingRefs?.us ?? routingRefs?.gics_and_proxy ?? "routing-us.yaml";
  const cnRoutingPath = routingRefs?.cn ?? routingRefs?.cn_primary ?? "routing-cn.yaml";

  const usRouting = RoutingMapSchema.parse(await readYamlFile(path.join(specDir, usRoutingPath)));
  const cnRouting = cnRoutingPath
    ? CnIndustryMapSchema.parse(await readYamlFile(path.join(specDir, cnRoutingPath)))
    : undefined;
  const metricPolicy = (await readYamlFile(path.join(specDir, metricPolicyPath))) as Record<
    string,
    unknown
  >;
  const selectionPolicy = (await readYamlFile(path.join(specDir, selectionPolicyPath))) as Record<
    string,
    unknown
  >;
  const landminePricing = (await readYamlFile(path.join(specDir, landminePricingPath))) as Record<
    string,
    unknown
  >;

  const templates: SpecBundle["templates"] = {};
  for (const t of index.templates) {
    const tplPath = path.join(specDir, "templates", path.basename(t.file));
    templates[t.id] = SectorTemplateSchema.parse(await readYamlFile(tplPath));
  }

  return {
    specDir,
    index,
    exclusionRules,
    routing: {
      us: usRouting,
      cn: cnRouting,
    },
    metricPolicy,
    selectionPolicy,
    landminePricing,
    templates,
  };
}

const REQUIRED_TEMPLATE_IDS = [
  "financials",
  "tech_saas",
  "consumer",
  "cyclicals",
  "manufacturing",
] as const;

const FUNNEL_SOFT_CAP = 20;
const KILL_MARKET_CAP_SLUG = "kill_market_cap_below_floor";
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
  errors: string[],
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
  errors: string[],
): void {
  if (!isRecord(trackDef)) return;

  const required = trackDef.required;
  if (isRecord(required)) {
    for (const [metric, rule] of Object.entries(required)) {
      if (isRecord(rule)) {
        validateRuleObject(`${templatePath}.${trackName}.required.${metric}`, rule, true, errors);
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
          errors,
        );
      }
    }
  }
}

function validateCnIndustryTemplateRef(
  refPath: string,
  template: unknown,
  alsoRun: unknown,
  bundle: SpecBundle,
  errors: string[],
): void {
  if (typeof template === "string" && !bundle.templates[template]) {
    errors.push(`${refPath}: unknown template "${template}"`);
  }
  if (Array.isArray(alsoRun)) {
    for (const id of alsoRun) {
      if (typeof id === "string" && !bundle.templates[id]) {
        errors.push(`${refPath}.also_run: unknown template "${id}"`);
      }
    }
  } else if (typeof alsoRun === "string" && !bundle.templates[alsoRun]) {
    errors.push(`${refPath}.also_run: unknown template "${alsoRun}"`);
  }
}

function validateCnIndustryMap(bundle: SpecBundle, errors: string[]): void {
  const map = bundle.routing.cn;
  if (!map?.l1_defaults) return;

  for (const [l1, rule] of Object.entries(map.l1_defaults)) {
    if (!isRecord(rule)) continue;
    validateCnIndustryTemplateRef(
      `routing-cn.yaml l1_defaults.${l1}`,
      rule.template,
      rule.also_run,
      bundle,
      errors,
    );
  }

  for (const [index, override] of (map.l2_overrides ?? []).entries()) {
    if (!isRecord(override)) continue;
    validateCnIndustryTemplateRef(
      `routing-cn.yaml l2_overrides[${index}]`,
      override.template,
      override.also_run,
      bundle,
      errors,
    );
  }

  for (const [index, entry] of (map.proxy_keyword_additions ?? []).entries()) {
    if (!isRecord(entry)) continue;
    validateCnIndustryTemplateRef(
      `routing-cn.yaml proxy_keyword_additions[${index}]`,
      entry.template,
      entry.also_run,
      bundle,
      errors,
    );
  }
}

function validateTemplateThresholds(
  templatePath: string,
  template: Record<string, unknown>,
  errors: string[],
): void {
  for (const trackName of FUNNEL_TRACKS) {
    validateTrackThresholds(templatePath, trackName, template[trackName], errors);
  }

  const subTemplates = template.sub_templates;
  if (!isRecord(subTemplates)) return;

  for (const [subId, subTemplate] of Object.entries(subTemplates)) {
    if (!isRecord(subTemplate)) continue;
    for (const trackName of FUNNEL_TRACKS) {
      validateTrackThresholds(
        `${templatePath}.${subId}`,
        trackName,
        subTemplate[trackName],
        errors,
      );
    }
  }
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  fileCount: number;
}

// 政策校验：引用必须可解析、阈值方向必须明确，错误配置不能静默放宽筛选。
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

  for (const mapping of bundle.routing.us.mappings) {
    const template = mapping.template;
    if (typeof template === "string" && !bundle.templates[template]) {
      errors.push(`routing-us.yaml references unknown template: ${template}`);
    }

    const alsoRun = mapping.also_run;
    if (typeof alsoRun === "string" && !bundle.templates[alsoRun]) {
      errors.push(`routing-us.yaml also_run references unknown template: ${alsoRun}`);
    }
  }

  if (bundle.routing.cn) {
    validateCnIndustryMap(bundle, errors);
  }

  const hasMarketCapKill = bundle.exclusionRules.gates.some(
    (gate) => gate.reason_slug === KILL_MARKET_CAP_SLUG,
  );
  if (!hasMarketCapKill) {
    errors.push(`exclusion-rules.yaml must include reason_slug "${KILL_MARKET_CAP_SLUG}"`);
  }

  for (const [templateId, template] of Object.entries(bundle.templates)) {
    if (isRecord(template)) {
      validateTemplateThresholds(templateId, template, errors);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    fileCount: 0,
  };
}

export async function validateSpecDir(specDir: string): Promise<ValidateResult> {
  const bundle = await loadSpecBundle(specDir);
  const result = validateSpecBundle(bundle);
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const cnPolicy = join(specDir, "cn-screening.yaml");
  // Custom US-only bundles need not contain a CN policy.
  if (existsSync(cnPolicy) || existsSync(join(specDir, "cn-quality.yaml"))) {
    try {
      await loadCnPolicy(cnPolicy);
    } catch (error) {
      result.ok = false;
      result.errors.push(`cn-screening.yaml: ${error instanceof Error ? error.message : error}`);
    }
  }
  // Count the concrete policy assets for display only. It deliberately makes no
  // claim about a required policy file count, since external overrides may use
  // either the compact or historical layout.
  try {
    const { readdir } = await import("node:fs/promises");
    result.fileCount = (await readdir(specDir)).filter((name) =>
      /\.(?:yaml|json)$/.test(name),
    ).length;
  } catch {
    // Parsing already produced the actionable validation result.
  }
  return result;
}
