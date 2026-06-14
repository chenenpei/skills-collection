import { withHostLimit } from "../../lib/host-limit.js";
import { httpFetch } from "../../lib/http-fetch.js";

export const EASTMONEY_DATACENTER_BASE =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";

export const EASTMONEY_DATACENTER_HOST = "datacenter-web.eastmoney.com";

/** Each enriched ticker fires 2 datacenter calls; cap host-wide in-flight requests. */
const EASTMONEY_MAX_CONCURRENT = 8;

export const EASTMONEY_F10_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://emweb.securities.eastmoney.com/",
};

export async function fetchEastMoneyDatacenter(params: URLSearchParams): Promise<Response> {
  return withHostLimit(EASTMONEY_DATACENTER_HOST, EASTMONEY_MAX_CONCURRENT, () =>
    httpFetch(`${EASTMONEY_DATACENTER_BASE}?${params.toString()}`, {
      headers: EASTMONEY_F10_HEADERS,
    })
  );
}

import type { AnnualFinancialRow } from "../metrics.js";

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


type OrgRow = { BOARD_NAME_LEVEL?: string; EM2016?: string };

export function parseEastMoneyIndustry(row: OrgRow): string | undefined {
  const board = String(row.BOARD_NAME_LEVEL ?? "").trim();
  if (board) return board;
  const em = String(row.EM2016 ?? "").trim();
  return em || undefined;
}

export async function fetchCnIndustryProxy(ticker: string): Promise<string | undefined> {
  const secucode = cnTickerToSecucode(ticker);
  const params = new URLSearchParams({
    reportName: "RPT_F10_BASIC_ORGINFO",
    columns: "SECUCODE,EM2016,BOARD_NAME_LEVEL",
    filter: `(SECUCODE="${secucode}")`,
    pageNumber: "1",
    pageSize: "1",
  });

  const res = await fetchEastMoneyDatacenter(params);
  if (!res.ok) throw new Error(`EastMoney industry failed for ${ticker}: ${res.status}`);

  const body = (await res.json()) as { result?: { data?: OrgRow[] } };
  const row = body.result?.data?.[0];
  return row ? parseEastMoneyIndustry(row) : undefined;
}
