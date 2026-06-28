import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/data/cn/quotes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/cn/quotes.js")>();
  return {
    ...actual,
    createCnEastMoneyAdapter: vi.fn(() => ({
      loadUniverse: vi.fn(async () => {
        throw new Error("EastMoney list failed: 503");
      }),
    })),
    readCnQuoteUniverseSnapshot: vi.fn(async () => [
      {
        ticker: "600519",
        market: "CN",
        companyName: "贵州茅台",
        currency: "CNY",
        status: "active",
        marketCap: 2e12,
        listingAgeYears: 20,
        metrics: { price: { value: 1168.63, dataConfidence: "medium" } },
        revenueYoyHistory: [],
        ocfNegativeYears: 0,
        netLossWidening: false,
        nonStandardAudit: false,
        latestFinancialMonthsOld: 0,
      },
    ]),
  };
});

describe("live adapter degraded fallback", () => {
  it("falls back to prior-quarter CN quote snapshot only when degraded mode is enabled", async () => {
    const { createLiveAdapter } = await import("../../src/data/registry.js");
    const adapter = createLiveAdapter("/tmp/screener-cache-test", {
      allowDegraded: true,
      quoteFallbackQuarter: "2026-Q1",
    });

    const records = await adapter.loadUniverse(["CN"], { quarter: "2026-Q2" });

    expect(records).toHaveLength(1);
    expect(records[0].metrics.price?.dataConfidence).toBe("low");
    expect(records[0].auditHints).toContain("quote_degraded:snapshot:2026-Q1");
  });
});
