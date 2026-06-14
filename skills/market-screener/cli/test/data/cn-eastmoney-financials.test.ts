import { describe, it, expect } from "vitest";
import {
  mergeSupplementalIntoAnnualRows,
  parseEastMoneyAnnualRows,
} from "../../src/data/cn/eastmoney.js";

describe("parseEastMoneyAnnualRows", () => {
  it("maps datacenter rows to AnnualFinancialRow", () => {
    const rows = parseEastMoneyAnnualRows([
      {
        REPORT_DATE: "2024-12-31 00:00:00",
        REPORT_TYPE: "年报",
        TOTALOPERATEREVE: 174144069958.25,
        PARENTNETPROFIT: 86228146421.62,
        MLR: 157109669908.36,
        ROEJQ: 36.02,
        NETCASH_OPERATE_PK: 92463692168.43,
        ZCFZL: 19.0447556579,
        OPERATE_PROFIT_PK: 119688579453.23,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(2024);
    expect(rows[0].roe).toBeCloseTo(0.3602, 4);
    expect(rows[0].assetLiabilityRatio).toBeCloseTo(0.1904, 4);
  });

  it("merges capex and inventory into annual rows by fiscal year", () => {
    const annual = parseEastMoneyAnnualRows([
      {
        REPORT_DATE: "2024-12-31 00:00:00",
        REPORT_TYPE: "年报",
        TOTALOPERATEREVE: 1000000000,
        PARENTNETPROFIT: 100000000,
        MLR: 400000000,
        ROEJQ: 10,
        NETCASH_OPERATE_PK: 120000000,
        ZCFZL: 40,
      },
    ]);
    const supplemental = new Map([[2024, { capex: 1_000_000_000, inventory: 500_000_000 }]]);
    const merged = mergeSupplementalIntoAnnualRows(annual, supplemental);
    expect(merged[0].capex).toBe(1_000_000_000);
    expect(merged[0].inventory).toBe(500_000_000);
  });
});
