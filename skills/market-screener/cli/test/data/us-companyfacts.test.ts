import { describe, it, expect } from "vitest";
import { parseCompanyFactsAnnualRows } from "../../src/data/us/sec.js";

describe("parseCompanyFactsAnnualRows", () => {
  it("extracts FY revenue and net income series", () => {
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
        },
      },
    });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.find((r) => r.year === 2024)?.revenue).toBe(120);
    expect(rows.find((r) => r.year === 2024)?.netIncome).toBe(25);
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
          GrossProfit: {
            units: {
              USD: [{ fy: 2024, fp: "FY", val: 80, form: "10-K" }],
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
});
