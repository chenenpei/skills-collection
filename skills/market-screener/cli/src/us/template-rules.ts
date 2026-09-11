/**
 * 模板阈值、排除规则和行业路由的纯规则层。
 * 输入为标准化 SecurityRecord 与策略配置；输出为逐项规则结果、排除原因和模板路由。
 * US 模板筛选与旧版 CN 归档记录共用此接口，因此对 market override 和缺失值保持显式处理。
 */
import {
  type CnIndustryMapSpec,
  type RoutingMapSpec,
  type SectorTemplateSpec,
  type ExclusionRulesSpec,
  type SpecBundle,
  templateLiveViability,
} from "../policy/loader.js";

import type {
  DataConfidence,
  Market,
  MetricValue,
  SecurityRecord,
} from "../shared/financial-model.js";

export interface RoutedTemplate {
  id: string;
  subTemplate?: string;
}

export type { Market, DataConfidence, MetricValue } from "../shared/financial-model.js";

export type FunnelTrack = "quality" | "mispricing";

export interface ThresholdRule {
  min?: number;
  max?: number;
  default?: number;
  market_overrides?: Partial<Record<Market, number>>;
  market_missing_overrides?: Partial<Record<Market, "skip">>;
  missing?: "skip" | "data_confidence_low" | "use_ps_vs_peer";
  field?: string;
}

export interface ThresholdResult {
  passed: boolean;
  skipped: boolean;
  dataConfidence: DataConfidence;
}

export function resolveThresholdBound(
  rule: ThresholdRule,
  market: Market,
): { min?: number; max?: number } {
  if (rule.market_overrides && (rule.default !== undefined || rule.min !== undefined)) {
    const floor = rule.market_overrides[market] ?? rule.default ?? rule.min;
    return { min: floor, max: rule.max };
  }
  return { min: rule.min, max: rule.max };
}

export function isMarketMissingOverrideSkip(rule: ThresholdRule, market: Market): boolean {
  return rule.market_missing_overrides?.[market] === "skip";
}

export function shouldSkipMissingMetric(rule: ThresholdRule, market: Market): boolean {
  return rule.missing === "skip" || isMarketMissingOverrideSkip(rule, market);
}

export function evaluateThreshold(
  metric: MetricValue | undefined,
  rule: ThresholdRule,
  market: Market,
): ThresholdResult {
  if (metric?.value === undefined) {
    if (shouldSkipMissingMetric(rule, market)) {
      return { passed: true, skipped: true, dataConfidence: "medium" };
    }
    return { passed: false, skipped: false, dataConfidence: "low" };
  }

  const { min, max } = resolveThresholdBound(rule, market);
  let passed = true;
  if (min !== undefined && metric.value < min) passed = false;
  if (max !== undefined && metric.value > max) passed = false;

  return {
    passed,
    skipped: false,
    dataConfidence: metric.dataConfidence,
  };
}

export function formatThresholdMiss(
  metric: MetricValue | undefined,
  rule: ThresholdRule,
  market: Market,
): string {
  if (metric?.value === undefined) {
    return shouldSkipMissingMetric(rule, market) ? "missing (skipped)" : "missing";
  }
  const { min, max } = resolveThresholdBound(rule, market);
  const value = metric.value;
  if (min !== undefined && value < min) {
    return `value ${value} < min ${min}`;
  }
  if (max !== undefined && value > max) {
    return `value ${value} > max ${max}`;
  }
  return "threshold_not_met";
}

export interface TemplateEvalResult {
  passed: boolean;
  passedTrack?: FunnelTrack;
  metricSnapshot: Record<string, MetricValue>;
  supportingPassCount: number;
  supportingTotal: number;
  auditHints: string[];
  funnelFlags: string[];
}

export type RuleOutcomeKind = "pass" | "fail" | "skip";

export interface RuleOutcome {
  metric: string;
  kind: RuleOutcomeKind;
  skipReason?: "missing" | "conditional" | "market_override";
  detail?: string;
  value?: number;
}

export type TemplateFailureStage = "no_track" | "required" | "supporting_min";

