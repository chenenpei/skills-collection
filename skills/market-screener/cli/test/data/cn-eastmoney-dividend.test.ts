import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/http-fetch.js", () => ({
  httpFetch: vi.fn(),
}));

import { httpFetch } from "../../src/lib/http-fetch.js";
import {
  pickCnDividendYieldFromBonusRows,
  fetchCnDividendYield,
  type CnDividendBonusRow,
} from "../../src/data/cn/eastmoney.js";

const mockedHttpFetch = vi.mocked(httpFetch);

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("pickCnDividendYieldFromBonusRows", () => {
  it("prefers 实施分配 over earlier 决议通过 row", () => {
    const rows: CnDividendBonusRow[] = [
      { REPORT_DATE: "2024-06-15", ASSIGN_PROGRESS: "股东大会决议通过", DIVIDENT_RATIO: 1.5 },
      { REPORT_DATE: "2024-08-01", ASSIGN_PROGRESS: "实施分配", DIVIDENT_RATIO: 2.0 },
    ];
    const picked = pickCnDividendYieldFromBonusRows(rows);
    expect(picked?.yield).toBeCloseTo(0.02, 6);
    expect(picked?.dataConfidence).toBe("high");
  });

  it("uses latest non-实施 row with low confidence", () => {
    const rows: CnDividendBonusRow[] = [
      { REPORT_DATE: "2023-05-01", ASSIGN_PROGRESS: "董事会预案", DIVIDENT_RATIO: 0.015 },
      { REPORT_DATE: "2024-05-01", ASSIGN_PROGRESS: "股东大会决议通过", DIVIDENT_RATIO: 0.018 },
    ];
    const picked = pickCnDividendYieldFromBonusRows(rows);
    expect(picked?.yield).toBeCloseTo(0.018, 6);
    expect(picked?.dataConfidence).toBe("low");
  });

  it("returns undefined when no valid ratio", () => {
    expect(
      pickCnDividendYieldFromBonusRows([
        { REPORT_DATE: "2024-01-01", DIVIDENT_RATIO: null },
      ])
    ).toBeUndefined();
  });
});

describe("fetchCnDividendYield", () => {
  beforeEach(() => {
    mockedHttpFetch.mockReset();
  });

  it("calls datacenter RPT_SHAREBONUS_DET and parses response", async () => {
    mockedHttpFetch.mockResolvedValueOnce(
      jsonResponse({
        result: {
          data: [
            {
              REPORT_DATE: "2024-08-01",
              ASSIGN_PROGRESS: "实施分配",
              DIVIDENT_RATIO: 1.8,
            },
          ],
        },
      })
    );

    const result = await fetchCnDividendYield("600519");
    expect(result?.yield).toBeCloseTo(0.018, 6);
    expect(result?.dataConfidence).toBe("high");
    const url = String(mockedHttpFetch.mock.calls[0]?.[0]);
    expect(url).toContain("RPT_SHAREBONUS_DET");
    expect(decodeURIComponent(url)).toContain('SECURITY_CODE="600519"');
  });
});
