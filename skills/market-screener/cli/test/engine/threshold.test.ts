import { describe, it, expect } from "vitest";
import { evaluateThreshold, type MetricValue } from "../../src/engine/threshold.js";

describe("evaluateThreshold", () => {
  const high = (value: number): MetricValue => ({ value, dataConfidence: "high" });

  it.each([
    ["passes min", high(0.15), { min: 0.12 }, "CN", true],
    ["fails min", high(0.1), { min: 0.12 }, "CN", false],
    ["passes max", high(0.2), { max: 0.25 }, "US", true],
    ["fails max", high(0.3), { max: 0.25 }, "US", false],
  ] as const)("%s", (_label, metric, rule, market, passed) => {
    expect(evaluateThreshold(metric, rule, market).passed).toBe(passed);
  });

  it("uses market_overrides", () => {
    const rule = { default: 0.009, market_overrides: { CN: 0.0075, US: 0.009 } };
    const metric = high(0.008);
    expect(evaluateThreshold(metric, rule, "CN").passed).toBe(true);
    expect(evaluateThreshold(metric, rule, "US").passed).toBe(false);
  });

  it("treats missing as skip when configured", () => {
    const result = evaluateThreshold(undefined, { min: 1, missing: "skip" }, "CN");
    expect(result).toMatchObject({ passed: true, skipped: true });
  });

  it("fails missing metrics without skip", () => {
    expect(evaluateThreshold(undefined, { min: 1 }, "CN")).toMatchObject({
      passed: false,
      dataConfidence: "low",
    });
  });
});
