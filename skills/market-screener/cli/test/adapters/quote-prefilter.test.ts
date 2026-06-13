import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import { passesQuotePrefilter } from "../../src/adapters/quote-prefilter.js";
import type { SecurityRecord } from "../../src/engine/kill-gates.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("passesQuotePrefilter", () => {
  let killGates: Awaited<ReturnType<typeof loadSpecBundle>>["killGates"];

  beforeAll(async () => {
    killGates = (await loadSpecBundle(SPEC_DIR)).killGates;
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
    expect(passesQuotePrefilter(killGates, base())).toBe(true);
  });

  it("rejects ST status before enrichment", () => {
    expect(passesQuotePrefilter(killGates, { ...base(), status: "ST" })).toBe(false);
  });

  it("rejects below market cap floor", () => {
    expect(passesQuotePrefilter(killGates, { ...base(), marketCap: 1_000_000_000 })).toBe(false);
  });
});
