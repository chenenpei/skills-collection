/**
 * 美股基本面：解析 SEC 证券标识与年报，派生财务指标并维护季度补全缓存。
 * 报告口径与指标单位在此保持一致；旧 CN 缓存的读取仅供历史模板报告兼容。
 */
import { httpFetch, withHostLimit } from "../../shared/runtime.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DataConfidence, MetricValue, SecurityRecord } from "../../shared/financial-model.js";
import { sanitizeCnQuoteMetrics } from "../../cn/sources/market-data.js";

// SEC 来源：匹配证券标识并读取年度财报。

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const SEC_UA = "market-screener-cli/0.1 (contact: dev@local)";

type TickerEntry = { cik_str: number; ticker: string; title: string };

export function parseTickerMap(raw: Record<string, TickerEntry>): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of Object.values(raw)) {
    const cik = String(entry.cik_str).padStart(10, "0");
    map.set(entry.ticker.toUpperCase(), cik);
  }
  return map;
}

let cachedMap: Map<string, string> | null = null;
let loadPromise: Promise<Map<string, string>> | null = null;

export async function loadTickerToCikMap(): Promise<Map<string, string>> {
  if (cachedMap) return cachedMap;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await httpFetch(SEC_TICKERS_URL, {
        headers: { "User-Agent": SEC_UA },
      });
      if (!res.ok) throw new Error(`SEC tickers failed: ${res.status}`);
      cachedMap = parseTickerMap((await res.json()) as Record<string, TickerEntry>);
      return cachedMap;
    })();
  }
  return loadPromise;
}

export async function resolveCik(ticker: string): Promise<string | undefined> {
  const map = await loadTickerToCikMap();
  return map.get(ticker.toUpperCase());
}

const SEC_HOST = "data.sec.gov";
/** SEC fair-access guidance: stay near ~10 req/s; 4 concurrent is conservative. */
const SEC_MAX_CONCURRENT = 4;

export async function secFetch(path: string): Promise<Response> {
  return withHostLimit(SEC_HOST, SEC_MAX_CONCURRENT, () =>
    httpFetch(`https://${SEC_HOST}${path}`, {
      headers: { "User-Agent": SEC_UA },
    }),
  );
}

// SIC 描述只作行业代理，避免把 SEC 原始分类当成最终模板路由结论。
type Submissions = { sicDescription?: string; sic?: string };

export function parseSubmissionsIndustry(body: Submissions): string | undefined {
  const text = String(body.sicDescription ?? "").trim();
  return text || undefined;
}

export async function fetchUsIndustryProxy(cik: string): Promise<string | undefined> {
  const res = await secFetch(`/submissions/CIK${cik}.json`);
  if (!res.ok) throw new Error(`SEC submissions failed for CIK${cik}: ${res.status}`);
  return parseSubmissionsIndustry((await res.json()) as Submissions);
}

type FactPoint = { fy?: number; fp?: string; val?: number; form?: string };
type GaapFacts = Record<string, { units?: Record<string, FactPoint[]> }>;
export type FactsBody = {
  facts?: {
    "us-gaap"?: GaapFacts;
  };
};

export function effectiveTaxRate(
  taxMap: Map<number, number>,
  pretaxMap: Map<number, number>,
  year: number,
): number {
  const tax = taxMap.get(year);
  const pretax = pretaxMap.get(year);
  if (tax === undefined || pretax === undefined || pretax <= 0) return 0.21;
  return Math.min(0.35, Math.max(0, tax / pretax));
}

export function deriveUsRoicForYear(
  year: number,
  ctx: {
    operatingProfit?: number;
    taxRate: number;
    totalEquity?: number;
    longTermDebt?: number;
    shortTermDebt?: number;
    monetaryFunds?: number;
  },
): number | undefined {
  const { operatingProfit, taxRate, totalEquity, longTermDebt, shortTermDebt, monetaryFunds } = ctx;
  if (
    operatingProfit === undefined ||
    operatingProfit <= 0 ||
    totalEquity === undefined ||
    totalEquity <= 0
  ) {
    return undefined;
  }
  const debt = (longTermDebt ?? 0) + (shortTermDebt ?? 0);
  const cash = monetaryFunds ?? 0;
  const invested = totalEquity + debt - cash;
  if (invested <= 0) return undefined;
  return (operatingProfit * (1 - taxRate)) / invested;
}

function pickGaapSeries(gaap: GaapFacts | undefined, keys: string[]): FactPoint[] {
  if (!gaap) return [];
  for (const key of keys) {
    const series = gaap[key]?.units?.USD;
    if (series?.length) return series;
  }
  return [];
}

