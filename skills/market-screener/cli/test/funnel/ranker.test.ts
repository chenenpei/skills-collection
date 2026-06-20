import { describe, it, expect } from "vitest";
import type { PassingCandidate } from "../../src/funnel/run.js";
import { compareInPool, compareNorthStar, poolKeyForCandidate } from "../../src/funnel/ranker.js";
import { parseNorthStar } from "../../src/spec/conventions.js";

function passingCandidate(opts: {
  ticker: string;
  pool_score: number;
  snapshot: Record<string, number>;
  winning_template?: string;
}): PassingCandidate {
  return {
    ticker: opts.ticker,
    market: "CN",
    company_name: opts.ticker,
    currency: "CNY",
    routed_templates: ["consumer"],
    routing_confidence: "high",
    routing_method: "cn_industry_map",
    winning_template: opts.winning_template ?? "consumer",
    track_confluence: false,
    passed_track: "quality",
    pool_score: opts.pool_score,
    metric_snapshot: Object.fromEntries(
      Object.entries(opts.snapshot).map(([k, v]) => [
        k,
        { value: v, dataConfidence: "high" as const },
      ])
    ),
    data_confidence: "high",
    funnel_flags: [],
    audit_mode: "deep",
    audit_hints: [],
    compositeScore: opts.pool_score,
    supportingPassCount: opts.pool_score,
  };
}

describe("compareInPool north-star tie-break", () => {
  const lookup = {
    forPool: (poolKey: string) =>
      poolKey === "consumer_quality" ? parseNorthStar("roe_5y_avg") : undefined,
  };

  it("ranks 603195 above 002991 on consumer_quality roe_5y_avg not ticker", () => {
    const bull = passingCandidate({
      ticker: "603195",
      pool_score: 7,
      snapshot: { roe_5y_avg: 0.278 },
    });
    const ganYuan = passingCandidate({
      ticker: "002991",
      pool_score: 7,
      snapshot: { roe_5y_avg: 0.151 },
    });
    const sorted = [ganYuan, bull].sort((a, b) =>
      compareInPool(a, b, "consumer_quality", lookup)
    );
    expect(sorted[0].ticker).toBe("603195");
  });

  it("prefers lower pb when direction is asc", () => {
    const cheap = passingCandidate({ ticker: "AAA", pool_score: 1, snapshot: { pb: 0.8 } });
    const rich = passingCandidate({ ticker: "BBB", pool_score: 1, snapshot: { pb: 1.2 } });
    expect(compareNorthStar(cheap, rich, parseNorthStar("pb:asc"))).toBeLessThan(0);
  });

  it("uses pool key helper", () => {
    const c = passingCandidate({ ticker: "X", pool_score: 1, snapshot: {} });
    expect(poolKeyForCandidate(c)).toBe("consumer_quality");
  });
});
