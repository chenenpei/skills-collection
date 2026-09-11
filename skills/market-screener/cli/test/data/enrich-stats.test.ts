import { describe, it, expect } from "vitest";
import { summarizeEnrichRunStats } from "../../src/us/screening.js";
import type { SecurityRecord } from "../../src/shared/financial-model.js";

function rec(ticker: string, extra: Partial<SecurityRecord> = {}): SecurityRecord {
  return {
    ticker,
    market: "US",
    companyName: ticker,
    marketCap: 1e10,
    currency: "USD",
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

  it("counts cik_unresolved as an enrichment failure", () => {
    const stats = summarizeEnrichRunStats([
      { ...rec("AAPL"), enrichmentFailure: "cik_unresolved" },
      rec("MSFT"),
    ]);
    expect(stats.enrichFailedCount).toBe(1);
    expect(stats.enrichFailedSamples).toEqual(["AAPL"]);
  });
});
