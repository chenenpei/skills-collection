import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { SectorTemplateSpec } from "../../src/spec/types.js";
import { evaluateTemplateTrack } from "../../src/engine/template-evaluator.js";
import type { SecurityRecord } from "../../src/engine/kill-gates.js";

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

  beforeAll(async () => {
    techSaas = (await loadSpecBundle(SPEC_DIR)).templates.tech_saas as SectorTemplateSpec &
      Record<string, unknown>;
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
});
