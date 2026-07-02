import { describe, it, expect } from "vitest";
import { summarizeEnrichRunStats } from "../../src/data/live.js";
import type { SecurityRecord } from "../../src/domain/types.js";

function rec(ticker: string, extra: Partial<SecurityRecord> = {}): SecurityRecord {
  return {
    ticker,
    market: "CN",
    companyName: ticker,
    marketCap: 1e10,
    currency: "CNY",
    status: "active",
    listingAgeYears: 5,
    metrics: {},
    ...extra,
  };
}

describe("summarizeEnrichRunStats", () => {
  it("counts fetch failures and empty annual survivors", () => {
    const stats = summarizeEnrichRunStats([
      rec("000001", { enrichmentFailure: "fetch_failed" }),
      rec("000002", { revenueYoyHistory: [] }),
      rec("600519", { revenueYoyHistory: [0.1] }),
    ]);
    expect(stats.enrichFailedCount).toBe(1);
    expect(stats.enrichFailedSamples).toEqual(["000001"]);
    expect(stats.emptyAnnualCount).toBe(1);
    expect(stats.emptyAnnualSamples).toEqual(["000002"]);
  });

  it("counts cik_unresolved as enrich failure (US)", () => {
    const stats = summarizeEnrichRunStats(
      [
        {
          ...rec("AAPL"),
          market: "US",
          currency: "USD",
          enrichmentFailure: "cik_unresolved",
        },
        {
          ...rec("MSFT"),
          market: "US",
          currency: "USD",
        },
      ],
      "US"
    );
    expect(stats.enrichFailedCount).toBe(1);
    expect(stats.enrichFailedSamples).toEqual(["AAPL"]);
    expect(stats.cnMissingIndustryCount).toBeUndefined();
  });
});
