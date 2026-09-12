import { beforeEach, describe, it, expect, vi } from "vitest";
import type { SecurityRecord } from "../../src/shared/financial-model.js";

const mocks = vi.hoisted(() => ({
  readCache: vi.fn(),
  writeCache: vi.fn(),
  resolveCik: vi.fn(),
  fetchUsAnnualRows: vi.fn(),
  fetchUsIndustryProxy: vi.fn(),
  fetchUsQuoteSnapshot: vi.fn(),
}));

vi.mock("../../src/us/sources/fundamentals.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/us/sources/fundamentals.js")>(),
  readCache: mocks.readCache,
  writeCache: mocks.writeCache,
  resolveCik: mocks.resolveCik,
  fetchUsAnnualRows: mocks.fetchUsAnnualRows,
  fetchUsIndustryProxy: mocks.fetchUsIndustryProxy,
}));

vi.mock("../../src/us/sources/market-data.js", () => ({
  fetchUsQuoteSnapshot: mocks.fetchUsQuoteSnapshot,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const baseRecord = (): SecurityRecord => ({
  ticker: "NOPE",
  market: "US",
  companyName: "Missing",
  currency: "USD",
  status: "active",
  marketCap: 5e9,
  listingAgeYears: 10,
  metrics: {},
  revenueYoyHistory: [],
  ocfNegativeYears: 0,
  netLossWidening: false,
  nonStandardAudit: false,
  latestFinancialMonthsOld: 0,
});

function enrichOpts(skipCache = true) {
  return {
    quarter: "2026-Q1",
    cacheDir: "/tmp/screener-test",
    concurrency: 2,
    skipCache,
  };
}

describe("enrichUsRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCik.mockResolvedValue(undefined);
    mocks.fetchUsQuoteSnapshot.mockResolvedValue(undefined);
    mocks.readCache.mockResolvedValue(null);
    mocks.writeCache.mockResolvedValue(undefined);
    mocks.fetchUsAnnualRows.mockResolvedValue([]);
    mocks.fetchUsIndustryProxy.mockResolvedValue(undefined);
  });

  it("marks cik_unresolved when resolveCik returns undefined", async () => {
    const { enrichUsRecord } = await import("../../src/us/screening.js");
    const out = await enrichUsRecord(baseRecord(), enrichOpts());

    expect(out.enrichmentFailure).toBe("cik_unresolved");
  });

  it("preserves quote request failures when quote metrics are needed", async () => {
    const { enrichUsRecord } = await import("../../src/us/screening.js");
    mocks.fetchUsQuoteSnapshot.mockRejectedValueOnce(new Error("Yahoo unavailable"));

    await expect(enrichUsRecord(baseRecord(), enrichOpts())).rejects.toThrow("Yahoo unavailable");
  });

  it("starts the quote request and SEC fundamentals together on a cache miss", async () => {
    const { enrichUsRecord } = await import("../../src/us/screening.js");
    const quote = deferred<undefined>();
    const annual = deferred<[]>();
    mocks.fetchUsQuoteSnapshot.mockReturnValueOnce(quote.promise);
    mocks.resolveCik.mockResolvedValueOnce("0000000001");
    mocks.fetchUsAnnualRows.mockReturnValueOnce(annual.promise);

    const result = enrichUsRecord(baseRecord(), enrichOpts(false));
    await Promise.resolve();
    await Promise.resolve();

    try {
      expect(mocks.fetchUsQuoteSnapshot).toHaveBeenCalledOnce();
      expect(mocks.fetchUsAnnualRows).toHaveBeenCalledOnce();
    } finally {
      quote.resolve(undefined);
      annual.resolve([]);
      await result;
    }
  });

  it("uses one Yahoo summary request for quote fields and a missing dividend yield", async () => {
    const { enrichUsRecord } = await import("../../src/us/screening.js");
    mocks.readCache.mockResolvedValueOnce({
      annualRows: [
        {
        year: 2024,
        revenue: 100,
        grossProfit: 50,
        netIncome: 20,
        operatingCashFlow: 25,
        roe: 0.2,
        assetLiabilityRatio: 0.4,
        },
      ],
      industryProxy: "Software",
    });
    mocks.fetchUsQuoteSnapshot.mockResolvedValueOnce({
      metrics: { pe_ttm: { value: 20, dataConfidence: "medium" } },
      dividendYield: 0.01,
    });

    const result = await enrichUsRecord(baseRecord(), enrichOpts(false));

    expect(mocks.fetchUsQuoteSnapshot).toHaveBeenCalledOnce();
    expect(result.metrics.dividend_yield?.value).toBe(0.01);
  });

  it("overlaps a cached annual refresh with the Yahoo request for a missing dividend", async () => {
    const { enrichUsRecord } = await import("../../src/us/screening.js");
    const quote = deferred<undefined>();
    const annual = deferred<[]>();
    mocks.readCache.mockResolvedValueOnce({
      annualRows: [
        {
          year: 2024,
          revenue: 100,
          grossProfit: 50,
          netIncome: 20,
          operatingCashFlow: 25,
          roe: 0.2,
          assetLiabilityRatio: 0.4,
        },
      ],
    });
    mocks.resolveCik.mockResolvedValueOnce("0000000001");
    mocks.fetchUsQuoteSnapshot.mockReturnValueOnce(quote.promise);
    mocks.fetchUsAnnualRows.mockReturnValueOnce(annual.promise);

    const result = enrichUsRecord(baseRecord(), enrichOpts(false));
    await Promise.resolve();
    await Promise.resolve();

    try {
      expect(mocks.fetchUsQuoteSnapshot).toHaveBeenCalledOnce();
      expect(mocks.fetchUsAnnualRows).toHaveBeenCalledOnce();
    } finally {
      quote.resolve(undefined);
      annual.resolve([]);
      await result;
    }
  });

  it("preserves supplied quote metrics when only the dividend is missing", async () => {
    const { enrichUsRecord } = await import("../../src/us/screening.js");
    mocks.readCache.mockResolvedValueOnce({
      annualRows: [
        {
          year: 2024,
          revenue: 100,
          grossProfit: 50,
          netIncome: 20,
          operatingCashFlow: 25,
          roe: 0.2,
          assetLiabilityRatio: 0.4,
        },
      ],
    });
    mocks.fetchUsQuoteSnapshot.mockResolvedValueOnce({
      metrics: {
        pe_ttm: { value: 9, dataConfidence: "medium" },
        pb: { value: 1, dataConfidence: "medium" },
        price: { value: 10, dataConfidence: "medium" },
      },
      dividendYield: 0.01,
    });
    const record = baseRecord();
    record.metrics = {
      pe_ttm: { value: 20, dataConfidence: "high" },
      pb: { value: 3, dataConfidence: "high" },
      price: { value: 100, dataConfidence: "high" },
    };

    const result = await enrichUsRecord(record, enrichOpts(false));

    expect(mocks.fetchUsQuoteSnapshot).toHaveBeenCalledWith("NOPE", false);
    expect(result.metrics.pe_ttm?.value).toBe(20);
    expect(result.metrics.pb?.value).toBe(3);
    expect(result.metrics.price?.value).toBe(100);
    expect(result.metrics.dividend_yield?.value).toBe(0.01);
  });
});
