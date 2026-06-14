import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { SectorTemplateSpec } from "../../src/spec/types.js";
import { evaluateTemplateTrack } from "../../src/funnel/template-evaluator.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";
import { loadCnFixtureRecord } from "../helpers/universe-fixture.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

const strongSaasRecord = (): SecurityRecord => ({
  ticker: "SaaS",
  market: "US",
  companyName: "SaaS Inc",
  currency: "USD",
  status: "active",
  marketCap: 5e9,
  listingAgeYears: 5,
  metrics: {
    rule_of_40: { value: 42, dataConfidence: "high" },
    gross_margin: { value: 0.56, dataConfidence: "high" },
    revenue_growth_yoy: { value: 0.15, dataConfidence: "high" },
    ndr: { value: 1.08, dataConfidence: "high" },
    roic: { value: 0.18, dataConfidence: "high" },
    sbc_to_revenue: { value: 0.12, dataConfidence: "high" },
    share_dilution_3y: { value: 0.05, dataConfidence: "high" },
    fcf_margin: { value: 0.2, dataConfidence: "high" },
    revenue: { value: 1e9, dataConfidence: "high" },
    net_income: { value: 1e8, dataConfidence: "high" },
    operating_cash_flow: { value: 2e8, dataConfidence: "high" },
  },
  revenueYoyHistory: [0.1, 0.12, 0.15],
  ocfNegativeYears: 0,
  netLossWidening: false,
  nonStandardAudit: false,
  latestFinancialMonthsOld: 3,
});

