import type { Market, MetricValue, ThresholdRule, ThresholdResult } from "./types.js";

export type { Market, DataConfidence, MetricValue, ThresholdRule, ThresholdResult } from "./types.js";

function resolveBound(rule: ThresholdRule, market: Market): { min?: number; max?: number } {
  if (rule.market_overrides && (rule.default !== undefined || rule.min !== undefined)) {
    const floor = rule.market_overrides[market] ?? rule.default ?? rule.min;
    return { min: floor, max: rule.max };
  }
  return { min: rule.min, max: rule.max };
}

export function evaluateThreshold(
  metric: MetricValue | undefined,
  rule: ThresholdRule,
  market: Market
): ThresholdResult {
  if (metric?.value === undefined) {
    if (rule.missing === "skip") {
      return { passed: true, skipped: true, dataConfidence: "medium" };
    }
    return { passed: false, skipped: false, dataConfidence: "low" };
  }

  const { min, max } = resolveBound(rule, market);
  let passed = true;
  if (min !== undefined && metric.value < min) passed = false;
  if (max !== undefined && metric.value > max) passed = false;

  return {
    passed,
    skipped: false,
    dataConfidence: metric.dataConfidence,
  };
}
