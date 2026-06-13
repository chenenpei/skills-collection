import type { AnnualFinancialRow } from "../../metrics/derive.js";
import { fetchEastMoneyDatacenter } from "./eastmoney-datacenter.js";

type RawRow = Record<string, string | number | null | undefined>;

export function cnTickerToSecucode(ticker: string): string {
  const marketPrefix = ticker.startsWith("6") ? "SH" : "SZ";
  return `${ticker}.${marketPrefix}`;
}

export function parseEastMoneyAnnualRows(data: RawRow[]): AnnualFinancialRow[] {
  return data
    .filter((r) => r.REPORT_TYPE === "年报")
    .map((r) => {
      const year = Number(String(r.REPORT_DATE ?? "").slice(0, 4));
      const revenue = Number(r.TOTALOPERATEREVE ?? 0);
      return {
        year,
        revenue,
        grossProfit: Number(r.MLR ?? 0),
        netIncome: Number(r.PARENTNETPROFIT ?? 0),
        operatingCashFlow: Number(r.NETCASH_OPERATE_PK ?? 0),
        roe: Number(r.ROEJQ ?? 0) / 100,
        assetLiabilityRatio: Number(r.ZCFZL ?? 0) / 100,
        operatingProfit: Number(r.OPERATE_PROFIT_PK ?? 0) || undefined,
      };
    })
    .filter((r) => r.year > 1900 && r.revenue > 0);
}

function buildParams(secucode: string): URLSearchParams {
  return new URLSearchParams({
    reportName: "RPT_F10_FINANCE_MAINFINADATA",
    columns:
      "SECUCODE,REPORT_DATE,REPORT_TYPE,TOTALOPERATEREVE,PARENTNETPROFIT,MLR,ROEJQ,NETCASH_OPERATE_PK,ZCFZL,OPERATE_PROFIT_PK",
    filter: `(SECUCODE="${secucode}")(REPORT_TYPE="年报")`,
    pageNumber: "1",
    pageSize: "8",
    sortTypes: "-1",
    sortColumns: "REPORT_DATE",
  });
}

export async function fetchCnAnnualRows(ticker: string): Promise<AnnualFinancialRow[]> {
  const secucode = cnTickerToSecucode(ticker);
  const res = await fetchEastMoneyDatacenter(buildParams(secucode));
  if (!res.ok) throw new Error(`EastMoney financials failed for ${ticker}: ${res.status}`);

  const body = (await res.json()) as { result?: { data?: RawRow[] } };
  return parseEastMoneyAnnualRows(body.result?.data ?? []);
}