describe("evaluateTemplateTrack", () => {
  let techSaas: SectorTemplateSpec & Record<string, unknown>;
  let consumer: SectorTemplateSpec & Record<string, unknown>;
  let manufacturing: SectorTemplateSpec & Record<string, unknown>;
  let healthcare: SectorTemplateSpec & Record<string, unknown>;
  let pharmaFixture: SecurityRecord;

  beforeAll(async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    techSaas = bundle.templates.tech_saas as SectorTemplateSpec & Record<string, unknown>;
    consumer = bundle.templates.consumer as SectorTemplateSpec & Record<string, unknown>;
    manufacturing = bundle.templates.manufacturing as SectorTemplateSpec &
      Record<string, unknown>;
    healthcare = bundle.templates.healthcare as SectorTemplateSpec & Record<string, unknown>;
    pharmaFixture = await loadCnFixtureRecord("600276");
  });

  const strongConsumerRecord = (): SecurityRecord => ({
    ticker: "TEST",
    market: "CN",
    companyName: "Stable Consumer",
    currency: "CNY",
    status: "active",
    marketCap: 5e9,
    listingAgeYears: 10,
    metrics: {
      roe_5y_avg: { value: 0.16, dataConfidence: "high" },
      gross_margin_3y_max_decline_pp: { value: 3, dataConfidence: "high" },
      fcf_conversion_5y: { value: 0.9, dataConfidence: "high" },
      net_debt_to_ebitda: { value: 1.5, dataConfidence: "high" },
      roic_5y_avg: { value: 0.13, dataConfidence: "high" },
      gross_margin_vs_industry: { value: 0.06, dataConfidence: "high" },
      operating_margin_vs_industry: { value: 0.02, dataConfidence: "high" },
      revenue_3y_cagr: { value: 0.05, dataConfidence: "high" },
      debt_to_equity: { value: 0.3, dataConfidence: "high" },
      revenue: { value: 1e9, dataConfidence: "high" },
      net_income: { value: 1e8, dataConfidence: "high" },
      operating_cash_flow: { value: 2e8, dataConfidence: "high" },
    },
    revenueYoyHistory: [0.05, 0.04, 0.03],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 6,
  });

  it("passes tech_saas quality when required and supporting bars are met", () => {
    const result = evaluateTemplateTrack(techSaas, "quality", strongSaasRecord());
    expect(result).toMatchObject({ passed: true, passedTrack: "quality" });
  });

  it("fails tech_saas quality when required gross margin is too low", () => {
    const record = strongSaasRecord();
    record.metrics.gross_margin = { value: 0.3, dataConfidence: "high" };
    expect(evaluateTemplateTrack(techSaas, "quality", record).passed).toBe(false);
  });

  it("passes consumer quality when gross margin max decline is within 5pp", () => {
    expect(evaluateTemplateTrack(consumer, "quality", strongConsumerRecord()).passed).toBe(true);
  });

  it("fails consumer quality when gross margin max decline exceeds 5pp", () => {
    const record = strongConsumerRecord();
    record.metrics.gross_margin_3y_max_decline_pp = { value: 8, dataConfidence: "high" };
    expect(evaluateTemplateTrack(consumer, "quality", record).passed).toBe(false);
  });

  const sparseManufacturingRecord = (): SecurityRecord => ({
    ticker: "301626",
    market: "CN",
    companyName: "Sparse Mfg",
    currency: "CNY",
    status: "active",
    marketCap: 5e9,
    listingAgeYears: 10,
    metrics: {
      roic_5y_avg: { value: 0.16, dataConfidence: "high" },
      fcf_conversion_5y: { value: 1.0, dataConfidence: "high" },
      gross_margin_3y_max_decline_pp: { value: 3, dataConfidence: "high" },
      net_debt_to_ebitda: { value: 1.0, dataConfidence: "high" },
      roe_5y_avg: { value: 0.18, dataConfidence: "high" },
      revenue_3y_cagr: { value: 0.1, dataConfidence: "high" },
      gross_margin: { value: 0.37, dataConfidence: "high" },
      revenue: { value: 1e9, dataConfidence: "high" },
      net_income: { value: 1e8, dataConfidence: "high" },
      operating_cash_flow: { value: 2e8, dataConfidence: "high" },
    },
    revenueYoyHistory: [0.05, 0.04, 0.03],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 6,
  });

  it("downgrades manufacturing supporting bar when gap is only missing: skip", () => {
    const result = evaluateTemplateTrack(manufacturing, "quality", sparseManufacturingRecord());
    expect(result).toMatchObject({
      passed: true,
      passedTrack: "quality",
      supportingPassCount: 3,
      supportingTotal: 3,
    });
  });

  it("fails manufacturing quality when evaluable supporting metrics do not all pass", () => {
    const record = sparseManufacturingRecord();
    record.metrics.revenue_3y_cagr = { value: 0.01, dataConfidence: "high" };
    expect(evaluateTemplateTrack(manufacturing, "quality", record).passed).toBe(false);
  });

  it("fails manufacturing quality when enough supporting metrics are evaluable but below min", () => {
    const record = sparseManufacturingRecord();
    record.metrics = {
      ...record.metrics,
      capex_to_revenue: { value: 0.1, dataConfidence: "high" },
      inventory_turnover_vs_industry: { value: -0.05, dataConfidence: "high" },
      revenue_3y_cagr: { value: 0.01, dataConfidence: "high" },
    };
    expect(evaluateTemplateTrack(manufacturing, "quality", record).passed).toBe(false);
  });

  const healthcareCompounderRecord = (): SecurityRecord => structuredClone(pharmaFixture);

  const healthcareBiotechRecord = (): SecurityRecord => {
    const base = healthcareCompounderRecord();
    return {
      ...base,
      ticker: "BIOTECH",
      metrics: {
        ...base.metrics,
        net_income: { value: -2e8, dataConfidence: "high" },
        roe_5y_avg: { value: -0.05, dataConfidence: "high" },
        roic_5y_avg: { value: -0.04, dataConfidence: "high" },
        fcf_conversion_5y: { value: 0.2, dataConfidence: "high" },
        free_cash_flow: { value: -5e7, dataConfidence: "high" },
        gross_margin: { value: 0.58, dataConfidence: "high" },
        revenue_3y_cagr: { value: 0.12, dataConfidence: "high" },
        operating_margin_vs_industry: { value: -0.05, dataConfidence: "high" },
      },
    };
  };

  it("passes healthcare quality for profitable compounder", () => {
    expect(
      evaluateTemplateTrack(healthcare, "quality", healthcareCompounderRecord()).passed
    ).toBe(true);
  });

  it("passes healthcare quality for unprofitable high-margin biotech exception", () => {
    const result = evaluateTemplateTrack(healthcare, "quality", healthcareBiotechRecord());
    expect(result).toMatchObject({ passed: true, passedTrack: "quality" });
  });

  it("fails healthcare mispricing when unprofitable (Graham floor)", () => {
    expect(
      evaluateTemplateTrack(healthcare, "mispricing", healthcareBiotechRecord()).passed
    ).toBe(false);
  });

  it("consumer quality still passes when dividend_yield is missing (skip)", () => {
    expect(evaluateTemplateTrack(consumer, "quality", strongConsumerRecord()).passed).toBe(true);
  });
});
