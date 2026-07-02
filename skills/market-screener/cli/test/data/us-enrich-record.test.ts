import { describe, it, expect, vi } from "vitest";
import type { SecurityRecord } from "../../src/domain/types.js";

vi.mock("../../src/data/us/sec.js", () => ({
  resolveCik: vi.fn(async () => undefined),
}));

vi.mock("../../src/lib/yahoo-session.js", () => ({
  yahooFetch: vi.fn(async () => ({ ok: false, status: 404 })),
}));

describe("enrichUsRecord", () => {
  it("marks cik_unresolved when resolveCik returns undefined", async () => {
    const { enrichUsRecord } = await import("../../src/data/us/enrich.js");
    const record: SecurityRecord = {
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
    };

    const out = await enrichUsRecord(record, {
      quarter: "2026-Q1",
      cacheDir: "/tmp/screener-test",
      concurrency: 2,
      skipCache: true,
    });

    expect(out.enrichmentFailure).toBe("cik_unresolved");
  });
});