export interface TemplateTrackDiagnostic {
  template: string;
  subTemplate?: string;
  track: FunnelTrack;
  passed: boolean;
  failureStage?: TemplateFailureStage;
  requiredOutcomes: RuleOutcome[];
  supportingOutcomes: RuleOutcome[];
  supportingPassCount: number;
  supportingTotal: number;
  supportingMin: number;
  supportingSkipped: number;
}

function parsePassLogic(passIf: string): { supportingMin: number; supportingTotal: number } {
  const match = passIf.match(/min_(\d+)_of_(\d+)/);
  if (!match) return { supportingMin: 0, supportingTotal: 0 };
  return { supportingMin: Number(match[1]), supportingTotal: Number(match[2]) };
}

function toThresholdRule(rule: Record<string, unknown>): ThresholdRule {
  const threshold = { ...rule } as ThresholdRule & Record<string, unknown>;
  delete threshold.metric;
  delete threshold.if_unprofitable;
  delete threshold.if_fcf_negative;
  return threshold;
}

export function resolveTemplateForEvaluation(
  template: SectorTemplateSpec & Record<string, unknown>,
  subTemplateId?: string,
): SectorTemplateSpec & Record<string, unknown> {
  if (!subTemplateId) return template;
  const subTemplates = template.sub_templates as
    | Record<string, Record<string, unknown>>
    | undefined;
  const sub = subTemplates?.[subTemplateId];
  if (!sub) return template;
  const merged = { ...template, ...sub };
  delete merged.sub_templates;
  return merged;
}

type SupportingSkipReason = "missing" | "conditional";

function resolveMetricValue(
  record: SecurityRecord,
  metric: string,
  rule: Record<string, unknown>,
): MetricValue | undefined {
  const direct = record.metrics[metric];
  if (direct?.value !== undefined) return direct;
  if (metric === "ps_vs_5y_median" && rule.missing === "use_ps_vs_peer") {
    return record.metrics.ps_vs_peer_median;
  }
  return direct;
}

function getSupportingSkipReason(
  rule: Record<string, unknown>,
  record: SecurityRecord,
  metric: MetricValue | undefined,
): SupportingSkipReason | undefined {
  if (rule.if_unprofitable === "skip") {
    const netIncome = record.metrics.net_income?.value;
    if (netIncome !== undefined && netIncome < 0) return "conditional";
  }
  if (rule.if_fcf_negative === "skip") {
    const fcf = record.metrics.fcf_margin?.value ?? record.metrics.free_cash_flow?.value;
    if (fcf !== undefined && fcf < 0) return "conditional";
  }
  if (
    metric?.value === undefined &&
    shouldSkipMissingMetric(toThresholdRule(rule), record.market)
  ) {
    return "missing";
  }
  return undefined;
}

function evalRuleList(
  rules: Array<Record<string, unknown>>,
  record: SecurityRecord,
): {
  passCount: number;
  total: number;
  snapshot: Record<string, MetricValue>;
  missingSkipCount: number;
  otherSkipCount: number;
  marketMissingSkippedMetrics: string[];
} {
  let passCount = 0;
  let total = 0;
  let missingSkipCount = 0;
  let otherSkipCount = 0;
  const marketMissingSkippedMetrics: string[] = [];
  const snapshot: Record<string, MetricValue> = {};

  for (const rule of rules) {
    const metric = rule.metric as string | undefined;
    if (!metric) continue;

    const mv = resolveMetricValue(record, metric, rule);
    const skipReason = getSupportingSkipReason(rule, record, mv);
    if (skipReason === "missing") {
      missingSkipCount += 1;
      if (isMarketMissingOverrideSkip(toThresholdRule(rule), record.market)) {
        marketMissingSkippedMetrics.push(metric);
      }
      continue;
    }
    if (skipReason === "conditional") {
      otherSkipCount += 1;
      continue;
    }

    total += 1;
    const result = evaluateThreshold(mv, toThresholdRule(rule), record.market);
    if (mv) snapshot[metric] = mv;
    if (result.passed) passCount += 1;
  }

  return {
    passCount,
    total,
    snapshot,
    missingSkipCount,
    otherSkipCount,
    marketMissingSkippedMetrics,
  };
}

