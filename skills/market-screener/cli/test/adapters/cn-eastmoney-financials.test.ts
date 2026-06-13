import { describe, it, expect } from "vitest";
import { parseEastMoneyAnnualRows } from "../../src/adapters/cn/eastmoney-financials.js";

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
});
