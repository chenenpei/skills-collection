import type { SecurityRecord } from "../../funnel/kill-gates.js";

/** Shared adapter defaults for live providers that only supply quote-level fields. */
export function withAdapterDefaults(
  partial: Pick<
    SecurityRecord,
    "ticker" | "market" | "companyName" | "currency" | "status" | "marketCap" | "listingAgeYears"
  > &
    Partial<SecurityRecord>
): SecurityRecord {
  return {
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
    ...partial,
  };
}

import { httpFetch } from "../../lib/http-fetch.js";
import type { Market } from "../../funnel/types.js";
import type { MarketDataAdapter } from "../types.js";

const CLIST_BASE = "https://push2delay.eastmoney.com/api/qt/clist/get";
const EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const A_SHARE_FS =
  "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const CLIST_FIELDS = "f12,f14,f20,f116,f127";
/** East Money caps each page well below requested pz; paginate explicitly. */
const PAGE_SIZE = 100;
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://quote.eastmoney.com/center/gridlist.html",
  Accept: "application/json, text/plain, */*",
  Origin: "https://quote.eastmoney.com",
};

type EastMoneyRow = Record<string, number | string | undefined>;

function buildListUrl(page: number, pageSize: number): string {
  const params = new URLSearchParams({
    pn: String(page),
    pz: String(pageSize),
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f12",
    ut: EASTMONEY_UT,
    fs: A_SHARE_FS,
    fields: CLIST_FIELDS,
  });
  return `${CLIST_BASE}?${params.toString()}`;
}

function parseStatusFromF127(row: EastMoneyRow): string {
  const raw = row.f127;
  if (raw === undefined || raw === null || raw === "") return "active";

  const text = String(raw).trim();
  if (text === "0" || text === "-" || text.toLowerCase() === "active") return "active";

  const normalized = text.toLowerCase();
  if (normalized === "st" || normalized === "*st" || text === "1") return "ST";
  if (normalized === "suspended" || normalized === "halted" || text === "2") return "suspended";
  if (normalized === "delisting" || normalized === "delisted" || text === "3") return "delisting";

  return text;
}

function mapRowToSecurityRecord(row: EastMoneyRow): SecurityRecord {
  return withAdapterDefaults({
    ticker: String(row.f12 ?? ""),
    market: "CN",
    companyName: String(row.f14 ?? ""),
    currency: "CNY",
    status: parseStatusFromF127(row),
    marketCap: Number(row.f20 ?? 0),
    listingAgeYears: Number(row.f116 ?? 0) / 365,
  });
}

async function fetchPage(page: number): Promise<{ rows: EastMoneyRow[]; total: number }> {
  const url = buildListUrl(page, PAGE_SIZE);
  let res: Response;
  try {
    res = await httpFetch(url, { headers: REQUEST_HEADERS });
  } catch (err) {
    const cause = err instanceof Error && "cause" in err ? (err.cause as Error | undefined) : undefined;
    const detail = cause?.message ?? (err instanceof Error ? err.message : String(err));
    throw new Error(`EastMoney fetch failed (${url}): ${detail}`);
  }
  if (!res.ok) throw new Error(`EastMoney list failed: ${res.status} ${url}`);

  const body = (await res.json()) as { data?: { diff?: EastMoneyRow[]; total?: number } };
  const rows = body.data?.diff ?? [];
  const total = body.data?.total ?? rows.length;
  return { rows, total };
}

export function createCnEastMoneyAdapter(_opts: { cacheDir: string }): MarketDataAdapter {
  return {
    async loadUniverse(markets: Market[]): Promise<SecurityRecord[]> {
      if (!markets.includes("CN")) return [];

      const records: SecurityRecord[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;

      while (records.length < total) {
        const { rows, total: reportedTotal } = await fetchPage(page);
        total = reportedTotal;

        if (rows.length === 0) break;

        for (const row of rows) {
          records.push(mapRowToSecurityRecord(row));
        }

        page += 1;
      }

      return records;
    },
  };
}