function evalRequiredRules(
  required: Record<string, ThresholdRule>,
  record: SecurityRecord,
): { passed: boolean; outcomes: RuleOutcome[]; snapshot: Record<string, MetricValue> } {
  const outcomes: RuleOutcome[] = [];
  const snapshot: Record<string, MetricValue> = {};

  for (const [metric, rule] of Object.entries(required)) {
    const mv = resolveMetricValue(record, metric, rule as Record<string, unknown>);
    const res = evaluateThreshold(mv, rule, record.market);
    if (res.skipped) {
      outcomes.push({
        metric,
        kind: "skip",
        skipReason: shouldSkipMissingMetric(rule, record.market) ? "missing" : "conditional",
        detail: formatThresholdMiss(mv, rule, record.market),
      });
      continue;
    }
    if (!res.passed) {
      outcomes.push({
        metric,
        kind: "fail",
        value: mv?.value,
        detail: formatThresholdMiss(mv, rule, record.market),
      });
      return { passed: false, outcomes, snapshot };
    }
    outcomes.push({ metric, kind: "pass", value: mv?.value });
    if (mv) snapshot[metric] = mv;
  }

  return { passed: true, outcomes, snapshot };
}

function evalSupportingRules(
  rules: Array<Record<string, unknown>>,
  record: SecurityRecord,
): {
  passCount: number;
  total: number;
  outcomes: RuleOutcome[];
  missingSkipCount: number;
  otherSkipCount: number;
} {
  let passCount = 0;
  let total = 0;
  let missingSkipCount = 0;
  let otherSkipCount = 0;
  const outcomes: RuleOutcome[] = [];

  for (const rule of rules) {
    const metric = rule.metric as string | undefined;
    if (!metric) continue;

    const mv = resolveMetricValue(record, metric, rule);
    const thresholdRule = toThresholdRule(rule);
    const skipReason = getSupportingSkipReason(rule, record, mv);
    if (skipReason === "missing") {
      missingSkipCount += 1;
      outcomes.push({
        metric,
        kind: "skip",
        skipReason: isMarketMissingOverrideSkip(thresholdRule, record.market)
          ? "market_override"
          : "missing",
        detail: formatThresholdMiss(mv, thresholdRule, record.market),
      });
      continue;
    }
    if (skipReason === "conditional") {
      otherSkipCount += 1;
      outcomes.push({
        metric,
        kind: "skip",
        skipReason: "conditional",
        detail: formatThresholdMiss(mv, thresholdRule, record.market),
      });
      continue;
    }

    total += 1;
    const result = evaluateThreshold(mv, thresholdRule, record.market);
    if (result.passed) {
      passCount += 1;
      outcomes.push({ metric, kind: "pass", value: mv?.value });
    } else {
      outcomes.push({
        metric,
        kind: "fail",
        value: mv?.value,
        detail: formatThresholdMiss(mv, thresholdRule, record.market),
      });
    }
  }

  return { passCount, total, outcomes, missingSkipCount, otherSkipCount };
}

