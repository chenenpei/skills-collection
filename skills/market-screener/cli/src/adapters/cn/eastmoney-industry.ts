import { httpFetch } from "../../lib/http-fetch.js";
import { cnTickerToSecucode } from "./eastmoney-financials.js";

const BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://emweb.securities.eastmoney.com/",
};

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

  const res = await httpFetch(`${BASE}?${params.toString()}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`EastMoney industry failed for ${ticker}: ${res.status}`);

  const body = (await res.json()) as { result?: { data?: OrgRow[] } };
  const row = body.result?.data?.[0];
  return row ? parseEastMoneyIndustry(row) : undefined;
}
