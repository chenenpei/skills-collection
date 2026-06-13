import { describe, it, expect, vi, beforeAll } from "vitest";
import { createLiveAdapter } from "../../src/adapters/registry.js";

describe("live adapter enrichRecords", () => {
  beforeAll(() => {
    vi.mock("../../src/adapters/cn/enrich.js", () => ({
      enrichCnRecord: vi.fn(async (record) => ({
        ...record,
        industryProxy: "白酒",
        metrics: {
          roe_5y_avg: { value: 0.3, dataConfidence: "medium" },
          gross_margin_3y_max_decline_pp: { value: 2.0, dataConfidence: "medium" },
          fcf_conversion_5y: { value: 0.9, dataConfidence: "medium" },
          net_debt_to_ebitda: { value: 0.5, dataConfidence: "medium" },
          revenue: { value: 1e11, dataConfidence: "medium" },
          net_income: { value: 5e10, dataConfidence: "medium" },
          operating_cash_flow: { value: 6e10, dataConfidence: "medium" },
        },
        revenueYoyHistory: [0.05, 0.06, 0.07],
      })),
    }));
  });

  it("exposes enrichRecords on live adapter", async () => {
    const adapter = createLiveAdapter("/tmp/screener-cache-test");
    expect(adapter.enrichRecords).toBeDefined();
  });
});