// 模板先返回每项可审计的诊断，再折叠为 pass/fail，供运行与复盘报告复用。
export function evaluateTemplateTrackDiagnostic(
  template: SectorTemplateSpec & Record<string, unknown>,
  track: "quality" | "mispricing",
  record: SecurityRecord,
  subTemplateId?: string,
): TemplateTrackDiagnostic {
  const evalTemplate = resolveTemplateForEvaluation(template, subTemplateId);
  const trackDef = evalTemplate[`${track}_track`] as Record<string, unknown> | undefined;
  const base: TemplateTrackDiagnostic = {
    template: (evalTemplate.template as string) ?? "unknown",
    subTemplate: subTemplateId,
    track,
    passed: false,
    requiredOutcomes: [],
    supportingOutcomes: [],
    supportingPassCount: 0,
    supportingTotal: 0,
    supportingMin: 0,
    supportingSkipped: 0,
  };

  if (!trackDef) {
    return { ...base, failureStage: "no_track" };
  }

  const required = (trackDef.required as Record<string, ThresholdRule>) ?? {};
  const { passed: requiredPassed, outcomes: requiredOutcomes } = evalRequiredRules(
    required,
    record,
  );

  const supportingRules = (trackDef.supporting as Array<Record<string, unknown>>) ?? [];
  const {
    passCount,
    total,
    outcomes: supportingOutcomes,
    missingSkipCount,
    otherSkipCount,
  } = evalSupportingRules(supportingRules, record);

  const passIf = (trackDef.pass_if as string) ?? "";
  const { supportingMin } = parsePassLogic(passIf);
  const supportingPassed = resolveSupportingPass(
    passCount,
    total,
    supportingMin,
    missingSkipCount,
    otherSkipCount,
  );

  const passed = requiredPassed && supportingPassed;
  let failureStage: TemplateFailureStage | undefined;
  if (!passed) {
    failureStage = !requiredPassed ? "required" : "supporting_min";
  }

  return {
    ...base,
    passed,
    failureStage,
    requiredOutcomes,
    supportingOutcomes,
    supportingPassCount: passCount,
    supportingTotal: total,
    supportingMin,
    supportingSkipped: missingSkipCount + otherSkipCount,
  };
}

/** Downgrade supportingMin only when fewer metrics are evaluable solely due to missing: skip. */
function resolveSupportingPass(
  passCount: number,
  total: number,
  supportingMin: number,
  missingSkipCount: number,
  otherSkipCount: number,
): boolean {
  if (total === 0) return false;
  if (total >= supportingMin) {
    return passCount >= supportingMin;
  }

  const gap = supportingMin - total;
  const downgradeEligible = otherSkipCount === 0 && missingSkipCount > 0 && gap <= missingSkipCount;

  if (downgradeEligible) {
    return passCount >= total;
  }

  return false;
}

export function evaluateTemplateTrack(
  template: SectorTemplateSpec & Record<string, unknown>,
  track: "quality" | "mispricing",
  record: SecurityRecord,
  subTemplateId?: string,
): TemplateEvalResult {
  const empty: TemplateEvalResult = {
    passed: false,
    metricSnapshot: {},
    supportingPassCount: 0,
    supportingTotal: 0,
    auditHints: [],
    funnelFlags: [],
  };

  const evalTemplate = resolveTemplateForEvaluation(template, subTemplateId);
  const trackDef = evalTemplate[`${track}_track`] as Record<string, unknown> | undefined;
  if (!trackDef) return empty;

  const snapshot: Record<string, MetricValue> = {};
  const required = (trackDef.required as Record<string, ThresholdRule>) ?? {};
  for (const [metric, rule] of Object.entries(required)) {
    const mv = resolveMetricValue(record, metric, rule as Record<string, unknown>);
    const res = evaluateThreshold(mv, rule, record.market);
    if (!res.passed && !res.skipped) return empty;
    if (mv) snapshot[metric] = mv;
  }

  const supportingRules = (trackDef.supporting as Array<Record<string, unknown>>) ?? [];
  const {
    passCount,
    total,
    snapshot: supportingSnapshot,
    missingSkipCount,
    otherSkipCount,
    marketMissingSkippedMetrics,
  } = evalRuleList(supportingRules, record);
  Object.assign(snapshot, supportingSnapshot);

  const passIf = (trackDef.pass_if as string) ?? "";
  const { supportingMin } = parsePassLogic(passIf);
  const passed = resolveSupportingPass(
    passCount,
    total,
    supportingMin,
    missingSkipCount,
    otherSkipCount,
  );

  const auditHints = ((evalTemplate.audit_hints as string[]) ?? []).slice();
  const funnelFlags = [
    ...((evalTemplate.funnel_flags as string[]) ?? []),
    ...((trackDef.funnel_flags as string[]) ?? []),
  ];

  if (
    record.market === "CN" &&
    marketMissingSkippedMetrics.some((m) => m === "sbc_to_revenue" || m === "share_dilution_3y")
  ) {
    funnelFlags.push("verify_sbc_dilution_in_deep_cn");
  }

  return {
    passed,
    passedTrack: passed ? track : undefined,
    metricSnapshot: snapshot,
    supportingPassCount: passCount,
    supportingTotal: total,
    auditHints,
    funnelFlags,
  };
}

