import fs from "node:fs/promises";
import path from "node:path";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import { getEastMoneyUt } from "./eastmoney.js";
import { httpFetch } from "../../lib/http-fetch.js";
import type { ProgressLogger } from "../../lib/progress.js";
import type { Market } from "../../funnel/types.js";
import type { LoadUniverseOptions, MarketDataAdapter } from "../types.js";

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

const CLIST_BASE = "https://push2delay.eastmoney.com/api/qt/clist/get";
const A_SHARE_FS =
  "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";

// East Money clist field semantics (push2delay.eastmoney.com/api/qt/clist/get)
const EM_FIELD_TICKER = "f12";
const EM_FIELD_NAME = "f14";
const EM_FIELD_MARKET_CAP = "f20";
const EM_FIELD_LISTING_DATE = "f26";
const EM_FIELD_STATUS = "f127";
const EM_FIELD_PRICE = "f2";
const EM_FIELD_PE_TTM = "f115";
const EM_FIELD_PB = "f23";

const CLIST_FIELDS = [
  EM_FIELD_TICKER,
  EM_FIELD_NAME,
  EM_FIELD_MARKET_CAP,
  EM_FIELD_LISTING_DATE,
  EM_FIELD_STATUS,
  EM_FIELD_PRICE,
  EM_FIELD_PE_TTM,
  EM_FIELD_PB,
].join(",");

const PE_PRICE_TOLERANCE = 0.01;
const PB_CEILING = 15;

export const CN_QUOTE_ANCHOR_TICKERS = ["603195", "600519", "600919"] as const;

const CN_QUOTE_SNAPSHOT_FILE = "cn-quote-universe.json";
const QUOTE_DERIVED_METRICS = new Set(["price", "pe_ttm", "pb", "ps"]);

function cnQuoteUniverseSnapshotPath(cacheDir: string, quarter: string): string {
  return path.join(cacheDir, quarter, "CN", CN_QUOTE_SNAPSHOT_FILE);
}

export async function writeCnQuoteUniverseSnapshot(
  cacheDir: string,
  quarter: string,
  records: SecurityRecord[]
): Promise<void> {
  const file = cnQuoteUniverseSnapshotPath(cacheDir, quarter);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(records, null, 2), "utf8");
}

export async function readCnQuoteUniverseSnapshot(
  cacheDir: string,
  quarter: string
): Promise<SecurityRecord[]> {
  try {
    const raw = await fs.readFile(cnQuoteUniverseSnapshotPath(cacheDir, quarter), "utf8");
    return JSON.parse(raw) as SecurityRecord[];
  } catch {
    return [];
  }
}

export function markCnQuoteUniverseDegraded(
  records: SecurityRecord[],
  hint: string
): SecurityRecord[] {
  return records.map((record) => {
    const metrics = { ...record.metrics };
    for (const key of QUOTE_DERIVED_METRICS) {
      const metric = metrics[key];
      if (metric) metrics[key] = { ...metric, dataConfidence: "low" };
    }
    return {
      ...record,
      metrics,
      auditHints: Array.from(new Set([...(record.auditHints ?? []), hint])),
    };
  });
}

export interface CnQuoteIntegrityReport {
  universe_count: number;
  pe_ttm_present_rate: number;
  pb_present_rate: number;
  market_cap_present_rate: number;
  pe_equals_price_rate: number;
}

const INTEGRITY = {
  minCount: 5200,
  maxCount: 6200,
  minCapRate: 0.99,
  maxPeEqualsPriceRate: 0.001,
};

export function buildCnQuoteIntegrityReport(records: SecurityRecord[]): CnQuoteIntegrityReport {
  const n = records.length;
  let pePresent = 0;
  let pbPresent = 0;
  let capPresent = 0;
  let peEqualsPrice = 0;

  for (const r of records) {
    const price = r.metrics.price?.value;
    const pe = r.metrics.pe_ttm?.value;
    const pb = r.metrics.pb?.value;
    if (pe !== undefined && pe > 0) pePresent += 1;
    if (pb !== undefined && pb > 0) pbPresent += 1;
    if (r.marketCap > 0) capPresent += 1;
    if (price !== undefined && pe !== undefined && price > 0 && Math.abs(pe - price) / price <= PE_PRICE_TOLERANCE) {
      peEqualsPrice += 1;
    }
  }

  return {
    universe_count: n,
    pe_ttm_present_rate: n ? pePresent / n : 0,
    pb_present_rate: n ? pbPresent / n : 0,
    market_cap_present_rate: n ? capPresent / n : 0,
    pe_equals_price_rate: n ? peEqualsPrice / n : 0,
  };
}

