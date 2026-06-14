import { withHostLimit } from "../../lib/host-limit.js";
import { httpFetch } from "../../lib/http-fetch.js";
import type { DataConfidence } from "../../funnel/types.js";
import type { AnnualFinancialRow } from "../metrics.js";

export const EASTMONEY_DATACENTER_BASE =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";

export const EASTMONEY_DATACENTER_HOST = "datacenter-web.eastmoney.com";
export const EASTMONEY_QUOTE_HOST = "push2delay.eastmoney.com";
export const EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281";

const CASHFLOW_REPORT = "RPT_DMSK_FN_CASHFLOW";
const BALANCE_REPORT = "RPT_DMSK_FN_BALANCE";

/** Each enriched ticker fires up to 4 datacenter calls; cap host-wide in-flight requests. */
const EASTMONEY_MAX_CONCURRENT = 12;

export const EASTMONEY_F10_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://emweb.securities.eastmoney.com/",
};

export const EASTMONEY_QUOTE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://quote.eastmoney.com/",
  Accept: "application/json, text/plain, */*",
  Origin: "https://quote.eastmoney.com",
};

export async function fetchEastMoneyDatacenter(params: URLSearchParams): Promise<Response> {
  return withHostLimit(EASTMONEY_DATACENTER_HOST, EASTMONEY_MAX_CONCURRENT, () =>
    httpFetch(`${EASTMONEY_DATACENTER_BASE}?${params.toString()}`, {
      headers: EASTMONEY_F10_HEADERS,
    })
  );
}

export type CnDividendBonusRow = {
  REPORT_DATE?: string;
  DIVIDENT_RATIO?: number | string | null;
  ASSIGN_PROGRESS?: string;
};