export interface TemplateTrackResult {
  template: string;
  subTemplate?: string;
  track: FunnelTrack;
  result: TemplateEvalResult;
}

export type SeatSource =
  | "floor"
  | "cap"
  | "flex"
  | "backfill_same_template"
  | "backfill_global"
  | "deferred";

export interface PassingCandidate {
  ticker: string;
  market: SecurityRecord["market"];
  company_name: string;
  currency: string;
  industry_proxy?: string;
  routed_templates: string[];
  routing_confidence: RouteResult["routingConfidence"];
  routing_method: RouteResult["routingMethod"];
  matched_rule?: string;
  winning_template: string;
  track_confluence: boolean;
  passed_track: FunnelTrack;
  pool_score: number;
  seat_source?: SeatSource;
  sub_template?: string;
  metric_snapshot: TemplateEvalResult["metricSnapshot"];
  data_confidence: ExclusionResult["dataConfidence"];
  funnel_flags: string[];
  audit_mode: "deep";
  audit_hints: string[];
  compositeScore: number;
  supportingPassCount: number;
}

export function routeSecurityRecord(bundle: SpecBundle, record: SecurityRecord): RouteResult {
  return routeSecurity(bundle.routing.us, bundle.routing.cn, {
    market: record.market,
    gicsCode: record.gicsCode,
    industryProxy: record.industryProxy,
  });
}

export function listTemplateTrackResults(
  bundle: SpecBundle,
  record: SecurityRecord,
  route: RouteResult,
): TemplateTrackResult[] {
  const results: TemplateTrackResult[] = [];

  for (const tplRef of route.templates) {
    if (templateLiveViability(bundle, tplRef.id, tplRef.subTemplate) === "quant_too_hard") {
      continue;
    }
    const tpl = bundle.templates[tplRef.id];
    if (!tpl) continue;

    for (const track of tpl.tracks as FunnelTrack[]) {
      results.push({
        template: tplRef.id,
        subTemplate: tplRef.subTemplate,
        track,
        result: evaluateTemplateTrack(
          tpl as SectorTemplateSpec & Record<string, unknown>,
          track,
          record,
          tplRef.subTemplate,
        ),
      });
    }
  }

  return results;
}

interface TemplatePassTracks {
  quality?: TemplateTrackResult;
  mispricing?: TemplateTrackResult;
}

function buildPassingCandidate(
  record: SecurityRecord,
  kill: ExclusionResult,
  route: RouteResult,
  entries: TemplateTrackResult[],
): PassingCandidate | null {
  const routedTemplates = route.templates.map((t) => t.id);
  const byTemplate = new Map<string, TemplatePassTracks>();

  for (const entry of entries) {
    if (!entry.result.passed || !entry.result.passedTrack) continue;
    const bucket = byTemplate.get(entry.template) ?? {};
    if (entry.track === "quality") bucket.quality = entry;
    else bucket.mispricing = entry;
    byTemplate.set(entry.template, bucket);
  }

  if (byTemplate.size === 0) return null;

  let winningTemplate = "";
  let winningTracks: TemplatePassTracks = {};
  let bestTemplateScore = -1;

  for (const [template, tracks] of byTemplate) {
    const scores: number[] = [];
    if (tracks.quality?.result.passed) {
      scores.push(tracks.quality.result.supportingPassCount);
    }
    if (tracks.mispricing?.result.passed) {
      scores.push(tracks.mispricing.result.supportingPassCount);
    }
    const templateScore = Math.max(...scores);
    if (templateScore > bestTemplateScore) {
      bestTemplateScore = templateScore;
      winningTemplate = template;
      winningTracks = tracks;
    } else if (templateScore === bestTemplateScore && template.localeCompare(winningTemplate) < 0) {
      winningTemplate = template;
      winningTracks = tracks;
    }
  }

  const qualityPassed = winningTracks.quality?.result.passed === true;
  const mispricingPassed = winningTracks.mispricing?.result.passed === true;
  const trackConfluence = qualityPassed && mispricingPassed;
  const passedTrack: FunnelTrack = trackConfluence
    ? "quality"
    : qualityPassed
      ? "quality"
      : "mispricing";

  const winningEntry =
    passedTrack === "quality" ? winningTracks.quality! : winningTracks.mispricing!;
  const poolScore = winningEntry.result.supportingPassCount;

  return {
    ticker: record.ticker,
    market: record.market,
    company_name: record.companyName,
    currency: record.currency,
    industry_proxy: record.industryProxy,
    routed_templates: routedTemplates,
    routing_confidence: route.routingConfidence,
    routing_method: route.routingMethod,
    matched_rule: route.matchedRule,
    winning_template: winningTemplate,
    track_confluence: trackConfluence,
    passed_track: passedTrack,
    pool_score: poolScore,
    sub_template: winningEntry.subTemplate,
    metric_snapshot: winningEntry.result.metricSnapshot,
    data_confidence: kill.dataConfidence,
    funnel_flags: [...kill.funnelFlags, ...winningEntry.result.funnelFlags],
    audit_mode: "deep",
    audit_hints: [...route.auditHints, ...winningEntry.result.auditHints],
    compositeScore: poolScore,
    supportingPassCount: poolScore,
  };
}

