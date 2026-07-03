import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { ExclusionRulesSpec } from "../../src/spec/types.js";
import { applyExclusionRules } from "../../src/funnel/exclusions.js";
import type { SecurityRecord } from "../../src/domain/types.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

const baseRecord = (): SecurityRecord => ({
  ticker: "TEST",
  market: "CN",
  companyName: "Test Co",
  currency: "CNY",
  status: "active",
  marketCap: 5_000_000_000,
  listingAgeYears: 5,
  metrics: {
    revenue: { value: 1e9, dataConfidence: "high" },
    net_income: { value: 1e8, dataConfidence: "high" },
    operating_cash_flow: { value: 2e8, dataConfidence: "high" },
  },
  revenueYoyHistory: [0.05, 0.03, 0.02],
  ocfNegativeYears: 0,
  netLossWidening: false,
  nonStandardAudit: false,
  latestFinancialMonthsOld: 6,
});

describe("applyExclusionRules", () => {
  let exclusionRules: ExclusionRulesSpec;

  beforeAll(async () => {
    exclusionRules = (await loadSpecBundle(SPEC_DIR)).exclusionRules;
  });

  it.each(["ST", "delisting", "suspended", "halted", "delisted"] as const)(
    "excludes blocked status %s",
    (status) => {
      const record = { ...baseRecord(), status };
      const result = applyExclusionRules(exclusionRules, record);
      expect(result).toMatchObject({
        excluded: true,
        killReason: "kill_status_excluded",
      });
    }
  );

  it.each([
    ["CN", 1_000_000_000, "CNY"],
    ["US", 200_000_000, "USD"],
  ] as const)("excludes %s market cap below floor", (market, marketCap, currency) => {
    const record = { ...baseRecord(), market, currency, marketCap };
    expect(applyExclusionRules(exclusionRules, record).killReason).toBe("kill_market_cap_below_floor");
  });

  it.each([
    ["CN", 2],
    ["US", 1],
  ] as const)("excludes %s listing age below floor", (market, listingAgeYears) => {
    const record = {
      ...baseRecord(),
      market,
      currency: market === "CN" ? "CNY" : "USD",
      listingAgeYears,
    };
    expect(applyExclusionRules(exclusionRules, record).killReason).toBe("kill_listing_age_below_floor");
  });

  it("does not exclude revenue decline when YoY history is insufficient", () => {
    const result = applyExclusionRules(exclusionRules, { ...baseRecord(), revenueYoyHistory: [] });
    expect(result.excluded).toBe(false);
    expect(result.killReason).toBeUndefined();
  });

  it("excludes 3y consecutive revenue decline", () => {
    const record = { ...baseRecord(), revenueYoyHistory: [-0.05, -0.03, -0.02] };
    expect(applyExclusionRules(exclusionRules, record).killReason).toBe(
      "kill_revenue_decline_3y_consecutive"
    );
  });

  it("excludes ocf negative 2y with widening loss", () => {
    const record = { ...baseRecord(), ocfNegativeYears: 2, netLossWidening: true };
    expect(applyExclusionRules(exclusionRules, record).killReason).toBe("kill_ocf_negative_widening_loss");
  });

  it("excludes non-standard audit", () => {
    expect(applyExclusionRules(exclusionRules, { ...baseRecord(), nonStandardAudit: true }).killReason).toBe(
      "kill_non_standard_audit"
    );
  });

  it("flags all key financial fields missing without excluding (quote-only live tier)", () => {
    const result = applyExclusionRules(exclusionRules, {
      ...baseRecord(),
      metrics: {
        revenue: { dataConfidence: "low" },
        net_income: { dataConfidence: "low" },
        operating_cash_flow: { dataConfidence: "low" },
      },
    });
    expect(result).toMatchObject({
      excluded: false,
      funnelFlags: ["flag_key_fields_unavailable"],
      dataConfidence: "low",
    });
  });

  it("passes quote-only adapter defaults through universe kill gates", () => {
    const result = applyExclusionRules(exclusionRules, {
      ...baseRecord(),
      metrics: {},
      revenueYoyHistory: [],
    });
    expect(result).toMatchObject({
      excluded: false,
      funnelFlags: ["flag_key_fields_unavailable"],
      dataConfidence: "low",
    });
  });

  it("flags stale financial data without excluding", () => {
    const result = applyExclusionRules(exclusionRules, { ...baseRecord(), latestFinancialMonthsOld: 24 });
    expect(result).toMatchObject({
      excluded: false,
      funnelFlags: ["flag_data_stale"],
      dataConfidence: "low",
    });
  });

  it("passes healthy record", () => {
    expect(applyExclusionRules(exclusionRules, baseRecord())).toMatchObject({
      excluded: false,
      funnelFlags: [],
      dataConfidence: "high",
    });
  });
});