export function pickCnDividendYieldFromBonusRows(
  rows: CnDividendBonusRow[]
): { yield: number; dataConfidence: DataConfidence } | undefined {
  const valid = rows
    .filter((r) => r.DIVIDENT_RATIO !== null && r.DIVIDENT_RATIO !== undefined && r.DIVIDENT_RATIO !== "")
    .map((r) => ({
      progress: String(r.ASSIGN_PROGRESS ?? ""),
      date: String(r.REPORT_DATE ?? ""),
      ratio: Number(r.DIVIDENT_RATIO),
    }))
    .filter((r) => Number.isFinite(r.ratio) && r.ratio >= 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (valid.length === 0) return undefined;

  const implemented = valid.filter((r) => r.progress.includes("实施分配"));
  const pick = implemented[0] ?? valid[0]!;
  let yieldVal = pick.ratio;
  if (yieldVal > 1) yieldVal /= 100;
  return {
    yield: yieldVal,
    dataConfidence: implemented.length > 0 ? "high" : "low",
  };
}

type RawRow = Record<string, string | number | null | undefined>;

function cnExchangeCodes(ticker: string): { secid: string; secucode: string } {
  const sh = ticker.startsWith("6");
  return {
    secid: `${sh ? "1" : "0"}.${ticker}`,
    secucode: `${ticker}.${sh ? "SH" : "SZ"}`,
  };
}

export function cnTickerToSecucode(ticker: string): string {
  return cnExchangeCodes(ticker).secucode;
}

export function cnTickerToSecid(ticker: string): string {
  return cnExchangeCodes(ticker).secid;
}

function buildDatacenterParams(opts: {
  reportName: string;
  columns: string;
  filter: string;
  pageSize?: string;
  sortByReportDate?: boolean;
}): URLSearchParams {
  const params = new URLSearchParams({
    reportName: opts.reportName,
    columns: opts.columns,
    filter: opts.filter,
    pageNumber: "1",
    pageSize: opts.pageSize ?? "8",
  });
  if (opts.sortByReportDate !== false) {
    params.set("sortTypes", "-1");
    params.set("sortColumns", "REPORT_DATE");
  }
  return params;
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

export async function fetchCnAnnualRows(ticker: string): Promise<AnnualFinancialRow[]> {
  const secucode = cnTickerToSecucode(ticker);
  const res = await fetchEastMoneyDatacenter(
    buildDatacenterParams({
      reportName: "RPT_F10_FINANCE_MAINFINADATA",
      columns:
        "SECUCODE,REPORT_DATE,REPORT_TYPE,TOTALOPERATEREVE,PARENTNETPROFIT,MLR,ROEJQ,NETCASH_OPERATE_PK,ZCFZL,OPERATE_PROFIT_PK",
      filter: `(SECUCODE="${secucode}")(REPORT_TYPE="年报")`,
    })
  );
  if (!res.ok) throw new Error(`EastMoney financials failed for ${ticker}: ${res.status}`);

  const body = (await res.json()) as { result?: { data?: RawRow[] } };
  return parseEastMoneyAnnualRows(body.result?.data ?? []);
}

export function isAnnualReportDate(reportDate: string): boolean {
  return String(reportDate).slice(0, 10).endsWith("-12-31");
}

export function parseAnnualReportDateYear(reportDate: string): number {
  return Number(String(reportDate).slice(0, 4));
}

export type SupplementalAnnualFields = { capex?: number; inventory?: number };

export function mergeSupplementalIntoAnnualRows(
  rows: AnnualFinancialRow[],
  supplemental: Map<number, SupplementalAnnualFields>
): AnnualFinancialRow[] {
  if (supplemental.size === 0) return rows;
  return rows.map((row) => {
    const extra = supplemental.get(row.year);
    if (!extra) return row;
    return {
      ...row,
      capex: extra.capex ?? row.capex,
      inventory: extra.inventory ?? row.inventory,
    };
  });
}

function parseSupplementalRows(
  cashflowData: RawRow[],
  balanceData: RawRow[]
): Map<number, SupplementalAnnualFields> {
  const map = new Map<number, SupplementalAnnualFields>();
  const sources: Array<{
    rows: RawRow[];
    apply: (existing: SupplementalAnnualFields, row: RawRow) => SupplementalAnnualFields;
  }> = [
    {
      rows: cashflowData,
      apply: (existing, row) => ({
        ...existing,
        capex: Math.abs(Number(row.CONSTRUCT_LONG_ASSET ?? 0)),
      }),
    },
    {
      rows: balanceData,
      apply: (existing, row) => ({
        ...existing,
        inventory: Number(row.INVENTORY ?? 0),
      }),
    },
  ];

  for (const { rows, apply } of sources) {
    for (const row of rows) {
      const reportDate = String(row.REPORT_DATE ?? "");
      if (!isAnnualReportDate(reportDate)) continue;
      const year = parseAnnualReportDateYear(reportDate);
      map.set(year, apply(map.get(year) ?? {}, row));
    }
  }
  return map;
}

async function fetchSupplementalReport(
  secucode: string,
  reportName: string,
  fieldColumn: string
): Promise<RawRow[]> {
  const res = await fetchEastMoneyDatacenter(
    buildDatacenterParams({
      reportName,
      columns: `SECUCODE,REPORT_DATE,${fieldColumn}`,
      filter: `(SECUCODE="${secucode}")`,
    })
  );
  if (!res.ok) throw new Error(`EastMoney ${reportName} failed: ${res.status}`);
  const body = (await res.json()) as { result?: { data?: RawRow[] } };
  return body.result?.data ?? [];
}

export async function fetchCnSupplementalAnnualRows(
  ticker: string
): Promise<Map<number, SupplementalAnnualFields>> {
  const secucode = cnTickerToSecucode(ticker);
  const [cashflowData, balanceData] = await Promise.all([
    fetchSupplementalReport(secucode, CASHFLOW_REPORT, "CONSTRUCT_LONG_ASSET"),
    fetchSupplementalReport(secucode, BALANCE_REPORT, "INVENTORY"),
  ]);
  return parseSupplementalRows(cashflowData, balanceData);
}

export async function fetchCnDividendYield(
  ticker: string
): Promise<{ yield: number; dataConfidence: DataConfidence } | undefined> {
  const res = await fetchEastMoneyDatacenter(
    buildDatacenterParams({
      reportName: "RPT_SHAREBONUS_DET",
      columns: "SECURITY_CODE,REPORT_DATE,ASSIGN_PROGRESS,DIVIDENT_RATIO",
      filter: `(SECURITY_CODE="${ticker}")`,
      pageSize: "20",
    })
  );
  if (!res.ok) return undefined;

  const body = (await res.json()) as { result?: { data?: CnDividendBonusRow[] } };
  return pickCnDividendYieldFromBonusRows(body.result?.data ?? []);
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
  const res = await fetchEastMoneyDatacenter(
    buildDatacenterParams({
      reportName: "RPT_F10_BASIC_ORGINFO",
      columns: "SECUCODE,EM2016,BOARD_NAME_LEVEL",
      filter: `(SECUCODE="${secucode}")`,
      pageSize: "1",
      sortByReportDate: false,
    })
  );
  if (!res.ok) throw new Error(`EastMoney industry failed for ${ticker}: ${res.status}`);

  const body = (await res.json()) as { result?: { data?: OrgRow[] } };
  const row = body.result?.data?.[0];
  return row ? parseEastMoneyIndustry(row) : undefined;
}
