import { withAdapterDefaults } from "./defaults.js";
import type { SecurityRecord } from "../engine/kill-gates.js";
import type { Market } from "../engine/types.js";
import type { MarketDataAdapter } from "./types.js";

const CLIST_BASE = "https://push2.eastmoney.com/api/qt/clist/get";
const A_SHARE_FS =
  "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const CLIST_FIELDS = "f12,f14,f20,f116,f127";

type EastMoneyRow = Record<string, number | string | undefined>;

function buildListUrl(): string {
  const params = new URLSearchParams({
    pn: "1",
    pz: "5000",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
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

export function createCnEastMoneyAdapter(_opts: { cacheDir: string }): MarketDataAdapter {
  return {
    async loadUniverse(markets: Market[]): Promise<SecurityRecord[]> {
      if (!markets.includes("CN")) return [];

      const res = await fetch(buildListUrl());
      if (!res.ok) throw new Error(`EastMoney list failed: ${res.status}`);

      const body = (await res.json()) as { data?: { diff?: EastMoneyRow[] } };
      return (body.data?.diff ?? []).map(mapRowToSecurityRecord);
    },
  };
}
