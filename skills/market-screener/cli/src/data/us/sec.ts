import { httpFetch } from "../../lib/http-fetch.js";

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

import { withHostLimit } from "../../lib/host-limit.js";

const SEC_HOST = "data.sec.gov";
/** SEC fair-access guidance: stay near ~10 req/s; 4 concurrent is conservative. */
const SEC_MAX_CONCURRENT = 4;

export async function secFetch(path: string): Promise<Response> {
  return withHostLimit(SEC_HOST, SEC_MAX_CONCURRENT, () =>
    httpFetch(`https://${SEC_HOST}${path}`, {
      headers: { "User-Agent": SEC_UA },
    })
  );
}


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

import type { AnnualFinancialRow } from "../metrics.js";

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
  year: number
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
  }
): number | undefined {
  const { operatingProfit, taxRate, totalEquity, longTermDebt, shortTermDebt, monetaryFunds } = ctx;
  if (operatingProfit === undefined || operatingProfit <= 0 || totalEquity === undefined || totalEquity <= 0) {
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
    ])
  );
  const ocfMap = fyPoints(
    gaap.NetCashProvidedByUsedInOperatingActivities?.units?.USD ?? []
  );
  const grossProfitMap = fyPoints(gaap.GrossProfit?.units?.USD ?? []);
  const cogsMap = fyPoints(
    pickGaapSeries(gaap, ["CostOfRevenue", "CostOfGoodsAndServicesSold"])
  );
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
    const averageEquity =
      prevEquity !== undefined ? (prevEquity + totalEquity) / 2 : totalEquity;
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
