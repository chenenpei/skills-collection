import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/http-fetch.js", () => ({
  httpFetch: vi.fn(),
}));

import { httpFetch } from "../../src/lib/http-fetch.js";
import {
  createCnEastMoneyAdapter,
  listingAgeYearsFromEastMoneyDate,
  mapEastMoneyRowToQuoteMetrics,
  sanitizeCnQuoteMetrics,
} from "../../src/data/cn/quotes.js";

const mockedHttpFetch = vi.mocked(httpFetch);

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("mapEastMoneyRowToQuoteMetrics", () => {
  it("maps f2→price, f115→pe_ttm, f23→pb and does not set price_vs_52w_high", () => {
    const metrics = mapEastMoneyRowToQuoteMetrics({
      f2: 38.35,
      f115: 16.7,
      f23: 3.9,
      f15: 39.0,
      f9: 17.2,
    });

    expect(metrics.price?.value).toBe(38.35);
    expect(metrics.pe_ttm?.value).toBe(16.7);
    expect(metrics.pb?.value).toBe(3.9);
    expect(metrics.price_vs_52w_high).toBeUndefined();
    expect(metrics.high_52w).toBeUndefined();
  });

  it("does not fall back from f9 dynamic PE into pe_ttm when f115 is missing", () => {
    const metrics = mapEastMoneyRowToQuoteMetrics({
      f2: 38.35,
      f9: 16.34,
      f23: 3.9,
    });

    expect(metrics.pe_ttm).toBeUndefined();
    expect(metrics.pb?.value).toBe(3.9);
  });

  it("does not map f2 into pe_ttm (603195 regression)", () => {
    const metrics = mapEastMoneyRowToQuoteMetrics({
      f2: 38.35,
      f9: 16.34,
      f23: 4.2,
    });

    expect(metrics.pe_ttm?.value).not.toBe(38.35);
    expect(metrics.pe_ttm).toBeUndefined();
  });

  it("parses f26 listing date into listing age years and ignores f116", () => {
    const years = listingAgeYearsFromEastMoneyDate(20200206, new Date("2026-06-28T00:00:00Z"));
    expect(years).toBeCloseTo(6.39, 1);
  });
});

describe("sanitizeCnQuoteMetrics", () => {
  it("drops pe_ttm when it equals price within 1% (polluted cache pattern)", () => {
    const result = sanitizeCnQuoteMetrics({
      price: { value: 38.35, dataConfidence: "medium" },
      pe_ttm: { value: 38.35, dataConfidence: "medium" },
      pb: { value: 16.34, dataConfidence: "medium" },
    });

    expect(result.metrics.pe_ttm).toBeUndefined();
    expect(result.warnings).toContain("pe_ttm_equals_price");
  });

  it("drops pb when pb > 15 and pe_ttm missing (likely dynamic PE mislabeled as pb)", () => {
    const result = sanitizeCnQuoteMetrics({
      price: { value: 38.35, dataConfidence: "medium" },
      pb: { value: 16.34, dataConfidence: "medium" },
    });

    expect(result.metrics.pb).toBeUndefined();
    expect(result.warnings).toContain("pb_likely_pe_mislabel");
  });

  it("keeps valid pe/pb pair", () => {
    const result = sanitizeCnQuoteMetrics({
      price: { value: 38.35, dataConfidence: "medium" },
      pe_ttm: { value: 16.7, dataConfidence: "medium" },
      pb: { value: 3.9, dataConfidence: "medium" },
    });

    expect(result.metrics.pe_ttm?.value).toBe(16.7);
    expect(result.metrics.pb?.value).toBe(3.9);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("createCnEastMoneyAdapter", () => {
  beforeEach(() => {
    mockedHttpFetch.mockReset();
  });

  it("maps quote response to SecurityRecord shape", async () => {
    mockedHttpFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          diff: [
            {
              f12: "600519",
              f14: "贵州茅台",
              f20: 2000000000000,
              f26: 20010827,
              f127: "active",
              f2: 1168.63,
              f115: 17.66,
              f23: 6.19,
            },
          ],
        },
      })
    );

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["CN"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.ticker).toBe("600519");
    expect(records[0]?.market).toBe("CN");
    expect(records[0]?.companyName).toBe("贵州茅台");
    expect(records[0]?.marketCap).toBe(2000000000000);
    expect(records[0]?.currency).toBe("CNY");
    expect(records[0]?.status).toBe("active");
    expect(records[0]?.listingAgeYears).toBeGreaterThan(20);
    expect(records[0]?.metrics.pe_ttm?.value).toBe(17.66);
    expect(records[0]?.metrics.pb?.value).toBe(6.19);
    expect(records[0]?.metrics.price?.value).toBe(1168.63);
  });

  it("parses ST status from f127", async () => {
    mockedHttpFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          diff: [
            {
              f12: "000001",
              f14: "*ST 示例",
              f20: 500000000,
              f127: "ST",
            },
          ],
        },
      })
    );

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["CN"]);

    expect(records[0]?.status).toBe("ST");
  });

  it("paginates until all rows are loaded", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      f12: String(600000 + i),
      f14: `Stock ${i}`,
      f20: 5_000_000_000,
      f26: 20100101,
      f127: "active",
    }));
    const page2 = [
      { f12: "600519", f14: "贵州茅台", f20: 2_000_000_000_000, f26: 20010827, f127: "active" },
    ];

    mockedHttpFetch.mockImplementation(async (url: string) => {
      const pn = new URL(url).searchParams.get("pn");
      if (pn === "1") return jsonResponse({ data: { total: 101, diff: page1 } });
      if (pn === "2") return jsonResponse({ data: { total: 101, diff: page2 } });
      return jsonResponse({ data: { total: 101, diff: [] } });
    });

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["CN"]);

    expect(records).toHaveLength(101);
    expect(mockedHttpFetch).toHaveBeenCalledTimes(2);
    expect(records.at(-1)?.ticker).toBe("600519");
  });
});