function pickRevenueTag(gaap: GaapFacts | undefined): FactPoint[] {
  return pickGaapSeries(gaap, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ]);
}

function pickCapexTag(gaap: GaapFacts): FactPoint[] {
  return pickGaapSeries(gaap, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ]);
}

function fyPoints(series: FactPoint[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const p of series) {
    if (p.fp !== "FY" || p.fy === undefined || p.val === undefined) continue;
    if (p.form !== "10-K") continue;
    map.set(p.fy, p.val);
  }
  return map;
}

function pickYearValue(maps: Map<number, number>[], year: number): number | undefined {
  for (const map of maps) {
    const value = map.get(year);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function parseCompanyFactsAnnualRows(body: FactsBody): AnnualFinancialRow[] {
  const gaap = body.facts?.["us-gaap"] ?? {};
  const revenueMap = fyPoints(pickRevenueTag(gaap));
  const netIncomeMap = fyPoints(gaap.NetIncomeLoss?.units?.USD ?? []);
  const operatingMap = fyPoints(pickGaapSeries(gaap, ["OperatingIncomeLoss"]));
  const assetsMap = fyPoints(pickGaapSeries(gaap, ["Assets"]));
  const liabilitiesMap = fyPoints(pickGaapSeries(gaap, ["Liabilities"]));
  const equityMap = fyPoints(pickGaapSeries(gaap, ["StockholdersEquity"]));
  const cashMap = fyPoints(pickGaapSeries(gaap, ["CashAndCashEquivalentsAtCarryingValue"]));
  const ltdMaps = [
    fyPoints(gaap.LongTermDebtNoncurrent?.units?.USD ?? []),
    fyPoints(gaap.LongTermDebt?.units?.USD ?? []),
  ];
  const stdMaps = [
    fyPoints(gaap.DebtCurrent?.units?.USD ?? []),
    fyPoints(gaap.ShortTermBorrowings?.units?.USD ?? []),
  ];
  const taxMap = fyPoints(pickGaapSeries(gaap, ["IncomeTaxExpenseBenefit"]));
  const pretaxMap = fyPoints(
    pickGaapSeries(gaap, [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    ]),
  );
  const ocfMap = fyPoints(gaap.NetCashProvidedByUsedInOperatingActivities?.units?.USD ?? []);
  const grossProfitMap = fyPoints(gaap.GrossProfit?.units?.USD ?? []);
  const cogsMap = fyPoints(pickGaapSeries(gaap, ["CostOfRevenue", "CostOfGoodsAndServicesSold"]));
  const capexMap = fyPoints(pickCapexTag(gaap));
  const inventoryMap = fyPoints(gaap.InventoryNet?.units?.USD ?? []);

  const rows: AnnualFinancialRow[] = [];
  const years = [...revenueMap.keys()].sort((a, b) => a - b);
  for (const year of years) {
    const revenue = revenueMap.get(year);
    if (revenue === undefined || revenue <= 0) continue;

    const netIncome = netIncomeMap.get(year);
    if (netIncome === undefined) continue;

    let grossProfit = grossProfitMap.get(year);
    if (grossProfit === undefined) {
      const cogs = cogsMap.get(year);
      if (cogs === undefined) continue;
      grossProfit = revenue - cogs;
    }

    const operatingCashFlow = ocfMap.get(year);
    if (operatingCashFlow === undefined) continue;

    const totalEquity = equityMap.get(year);
    if (totalEquity === undefined) continue;
    const prevEquity = equityMap.get(year - 1);
    const averageEquity = prevEquity !== undefined ? (prevEquity + totalEquity) / 2 : totalEquity;
    if (averageEquity <= 0) continue;
    const roe = netIncome / averageEquity;

    const assets = assetsMap.get(year);
    const totalLiabilities = liabilitiesMap.get(year);
    if (assets === undefined || assets <= 0 || totalLiabilities === undefined) continue;
    const assetLiabilityRatio = totalLiabilities / assets;

    const operatingProfit = operatingMap.get(year);
    const monetaryFunds = cashMap.get(year);
    const taxRate = effectiveTaxRate(taxMap, pretaxMap, year);
    const roic = deriveUsRoicForYear(year, {
      operatingProfit,
      taxRate,
      totalEquity,
      longTermDebt: pickYearValue(ltdMaps, year),
      shortTermDebt: pickYearValue(stdMaps, year),
      monetaryFunds,
    });

    rows.push({
      year,
      revenue,
      grossProfit,
      netIncome,
      operatingCashFlow,
      roe,
      assetLiabilityRatio,
      operatingProfit,
      totalEquity,
      totalLiabilities,
      monetaryFunds,
      roic,
      capex: capexMap.get(year),
      inventory: inventoryMap.get(year),
    });
  }

  return rows;
}

export async function fetchUsAnnualRows(cik: string): Promise<AnnualFinancialRow[]> {
  const res = await secFetch(`/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!res.ok) throw new Error(`SEC companyfacts failed for CIK${cik}: ${res.status}`);
  return parseCompanyFactsAnnualRows((await res.json()) as FactsBody);
}

// 财务指标与缓存：用可比年报行派生模板指标，保留历史缓存读取。

export const ENRICH_STATS_SAMPLE_CAP = 20;

export function enrichCacheFilePath(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string,
): string {
  return path.join(cacheDir, quarter, market, `${ticker}.json`);
}

export async function readCache<T>(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string,
): Promise<T | null> {
  try {
    return JSON.parse(
      await fsp.readFile(enrichCacheFilePath(cacheDir, quarter, market, ticker), "utf8"),
    ) as T;
  } catch {
    return null;
  }
}

export async function writeCache(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string,
  payload: unknown,
): Promise<void> {
  const file = enrichCacheFilePath(cacheDir, quarter, market, ticker);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}

// 年报行负责可复算的基本面指标；报价指标只作为估值与价格上下文。
/** Insufficient history sentinel — exceeds any spec max threshold (e.g. max: 5). */
const INSUFFICIENT_DECLINE_PP = 99;

/** Largest peak-to-trough gross margin drop over the last 3 fiscal years, in percentage points. */
export function computeGrossMarginMaxDeclinePp(margins: number[]): number {
  const window = margins.filter((m) => m > 0).slice(-3);
  if (window.length < 2) return INSUFFICIENT_DECLINE_PP;

  let peak = window[0];
  let maxDecline = 0;
  for (const margin of window) {
    peak = Math.max(peak, margin);
    maxDecline = Math.max(maxDecline, peak - margin);
  }
  return maxDecline * 100;
}

export interface AnnualFinancialRow {
  year: number;
  revenue: number;
  grossProfit: number;
  netIncome: number;
  operatingCashFlow: number;
  roe: number; // decimal, e.g. 0.36 for 36%
  assetLiabilityRatio: number; // decimal, liabilities/assets
  operatingProfit?: number;
  capex?: number; // abs(CONSTRUCT_LONG_ASSET)
  inventory?: number;
  roic?: number;
  totalLiabilities?: number;
  totalEquity?: number;
  monetaryFunds?: number;
}

/** Pre-ADR-0005 cache rows lack ROIC / balance fields — refresh without full skipCache. */
export function annualRowsNeedMetricRefresh(rows: AnnualFinancialRow[]): boolean {
  const latest = rows[rows.length - 1];
  if (!latest) return false;
  return latest.roic === undefined || latest.totalEquity === undefined;
}

function mv(value: number, confidence: MetricValue["dataConfidence"] = "medium"): MetricValue {
  return { value, dataConfidence: confidence };
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function cagr(start: number, end: number, years: number): number {
  if (start <= 0 || end <= 0 || years <= 0) return 0;
  return Math.pow(end / start, 1 / years) - 1;
}

function operatingMargin(row: AnnualFinancialRow): number | undefined {
  if (row.revenue <= 0) return undefined;
  if (row.operatingProfit === undefined || row.operatingProfit <= 0) return undefined;
  return row.operatingProfit / row.revenue;
}

function netDebtFromBalance(row: AnnualFinancialRow): number | undefined {
  if (row.totalLiabilities === undefined || row.monetaryFunds === undefined) return undefined;
  return Math.max(0, row.totalLiabilities - row.monetaryFunds);
}

function inventoryTurnover(row: AnnualFinancialRow, prev?: AnnualFinancialRow): number | undefined {
  if (row.inventory === undefined || row.revenue <= 0) return undefined;
  const cogs = row.revenue - row.grossProfit;
  if (cogs <= 0) return undefined;
  const avgInv =
    prev?.inventory !== undefined ? (row.inventory + prev.inventory) / 2 : row.inventory;
  if (avgInv <= 0) return undefined;
  return cogs / avgInv;
}

export interface DeriveContext {
  marketCap: number;
  currency: string;
  priceToBook?: number;
  trailingPe?: number;
  fcf?: number;
  price?: number;
  high52Week?: number;
}

const MID_CYCLE_WINDOW_YEARS = 7;
/** Consumer/healthcare mispricing supporting floor (fcf_yield_vs_risk_free min 0.04). */
const RISK_FREE_RATE = 0.04;

function ebitdaForRow(row: AnnualFinancialRow): number | undefined {
  if (row.operatingProfit === undefined || row.operatingProfit <= 0) return undefined;
  return row.operatingProfit;
}

function fcfForRow(row: AnnualFinancialRow): number {
  const capex = row.capex !== undefined ? Math.abs(row.capex) : 0;
  return row.operatingCashFlow - capex;
}

function midCycleAverage(values: number[], excludeNegative = false): number | undefined {
  if (values.length === 0) return undefined;
  const filtered = excludeNegative ? values.filter((v) => v > 0) : values;
  if (filtered.length === 0) return undefined;
  return avg(filtered);
}

export function deriveFromAnnualRows(
  rows: AnnualFinancialRow[],
  ctx: DeriveContext,
): Pick<
  SecurityRecord,
  | "metrics"
  | "revenueYoyHistory"
  | "ocfNegativeYears"
  | "netLossWidening"
  | "latestFinancialMonthsOld"
> {
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const latest = sorted[sorted.length - 1];
  const last5 = sorted.slice(-5);

  const grossMargins = last5.map((r) => (r.revenue > 0 ? r.grossProfit / r.revenue : 0));
  const roes = last5.map((r) => r.roe);
  const fcfConversions = last5
    .filter((r) => r.netIncome > 0)
    .map((r) => r.operatingCashFlow / r.netIncome);

  const revenueYoyHistory: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1].revenue;
    const cur = sorted[i].revenue;
    if (prev > 0) revenueYoyHistory.push((cur - prev) / prev);
  }

  const ocfNegativeYears = sorted.slice(-3).filter((r) => r.operatingCashFlow < 0).length;
  const losses = sorted.slice(-3).filter((r) => r.netIncome < 0);
  const netLossWidening =
    losses.length >= 2 && losses[losses.length - 1].netIncome < losses[0].netIncome;

  const grossMargin = latest.revenue > 0 ? latest.grossProfit / latest.revenue : 0;
  const opMargin = operatingMargin(latest);
  const fcfYield = ctx.marketCap > 0 && ctx.fcf !== undefined ? ctx.fcf / ctx.marketCap : undefined;

  const metrics: Record<string, MetricValue> = {
    revenue: mv(latest.revenue),
    net_income: mv(latest.netIncome),
    operating_cash_flow: mv(latest.operatingCashFlow),
    roe_ttm: mv(latest.roe),
    roe_5y_avg: mv(avg(roes)),
    gross_margin: mv(grossMargin),
    gross_margin_3y_max_decline_pp: mv(computeGrossMarginMaxDeclinePp(grossMargins)),
    fcf_conversion_5y: mv(avg(fcfConversions.length ? fcfConversions : [0])),
    revenue_3y_cagr: mv(
      sorted.length >= 4
        ? cagr(sorted[sorted.length - 4].revenue, latest.revenue, 3)
        : cagr(sorted[0].revenue, latest.revenue, Math.max(1, sorted.length - 1)),
    ),
  };

  if (opMargin !== undefined) {
    metrics.operating_margin = mv(opMargin);
  }

  const capexYears = sorted.slice(-3).filter((r) => r.revenue > 0 && r.capex !== undefined);
  if (capexYears.length >= 2) {
    const ratios = capexYears.map((r) => Math.abs(r.capex!) / r.revenue);
    const confidence = capexYears.length >= 3 ? "high" : "medium";
    metrics.capex_to_revenue = mv(avg(ratios), confidence);
  }

  if (sorted.length >= 2) {
    const latestIdx = sorted.length - 1;
    const turnover = inventoryTurnover(sorted[latestIdx], sorted[latestIdx - 1]);
    if (turnover !== undefined) {
      metrics.inventory_turnover = mv(turnover);
    }
  }

  if (fcfYield !== undefined) metrics.fcf_yield = mv(fcfYield);
  if (ctx.trailingPe !== undefined) metrics.pe_ttm = mv(ctx.trailingPe);
  if (ctx.priceToBook !== undefined) metrics.pb = mv(ctx.priceToBook);
  if (ctx.trailingPe !== undefined && ctx.priceToBook !== undefined) {
    metrics.graham_composite = mv(ctx.trailingPe * ctx.priceToBook);
  }
  if (ctx.price !== undefined && ctx.high52Week !== undefined && ctx.high52Week > 0) {
    metrics.price_vs_52w_high = mv(ctx.price / ctx.high52Week);
  }
  if (ctx.marketCap > 0 && latest.revenue > 0) {
    metrics.ps = mv(ctx.marketCap / latest.revenue);
  }

  const last7 = sorted.slice(-MID_CYCLE_WINDOW_YEARS);
  const midCycleEps = midCycleAverage(
    last7.map((r) => r.netIncome),
    true,
  );
  if (midCycleEps !== undefined && midCycleEps > 0 && ctx.marketCap > 0) {
    metrics.mid_cycle_eps = mv(midCycleEps);
    metrics.mid_cycle_pe = mv(ctx.marketCap / midCycleEps);
  }
  const midCycleFcf = midCycleAverage(last7.map((r) => fcfForRow(r)));
  if (midCycleFcf !== undefined && ctx.marketCap > 0) {
    metrics.mid_cycle_fcf = mv(midCycleFcf);
    metrics.mid_cycle_fcf_yield = mv(midCycleFcf / ctx.marketCap);
  }
  const midCycleOpMargin = midCycleAverage(
    last7.map((r) => operatingMargin(r)).filter((v): v is number => v !== undefined),
  );
  if (midCycleOpMargin !== undefined) {
    metrics.mid_cycle_operating_margin = mv(midCycleOpMargin);
  }

  const midCycleEbitda = midCycleAverage(
    last7.map((r) => ebitdaForRow(r)).filter((v): v is number => v !== undefined),
  );
  if (midCycleEbitda !== undefined && midCycleEbitda > 0) {
    metrics.mid_cycle_ebitda = mv(midCycleEbitda);
    const netDebt = netDebtFromBalance(latest);
    if (ctx.marketCap > 0 && netDebt !== undefined) {
      metrics.mid_cycle_ev_ebitda = mv((ctx.marketCap + netDebt) / midCycleEbitda);
    }
  }

  const marginHistory = sorted
    .slice(-MID_CYCLE_WINDOW_YEARS)
    .map((r) => operatingMargin(r))
    .filter((v): v is number => v !== undefined);
  if (marginHistory.length >= 2 && opMargin !== undefined) {
    metrics.operating_margin_vs_10y_median = mv(opMargin - median(marginHistory));
  }

  if (sorted.length >= 11) {
    metrics.revenue_10y_cagr = mv(cagr(sorted[sorted.length - 11].revenue, latest.revenue, 10));
  } else if (sorted.length >= 2) {
    metrics.revenue_10y_cagr = mv(
      cagr(sorted[0].revenue, latest.revenue, Math.max(1, sorted.length - 1)),
    );
  }

  const roe3y = sorted.slice(-3).map((r) => r.roe);
  if (roe3y.length > 0) metrics.roe_3y_avg = mv(avg(roe3y));

  const roicHistory = last5.map((r) => r.roic).filter((v): v is number => v !== undefined);
  if (latest.roic !== undefined) {
    metrics.roic_ttm = mv(latest.roic, "high");
    metrics.roic = metrics.roic_ttm;
  }
  if (roicHistory.length >= 3) {
    metrics.roic_5y_avg = mv(avg(roicHistory), roicHistory.length >= 5 ? "high" : "medium");
  }

  if (
    latest.totalEquity !== undefined &&
    latest.totalEquity > 0 &&
    latest.totalLiabilities !== undefined
  ) {
    metrics.debt_to_equity = mv(latest.totalLiabilities / latest.totalEquity, "high");
    metrics.net_debt_to_equity = metrics.debt_to_equity;
  }
  const ebitda = ebitdaForRow(latest);
  const netDebt = netDebtFromBalance(latest);
  if (ebitda !== undefined && netDebt !== undefined) {
    metrics.net_debt_to_ebitda = mv(netDebt / ebitda, "high");
  }

  const latestRevenueYoy = revenueYoyHistory[revenueYoyHistory.length - 1];
  if (latestRevenueYoy !== undefined) {
    metrics.revenue_yoy = mv(latestRevenueYoy);
    metrics.revenue_growth_yoy = mv(latestRevenueYoy);
  }

  const latestFcf = ctx.fcf ?? fcfForRow(latest);
  const fcfMargin = latest.revenue > 0 ? latestFcf / latest.revenue : 0;
  if (latest.revenue > 0) metrics.fcf_margin = mv(fcfMargin);
  metrics.rule_of_40 = mv(((latestRevenueYoy ?? 0) + fcfMargin) * 100);

  if (ctx.marketCap > 0 && latest.revenue > 0) {
    metrics.revenue_yield = mv(latest.revenue / ctx.marketCap);
  }
  if (fcfYield !== undefined) {
    metrics.fcf_yield_vs_risk_free = mv(fcfYield - RISK_FREE_RATE);
  }
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    if (
      prev.inventory !== undefined &&
      latest.inventory !== undefined &&
      prev.inventory > 0 &&
      prev.revenue > 0 &&
      latest.revenue > 0
    ) {
      const invGrowth = (latest.inventory - prev.inventory) / prev.inventory;
      const revGrowth = (latest.revenue - prev.revenue) / prev.revenue;
      metrics.inventory_growth_minus_revenue = mv(invGrowth - revGrowth);
    }
  }

  return {
    metrics,
    revenueYoyHistory,
    ocfNegativeYears,
    netLossWidening,
    latestFinancialMonthsOld: 6,
  };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function industryGroupKey(record: SecurityRecord): string {
  return `${record.market}::${record.industryProxy ?? "unknown"}`;
}

function metricValues(group: SecurityRecord[], key: string): number[] {
  return group.map((r) => r.metrics[key]?.value).filter((v): v is number => v !== undefined);
}

const VS_INDUSTRY_SPECS = [
  { base: "gross_margin", vs: "gross_margin_vs_industry", mode: "diff" as const },
  { base: "operating_margin", vs: "operating_margin_vs_industry", mode: "diff" as const },
  {
    base: "inventory_turnover",
    vs: "inventory_turnover_vs_industry",
    mode: "diff" as const,
    requirePositiveMedian: true,
  },
  {
    base: "pe_ttm",
    vsPeer: "pe_ttm_vs_peer_median",
    vsIndustry: "pe_ttm_vs_industry_median",
    mode: "ratio" as const,
  },
  {
    base: "pb",
    vsPeer: "pb_vs_peer_median",
    vsIndustry: "pb_vs_industry_median",
    mode: "ratio" as const,
  },
  {
    base: "ps",
    vsPeer: "ps_vs_peer_median",
    vsIndustry: "ps_vs_industry_median",
    mode: "ratio" as const,
  },
  { base: "roe_ttm", vs: "roe_vs_industry_median", mode: "diff" as const },
  {
    base: "mid_cycle_ev_ebitda",
    vsPeer: "mid_cycle_ev_ebitda_vs_peer",
    vsIndustry: "mid_cycle_ev_ebitda_vs_industry",
    mode: "ratio" as const,
  },
  {
    base: "revenue_yield",
    vsPeer: "revenue_yield_vs_peer",
    vsIndustry: "revenue_yield_vs_industry",
    mode: "ratio" as const,
  },
] as const;

// 行业相对值只在同市场、同代理行业内取中位数，避免跨市场估值混比。
export function applyIndustryBenchmarks(records: SecurityRecord[]): SecurityRecord[] {
  const groups = new Map<string, SecurityRecord[]>();

  for (const record of records) {
    const key = industryGroupKey(record);
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const mediansBySpec = VS_INDUSTRY_SPECS.map((spec) => {
    const medians = new Map<string, number>();
    for (const [key, group] of groups) {
      medians.set(key, median(metricValues(group, spec.base)));
    }
    return { spec, medians };
  });

  return records.map((record) => {
    const key = industryGroupKey(record);
    const metrics = { ...record.metrics };
    let changed = false;

    for (const { spec, medians } of mediansBySpec) {
      const value = record.metrics[spec.base]?.value;
      const med = medians.get(key);
      if (value === undefined || med === undefined) continue;
      if ("requirePositiveMedian" in spec && spec.requirePositiveMedian && med <= 0) continue;

      if (spec.mode === "diff" && "vs" in spec) {
        metrics[spec.vs] = {
          value: value - med,
          dataConfidence: "medium" as const,
        };
        changed = true;
        continue;
      }

      if (spec.mode === "ratio" && med > 0) {
        const ratio = value / med;
        metrics[spec.vsPeer] = { value: ratio, dataConfidence: "medium" as const };
        metrics[spec.vsIndustry] = { value: ratio, dataConfidence: "medium" as const };
        changed = true;
      }
    }

    return changed ? { ...record, metrics } : record;
  });
}

// quote history 跨季度累积，用于相对自身历史估值和旧缓存回放。
export const CN_QUOTE_HISTORY_SCHEMA = "eastmoney_f115_f23_v2" as const;

export interface QuoteHistoryEntry {
  quarter: string;
  pe?: number;
  pb?: number;
  ps?: number;
  asOf: string;
}

export interface EnrichCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
  dividendYield?: number;
  dividendYieldConfidence?: DataConfidence;
  quoteHistory?: QuoteHistoryEntry[];
  quoteHistorySchema?: typeof CN_QUOTE_HISTORY_SCHEMA;
}

export type DividendWithConfidence = { yield: number; dataConfidence: DataConfidence };

export type DividendEnrichment = number | DividendWithConfidence;

const QUOTE_HISTORY_CAP = 20;

function normalizeDividend(dividend: DividendEnrichment): {
  value: number;
  dataConfidence: DataConfidence;
} {
  if (typeof dividend === "number") {
    return { value: dividend, dataConfidence: "medium" };
  }
  return { value: dividend.yield, dataConfidence: dividend.dataConfidence };
}

function latestFcfFromRows(rows: AnnualFinancialRow[]): number | undefined {
  const latest = [...rows].sort((a, b) => a.year - b.year).at(-1);
  if (!latest) return undefined;
  const capex = latest.capex !== undefined ? Math.abs(latest.capex) : 0;
  return latest.operatingCashFlow - capex;
}

function quoteNumeric(record: SecurityRecord, key: string): number | undefined {
  const value = record.metrics[key]?.value;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function quoteMedian(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function deriveVs5yMedian(
  current: number | undefined,
  history: QuoteHistoryEntry[],
  pick: (entry: QuoteHistoryEntry) => number | undefined,
): MetricValue | undefined {
  const values = history.map(pick).filter((v): v is number => v !== undefined && v > 0);
  if (current === undefined || current <= 0 || values.length === 0) return undefined;
  const med = quoteMedian(values);
  if (med <= 0) return undefined;
  return { value: current / med, dataConfidence: "medium" };
}

function appendQuoteHistory(
  history: QuoteHistoryEntry[] | undefined,
  entry: QuoteHistoryEntry,
): QuoteHistoryEntry[] {
  const next = [...(history ?? []), entry];
  return next.length > QUOTE_HISTORY_CAP ? next.slice(-QUOTE_HISTORY_CAP) : next;
}

export function updatedQuoteHistory(
  history: QuoteHistoryEntry[] | undefined,
  quarter: string,
  pe?: number,
  pb?: number,
  ps?: number,
): QuoteHistoryEntry[] | undefined {
  const prior = history ?? [];
  const withoutCurrent = prior.filter((entry) => entry.quarter !== quarter);
  if (pe === undefined && pb === undefined && ps === undefined) {
    return withoutCurrent.length === prior.length ? history : withoutCurrent;
  }
  return appendQuoteHistory(withoutCurrent, {
    quarter,
    pe,
    pb,
    ps,
    asOf: new Date().toISOString(),
  });
}

export function buildDeriveContext(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[],
): Parameters<typeof deriveFromAnnualRows>[1] {
  const trailingPe = quoteNumeric(record, "pe_ttm");
  const priceToBook = quoteNumeric(record, "pb");
  const price = quoteNumeric(record, "price");
  const high52Week = quoteNumeric(record, "high_52w");

  let priceVsHigh = quoteNumeric(record, "price_vs_52w_high");
  if (
    priceVsHigh === undefined &&
    price !== undefined &&
    high52Week !== undefined &&
    high52Week > 0
  ) {
    priceVsHigh = price / high52Week;
  }

  return {
    marketCap: record.marketCap,
    currency: record.currency,
    trailingPe,
    priceToBook,
    fcf: latestFcfFromRows(annualRows),
    price,
    high52Week:
      high52Week ??
      (price !== undefined && priceVsHigh !== undefined && priceVsHigh > 0
        ? price / priceVsHigh
        : undefined),
  };
}

export function mergeEnrichment(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[],
  industryProxy?: string,
  dividend?: DividendEnrichment,
  opts?: { quarter?: string; quoteHistory?: QuoteHistoryEntry[] },
): SecurityRecord {
  if (annualRows.length === 0 && dividend === undefined) return record;

  const derived =
    annualRows.length > 0
      ? deriveFromAnnualRows(annualRows, buildDeriveContext(record, annualRows))
      : null;

  const { metrics: derivedMetrics = {}, ...derivedFields } = derived ?? {
    metrics: {},
    revenueYoyHistory: record.revenueYoyHistory,
    ocfNegativeYears: record.ocfNegativeYears,
    netLossWidening: record.netLossWidening,
    latestFinancialMonthsOld: record.latestFinancialMonthsOld,
  };

  const metrics = { ...record.metrics, ...derivedMetrics };
  if (dividend !== undefined) {
    metrics.dividend_yield = normalizeDividend(dividend);
  }

  const currentPe = metrics.pe_ttm?.value;
  const currentPb = metrics.pb?.value;
  const currentPs = metrics.ps?.value;
  const history = opts?.quoteHistory ?? [];
  const peVs5y = deriveVs5yMedian(currentPe, history, (e) => e.pe);
  const pbVs5y = deriveVs5yMedian(currentPb, history, (e) => e.pb);
  const psVs5y = deriveVs5yMedian(currentPs, history, (e) => e.ps);
  if (peVs5y) metrics.pe_vs_5y_median = peVs5y;
  if (pbVs5y) metrics.pb_vs_5y_median = pbVs5y;
  if (psVs5y) metrics.ps_vs_5y_median = psVs5y;

  const midPe = metrics.mid_cycle_pe?.value;
  if (midPe !== undefined && midPe > 0 && history.length >= 2) {
    const histPe = history.map((e) => e.pe).filter((v): v is number => v !== undefined && v > 0);
    if (histPe.length >= 2) {
      const med = quoteMedian(histPe);
      if (med > 0) {
        metrics.mid_cycle_pe_vs_10y_median = { value: midPe / med, dataConfidence: "medium" };
      }
    }
  }

  return {
    ...record,
    ...derivedFields,
    industryProxy: industryProxy ?? record.industryProxy,
    metrics,
  };
}

function stubReplayRecord(
  ticker: string,
  market: SecurityRecord["market"],
  industryProxy?: string,
): SecurityRecord {
  return {
    ticker,
    market,
    companyName: ticker,
    currency: market === "CN" ? "CNY" : "USD",
    status: "active",
    marketCap: 50_000_000_000,
    listingAgeYears: 10,
    industryProxy,
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 6,
  };
}

function quoteMetricsFromHistory(
  payload: EnrichCachePayload,
  baseMetrics: SecurityRecord["metrics"],
  market: SecurityRecord["market"],
): SecurityRecord["metrics"] {
  // CN 旧归档只有声明过 East Money schema 时才可安全恢复估值字段。
  if (market === "CN" && payload.quoteHistorySchema !== CN_QUOTE_HISTORY_SCHEMA) {
    return {};
  }

  const latest = payload.quoteHistory?.at(-1);
  if (!latest) return {};

  const raw: SecurityRecord["metrics"] = {};
  if (latest.pe !== undefined && latest.pe > 0) {
    raw.pe_ttm = { value: latest.pe, dataConfidence: "medium" };
  }
  if (latest.pb !== undefined && latest.pb > 0) {
    raw.pb = { value: latest.pb, dataConfidence: "medium" };
  }
  if (latest.ps !== undefined && latest.ps > 0) {
    raw.ps = { value: latest.ps, dataConfidence: "medium" };
  }

  if (market === "CN") {
    return sanitizeCnQuoteMetrics({ ...baseMetrics, ...raw }).metrics;
  }
  return raw;
}

export function enrichRecordFromCachePayload(
  record: SecurityRecord,
  payload: EnrichCachePayload,
  quarter: string,
): SecurityRecord {
  const dividend: DividendWithConfidence | undefined =
    payload.dividendYield !== undefined
      ? {
          yield: payload.dividendYield,
          dataConfidence: payload.dividendYieldConfidence ?? "medium",
        }
      : undefined;

  return mergeEnrichment(
    {
      ...record,
      industryProxy: payload.industryProxy ?? record.industryProxy,
      metrics: {
        ...record.metrics,
        ...quoteMetricsFromHistory(payload, record.metrics, record.market),
      },
    },
    payload.annualRows ?? [],
    payload.industryProxy,
    dividend,
    { quarter, quoteHistory: payload.quoteHistory },
  );
}

export function loadEnrichedUniverseFromCache(opts: {
  cacheDir: string;
  quarter: string;
  market: SecurityRecord["market"];
}): SecurityRecord[] {
  const marketDir = path.join(opts.cacheDir, opts.quarter, opts.market);
  if (!fs.existsSync(marketDir)) return [];

  const records: SecurityRecord[] = [];
  for (const file of fs.readdirSync(marketDir)) {
    if (!file.endsWith(".json")) continue;
    const ticker = file.replace(/\.json$/, "");
    const payload = JSON.parse(
      fs.readFileSync(path.join(marketDir, file), "utf8"),
    ) as EnrichCachePayload;
    records.push(
      enrichRecordFromCachePayload(
        stubReplayRecord(ticker, opts.market, payload.industryProxy),
        payload,
        opts.quarter,
      ),
    );
  }
  return records;
}