export function assertCnQuoteUniverseIntegrity(records: SecurityRecord[]): CnQuoteIntegrityReport {
  const report = buildCnQuoteIntegrityReport(records);
  if (report.universe_count < INTEGRITY.minCount || report.universe_count > INTEGRITY.maxCount) {
    throw new Error(`CN quote integrity: universe_count=${report.universe_count} outside [5200,6200]`);
  }
  if (report.market_cap_present_rate < INTEGRITY.minCapRate) {
    throw new Error(`CN quote integrity: market_cap_present_rate=${report.market_cap_present_rate}`);
  }
  if (report.pe_equals_price_rate > INTEGRITY.maxPeEqualsPriceRate) {
    throw new Error(`CN quote integrity: pe_equals_price_rate=${report.pe_equals_price_rate}`);
  }
  return report;
}

/** East Money caps each page well below requested pz; paginate explicitly. */
const PAGE_SIZE = 100;
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://quote.eastmoney.com/center/gridlist.html",
  Accept: "application/json, text/plain, */*",
  Origin: "https://quote.eastmoney.com",
};

export type EastMoneyRow = Record<string, number | string | undefined>;

export interface SanitizeCnQuoteResult {
  metrics: SecurityRecord["metrics"];
  warnings: string[];
}

export function sanitizeCnQuoteMetrics(
  metrics: SecurityRecord["metrics"]
): SanitizeCnQuoteResult {
  const price = metrics.price?.value;
  const pe = metrics.pe_ttm?.value;
  const pb = metrics.pb?.value;

  const peEqualsPrice =
    price !== undefined &&
    pe !== undefined &&
    price > 0 &&
    Math.abs(pe - price) / price <= PE_PRICE_TOLERANCE;
  const pbLikelyPe = pb !== undefined && pb > PB_CEILING && pe === undefined;
  const hasStale52w =
    metrics.price_vs_52w_high !== undefined || metrics.high_52w !== undefined;

  if (!peEqualsPrice && !pbLikelyPe && !hasStale52w) {
    return { metrics, warnings: [] };
  }

  const next = { ...metrics };
  const warnings: string[] = [];

  if (peEqualsPrice) {
    delete next.pe_ttm;
    warnings.push("pe_ttm_equals_price");
  }
  if (pbLikelyPe) {
    delete next.pb;
    warnings.push("pb_likely_pe_mislabel");
  }
  delete next.price_vs_52w_high;
  delete next.high_52w;

  return { metrics: next, warnings };
}

function buildListUrl(page: number, pageSize: number, ut: string): string {
  const params = new URLSearchParams({
    pn: String(page),
    pz: String(pageSize),
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f12",
    ut,
    fs: A_SHARE_FS,
    fields: CLIST_FIELDS,
  });
  return `${CLIST_BASE}?${params.toString()}`;
}

function parseStatusFromF127(row: EastMoneyRow): string {
  const raw = row[EM_FIELD_STATUS];
  if (raw === undefined || raw === null || raw === "") return "active";

  const text = String(raw).trim();
  if (text === "0" || text === "-" || text.toLowerCase() === "active") return "active";

  const normalized = text.toLowerCase();
  if (normalized === "st" || normalized === "*st" || text === "1") return "ST";
  if (normalized === "suspended" || normalized === "halted" || text === "2") return "suspended";
  if (normalized === "delisting" || normalized === "delisted" || text === "3") return "delisting";

  return text;
}

function positiveMetric(
  value: number | undefined,
  confidence: "medium" | "low" = "medium"
): SecurityRecord["metrics"][string] | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return { value, dataConfidence: confidence };
}

export function mapEastMoneyRowToQuoteMetrics(
  row: EastMoneyRow
): SecurityRecord["metrics"] {
  const metrics: SecurityRecord["metrics"] = {};
  const price = positiveMetric(Number(row[EM_FIELD_PRICE]));
  const peTtm = positiveMetric(Number(row[EM_FIELD_PE_TTM]));
  const pb = positiveMetric(Number(row[EM_FIELD_PB]));

  if (price) metrics.price = price;
  if (peTtm) metrics.pe_ttm = peTtm;
  if (pb) metrics.pb = pb;

  return metrics;
}