export function bestPassingCandidate(
  bundle: SpecBundle,
  record: SecurityRecord,
  kill: ExclusionResult,
  route: RouteResult,
  trackResults?: TemplateTrackResult[],
): PassingCandidate | null {
  const entries = trackResults ?? listTemplateTrackResults(bundle, record, route);
  return buildPassingCandidate(record, kill, route, entries);
}

export interface ExclusionResult {
  excluded: boolean;
  killReason?: string;
  funnelFlags: string[];
  dataConfidence: DataConfidence;
}

function countMissingKeyFields(metrics: Record<string, MetricValue>): number {
  const required = ["revenue", "net_income", "operating_cash_flow"];
  return required.filter((k) => metrics[k]?.value === undefined).length;
}

function excluded(
  killReason: string,
  funnelFlags: string[],
  dataConfidence: DataConfidence = "high",
): ExclusionResult {
  return { excluded: true, killReason, funnelFlags, dataConfidence };
}

export function applyExclusionRules(
  spec: ExclusionRulesSpec,
  record: SecurityRecord,
): ExclusionResult {
  const flags: string[] = [];
  let dataConfidence: DataConfidence = "high";

  if (BLOCKED_STATUSES.has(record.status)) {
    return excluded("kill_status_excluded", flags, dataConfidence);
  }

  const { capFloor, ageFloor } = getUniverseFloors(spec, record.market);
  if (record.marketCap < capFloor) {
    return excluded("kill_market_cap_below_floor", flags, dataConfidence);
  }

  if (record.listingAgeYears < ageFloor) {
    return excluded("kill_listing_age_below_floor", flags, dataConfidence);
  }

  // Vacuous truth: [].every(...) is true — skip when history is insufficient.
  if (
    record.revenueYoyHistory.length >= 3 &&
    record.revenueYoyHistory.slice(-3).every((y) => y < 0)
  ) {
    return excluded("kill_revenue_decline_3y_consecutive", flags, dataConfidence);
  }

  if (record.ocfNegativeYears >= 2 && record.netLossWidening) {
    return excluded("kill_ocf_negative_widening_loss", flags, dataConfidence);
  }

  if (record.nonStandardAudit) {
    return excluded("kill_non_standard_audit", flags, dataConfidence);
  }

  const missingKeyFields = countMissingKeyFields(record.metrics);
  if (missingKeyFields >= 3) {
    // Quote-only live adapters supply no financials — flag, do not exclude (wide in).
    dataConfidence = "low";
    flags.push("flag_key_fields_unavailable");
  } else if (missingKeyFields >= 2) {
    dataConfidence = "low";
    flags.push("flag_key_fields_partial");
  }

  if (record.latestFinancialMonthsOld > 18) {
    dataConfidence = "low";
    flags.push("flag_data_stale");
  }

  return { excluded: false, funnelFlags: flags, dataConfidence };
}

