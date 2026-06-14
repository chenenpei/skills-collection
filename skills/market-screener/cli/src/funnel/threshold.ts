import type { Market, MetricValue, ThresholdRule, ThresholdResult } from "./types.js";

export type { Market, DataConfidence, MetricValue, ThresholdRule, ThresholdResult } from "./types.js";

export function resolveThresholdBound(
  rule: ThresholdRule,
  market: Market
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
  market: Market
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
  market: Market
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
