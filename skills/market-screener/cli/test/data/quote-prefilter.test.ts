import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import { passesQuotePrefilter } from "../../src/data/quote-prefilter.js";
import type { SecurityRecord } from "../../src/domain/types.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("passesQuotePrefilter", () => {
  let exclusionRules: Awaited<ReturnType<typeof loadSpecBundle>>["exclusionRules"];

  beforeAll(async () => {
    exclusionRules = (await loadSpecBundle(SPEC_DIR)).exclusionRules;
  });

  const base = (): SecurityRecord => ({
    ticker: "600519",
    market: "CN",
    companyName: "Moutai",
    currency: "CNY",
    status: "active",
    marketCap: 2_000_000_000_000,
    listingAgeYears: 20,
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
  });

  it("passes healthy quote record", () => {
    expect(passesQuotePrefilter(exclusionRules, base())).toBe(true);
  });

  it("rejects ST status before enrichment", () => {
    expect(passesQuotePrefilter(exclusionRules, { ...base(), status: "ST" })).toBe(false);
  });

  it("rejects below market cap floor", () => {
    expect(passesQuotePrefilter(exclusionRules, { ...base(), marketCap: 1_000_000_000 })).toBe(false);
  });
});