export function listingAgeYearsFromEastMoneyDate(
  value: number | string | undefined,
  now = new Date()
): number {
  const raw = String(value ?? "").trim();
  if (!/^\d{8}$/.test(raw)) return 0;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const listedAt = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(listedAt.getTime())) return 0;
  return Math.max(0, (now.getTime() - listedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function mapRowToSecurityRecord(row: EastMoneyRow): SecurityRecord {
  const rawMetrics = mapEastMoneyRowToQuoteMetrics(row);
  const { metrics } = sanitizeCnQuoteMetrics(rawMetrics);

  return withAdapterDefaults({
    ticker: String(row[EM_FIELD_TICKER] ?? ""),
    market: "CN",
    companyName: String(row[EM_FIELD_NAME] ?? ""),
    currency: "CNY",
    status: parseStatusFromF127(row),
    marketCap: Number(row[EM_FIELD_MARKET_CAP] ?? 0),
    listingAgeYears: listingAgeYearsFromEastMoneyDate(row[EM_FIELD_LISTING_DATE]),
    metrics,
  });
}

async function fetchPage(page: number, ut: string): Promise<{ rows: EastMoneyRow[]; total: number }> {
  const url = buildListUrl(page, PAGE_SIZE, ut);
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

export async function probeCnQuotes(tickers: string[] = [...CN_QUOTE_ANCHOR_TICKERS]): Promise<void> {
  const records = await loadCnQuotesByTickers(tickers);
  if (records.length !== tickers.length) {
    const found = new Set(records.map((r) => r.ticker));
    const missing = tickers.filter((t) => !found.has(t));
    throw new Error(`CN quote preflight: missing tickers ${missing.join(", ")}`);
  }
  for (const r of records) {
    const pe = r.metrics.pe_ttm?.value;
    const pb = r.metrics.pb?.value;
    const price = r.metrics.price?.value;
    if (pe === undefined || pb === undefined || price === undefined) {
      throw new Error(`CN quote preflight: ${r.ticker} missing pe/pb/price`);
    }
    if (Math.abs(pe - price) / price <= PE_PRICE_TOLERANCE) {
      throw new Error(`CN quote preflight: ${r.ticker} pe equals price (${pe})`);
    }
  }
}

/** Fetch quote records for specific tickers; stops paging once all are found. */
export async function loadCnQuotesByTickers(tickers: string[]): Promise<SecurityRecord[]> {
  const ut = await getEastMoneyUt();
  const pending = new Set(tickers);
  const found = new Map<string, SecurityRecord>();
  let page = 1;

  while (pending.size > 0 && page <= 200 && found.size < tickers.length) {
    const { rows } = await fetchPage(page, ut);
    if (rows.length === 0) break;

    for (const row of rows) {
      const ticker = String(row[EM_FIELD_TICKER] ?? "");
      if (!pending.has(ticker)) continue;
      found.set(ticker, mapRowToSecurityRecord(row));
      pending.delete(ticker);
    }
    page += 1;
  }

  return tickers.flatMap((ticker) => {
    const record = found.get(ticker);
    return record ? [record] : [];
  });
}

export function createCnEastMoneyAdapter(_opts: { cacheDir: string }): MarketDataAdapter {
  return {
    async loadUniverse(
      markets: Market[],
      opts?: LoadUniverseOptions
    ): Promise<SecurityRecord[]> {
      if (!markets.includes("CN")) return [];

      const ut = await getEastMoneyUt();
      const progress = opts?.progress;
      progress?.phase("Fetching CN quote list from East Money…");

      const records: SecurityRecord[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;

      while (records.length < total) {
        const { rows, total: reportedTotal } = await fetchPage(page, ut);
        total = reportedTotal;

        if (rows.length === 0) break;

        for (const row of rows) {
          records.push(mapRowToSecurityRecord(row));
        }

        if (page === 1 || page % 10 === 0 || records.length >= total) {
          progress?.tick(records.length, total, "CN quotes");
        }

        page += 1;
      }

      if (opts?.quarter) {
        await writeCnQuoteUniverseSnapshot(_opts.cacheDir, opts.quarter, records);
      }

      return records;
    },
  };
}