export type ProfileMarket = {
  market_cap_min_cny?: number;
  market_cap_min_usd?: number;
  listing_age_min_years?: number;
};

export const BLOCKED_STATUSES = new Set(["ST", "delisting", "suspended", "halted", "delisted"]);

export function getUniverseProfile(
  spec: ExclusionRulesSpec,
): Record<string, ProfileMarket> | undefined {
  return (spec.universe as { profile_b?: Record<string, ProfileMarket> }).profile_b;
}

export function getUniverseFloors(
  spec: ExclusionRulesSpec,
  market: Market,
): { capFloor: number; ageFloor: number } {
  const profile = getUniverseProfile(spec);
  if (market === "CN") {
    return {
      capFloor: profile?.CN?.market_cap_min_cny ?? 2_000_000_000,
      ageFloor: profile?.CN?.listing_age_min_years ?? 3,
    };
  }
  return {
    capFloor: profile?.US?.market_cap_min_usd ?? 300_000_000,
    ageFloor: profile?.US?.listing_age_min_years ?? 2,
  };
}

export function passesUniverseProfile(spec: ExclusionRulesSpec, record: SecurityRecord): boolean {
  return getUniverseProfileFailureReason(spec, record) === null;
}

export function getUniverseProfileFailureReason(
  spec: ExclusionRulesSpec,
  record: SecurityRecord,
): string | null {
  if (BLOCKED_STATUSES.has(record.status)) return "kill_status_excluded";
  const { capFloor, ageFloor } = getUniverseFloors(spec, record.market);
  if (record.marketCap < capFloor) return "kill_market_cap_below_floor";
  if (record.listingAgeYears < ageFloor) return "kill_listing_age_below_floor";
  return null;
}

export type RoutingMethod = "gics" | "cn_industry_map" | "industry_proxy" | "fallback";

export interface RouteInput {
  market?: Market;
  gicsCode?: string;
  industryProxy?: string;
}

export interface RouteResult {
  templates: RoutedTemplate[];
  routingConfidence: "high" | "ambiguous_union" | "low";
  routingMethod: RoutingMethod;
  auditHints: string[];
  matchedRule?: string;
}

interface CnIndustryParts {
  l1?: string;
  l2?: string;
  l3?: string;
}

interface TemplateRule {
  template: string;
  sub_template?: string;
  confidence?: string;
  also_run?: string[];
}

function matchGicsPrefix(code: string, prefix: string): boolean {
  return code.startsWith(prefix);
}

function parseCnIndustry(raw?: string): CnIndustryParts {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const parts = text
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  return { l1: parts[0], l2: parts[1], l3: parts[2] };
}

function normalizeCnL1(
  l1: string | undefined,
  aliases: Record<string, string> | undefined,
): string | undefined {
  if (!l1) return undefined;
  return aliases?.[l1] ?? l1;
}

function buildRouteFromRule(
  rule: TemplateRule,
  matchedRule: string,
  routingMethod: RoutingMethod,
): RouteResult {
  const primary: RoutedTemplate = {
    id: rule.template,
    subTemplate: rule.sub_template,
  };
  const alsoRun = rule.also_run ?? [];
  const isUnion = rule.confidence === "ambiguous_union" && alsoRun.length > 0;
  if (isUnion) {
    return {
      templates: [primary, ...alsoRun.map((id) => ({ id }))],
      routingConfidence: "ambiguous_union",
      routingMethod,
      auditHints: ["Routed via ambiguous_union; verify sector classification in Deep audit"],
      matchedRule,
    };
  }
  return {
    templates: [primary],
    routingConfidence: "high",
    routingMethod,
    auditHints: [],
    matchedRule,
  };
}

