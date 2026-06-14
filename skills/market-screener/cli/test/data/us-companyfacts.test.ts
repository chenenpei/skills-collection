import { describe, it, expect } from "vitest";
import { parseCompanyFactsAnnualRows } from "../../src/data/us/sec.js";
import fixture from "../fixtures/sec-aapl-companyfacts-snippet.json" with { type: "json" };

describe("parseCompanyFactsAnnualRows", () => {
  it("extracts annual rows only when required FY 10-K fields exist", () => {
    const rows = parseCompanyFactsAnnualRows({
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 100, form: "10-K" },
                { fy: 2024, fp: "FY", val: 120, form: "10-K" },
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 20, form: "10-K" },
                { fy: 2024, fp: "FY", val: 25, form: "10-K" },
              ],
            },
          },
          GrossProfit: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 40, form: "10-K" },
                { fy: 2024, fp: "FY", val: 48, form: "10-K" },
              ],
            },
          },
          NetCashProvidedByUsedInOperatingActivities: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 22, form: "10-K" },
                { fy: 2024, fp: "FY", val: 28, form: "10-K" },
              ],
            },
          },
          OperatingIncomeLoss: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 26, form: "10-K" },
                { fy: 2024, fp: "FY", val: 31, form: "10-K" },
              ],
            },
          },
          Assets: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 180, form: "10-K" },
                { fy: 2024, fp: "FY", val: 220, form: "10-K" },
              ],
            },
          },
          Liabilities: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 90, form: "10-K" },
                { fy: 2024, fp: "FY", val: 110, form: "10-K" },
              ],
            },
          },
          StockholdersEquity: {
            units: {
              USD: [
                { fy: 2023, fp: "FY", val: 90, form: "10-K" },
                { fy: 2024, fp: "FY", val: 110, form: "10-K" },
              ],
            },
          },
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.year === 2024)).toMatchObject({
      revenue: 120,
      grossProfit: 48,
      netIncome: 25,
      operatingCashFlow: 28,
      operatingProfit: 31,
      totalEquity: 110,
      totalLiabilities: 110,
      roe: 0.25,
      assetLiabilityRatio: 0.5,
    });
  });

  it("parses capex and inventory onto annual rows", () => {
    const rows = parseCompanyFactsAnnualRows({
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 200, form: "10-K" }],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 30, form: "10-K" }],
            },
          },
          NetCashProvidedByUsedInOperatingActivities: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 35, form: "10-K" }],
            },
          },
          GrossProfit: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 80, form: "10-K" }],
            },
          },
          Assets: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 240, form: "10-K" }],
            },
          },
          Liabilities: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 120, form: "10-K" }],
            },
          },
          StockholdersEquity: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 120, form: "10-K" }],
            },
          },
          PaymentsToAcquirePropertyPlantAndEquipment: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 25, form: "10-K" }],
            },
          },
          InventoryNet: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 40, form: "10-K" }],
            },
          },
        },
      },
    });

    const latest = rows[rows.length - 1];
    expect(latest.capex).toBe(25);
    expect(latest.inventory).toBe(40);
  });

  it("derives gross profit from revenue minus cost of revenue when gross profit tag is absent", () => {
    const rows = parseCompanyFactsAnnualRows({
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 200, form: "10-K" }],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 30, form: "10-K" }],
            },
          },
          NetCashProvidedByUsedInOperatingActivities: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 32, form: "10-K" }],
            },
          },
          CostOfRevenue: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 120, form: "10-K" }],
            },
          },
          Assets: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 240, form: "10-K" }],
            },
          },
          Liabilities: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 120, form: "10-K" }],
            },
          },
          StockholdersEquity: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 120, form: "10-K" }],
            },
          },
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.grossProfit).toBe(80);
  });

  it("does not invent ROE from revenue×0.3 on real-shaped fixture", () => {
    const rows = parseCompanyFactsAnnualRows(fixture);
    const latest = rows[rows.length - 1];
    expect(latest.roe).not.toBeCloseTo(latest.netIncome / (latest.revenue * 0.3), 2);
    expect(latest.assetLiabilityRatio).not.toBe(0.45);
  });

  it("parses operating profit and balance fields from GAAP tags", () => {
    const rows = parseCompanyFactsAnnualRows(fixture);
    const latest = rows[rows.length - 1];
    expect(latest.operatingProfit).toBeDefined();
    expect(latest.totalEquity).toBeDefined();
    expect(latest.totalLiabilities).toBeDefined();
    expect(latest.monetaryFunds).toBeDefined();
  });
});