function routeViaCnIndustryMap(
  cnRouting: CnIndustryMapSpec,
  industryProxy?: string,
): RouteResult | undefined {
  const parts = parseCnIndustry(industryProxy);
  const l1 = normalizeCnL1(parts.l1, cnRouting.legacy_l1_aliases);
  if (!l1) return undefined;

  for (const override of cnRouting.l2_overrides ?? []) {
    const match = override.match as { l1?: string; l2?: string; l3?: string } | undefined;
    if (!match?.l1 || match.l1 !== l1) continue;
    if (match.l2 && match.l2 !== parts.l2) continue;
    if (match.l3 && match.l3 !== parts.l3) continue;
    const ruleLabel = match.l3
      ? `l3:${l1}/${parts.l2 ?? ""}/${parts.l3 ?? ""}`
      : `l2:${l1}/${parts.l2 ?? ""}`;
    return buildRouteFromRule(override as unknown as TemplateRule, ruleLabel, "cn_industry_map");
  }

  const l1Rule = cnRouting.l1_defaults?.[l1] as TemplateRule | undefined;
  if (!l1Rule) return undefined;
  return buildRouteFromRule(l1Rule, `l1:${l1}`, "cn_industry_map");
}

function keywordBlocked(
  proxy: string,
  keyword: string,
  excludes: CnIndustryMapSpec["proxy_keyword_excludes"],
): boolean {
  if (!proxy.includes(keyword)) return true;
  for (const rule of excludes ?? []) {
    if (String(rule.keyword).toLowerCase() !== keyword) continue;
    for (const fragment of (rule.exclude_if_contains as string[]) ?? []) {
      if (proxy.includes(String(fragment).toLowerCase())) return true;
    }
  }
  return false;
}

function routeViaIndustryProxy(
  usRouting: RoutingMapSpec,
  cnRouting: CnIndustryMapSpec | undefined,
  industryProxy?: string,
): RouteResult | undefined {
  const proxy = (industryProxy ?? "").toLowerCase();
  if (!proxy) return undefined;

  const entries = [
    ...(usRouting.industry_proxy_map ?? []),
    ...(cnRouting?.proxy_keyword_additions ?? []),
  ];

  for (const entry of entries) {
    const keywords = (entry.keywords as string[]).map((k) => k.toLowerCase());
    const matched = keywords.some(
      (k) => !keywordBlocked(proxy, k, cnRouting?.proxy_keyword_excludes) && proxy.includes(k),
    );
    if (!matched) continue;

    const rule: TemplateRule = {
      template: entry.template as string,
      sub_template: entry.sub_template as string | undefined,
      also_run: entry.also_run as string[] | undefined,
    };
    if (entry.also_run) rule.confidence = "ambiguous_union";
    return buildRouteFromRule(rule, `proxy:${keywords[0]}`, "industry_proxy");
  }

  return undefined;
}

function fallbackRoute(): RouteResult {
  return {
    templates: [],
    routingConfidence: "low",
    routingMethod: "fallback",
    auditHints: ["routing_too_hard"],
    matchedRule: "fallback",
  };
}

// 路由优先使用明确映射；无法确认时保留稳定兜底模板，避免静默丢弃公司。
export function routeSecurity(
  usRouting: RoutingMapSpec,
  cnRouting: CnIndustryMapSpec | undefined,
  input: RouteInput,
): RouteResult {
  if (input.market === "CN" && cnRouting) {
    const cnRoute = routeViaCnIndustryMap(cnRouting, input.industryProxy);
    if (cnRoute) return cnRoute;
  }

  if (input.gicsCode) {
    for (const mapping of usRouting.mappings) {
      const prefix = mapping.gics_prefix as string;
      if (!matchGicsPrefix(input.gicsCode, prefix)) continue;

      const rule: TemplateRule = {
        template: mapping.template as string,
        sub_template: mapping.sub_template as string | undefined,
        confidence: mapping.confidence as string | undefined,
        also_run: mapping.also_run ? [mapping.also_run as string] : undefined,
      };
      return buildRouteFromRule(rule, `gics:${prefix}`, "gics");
    }
  }

  const proxyRoute = routeViaIndustryProxy(usRouting, cnRouting, input.industryProxy);
  if (proxyRoute) return proxyRoute;

  return fallbackRoute();
}
