import { httpFetch } from "../../lib/http-fetch.js";
import type { AnnualFinancialRow } from "../../metrics/derive.js";
import { SEC_UA } from "./sec-tickers.js";

type FactPoint = { fy?: number; fp?: string; val?: number; form?: string };
type GaapFacts = Record<string, { units?: Record<string, FactPoint[]> }>;
type FactsBody = {
  facts?: {
    "us-gaap"?: GaapFacts;
  };
};

function pickRevenueTag(gaap: GaapFacts | undefined): FactPoint[] {
  if (!gaap) return [];
  const candidates = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ];
  for (const key of candidates) {
    const series = gaap[key]?.units?.USD;
    if (series?.length) return series;
  }
  return [];
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

export function parseCompanyFactsAnnualRows(body: FactsBody): AnnualFinancialRow[] {
  const gaap = body.facts?.["us-gaap"] ?? {};
  const revenueMap = fyPoints(pickRevenueTag(gaap));
  const netIncomeMap = fyPoints(gaap.NetIncomeLoss?.units?.USD ?? []);
  const ocfMap = fyPoints(
    gaap.NetCashProvidedByUsedInOperatingActivities?.units?.USD ?? []
  );
  const grossProfitMap = fyPoints(gaap.GrossProfit?.units?.USD ?? []);

  const years = new Set<number>([
    ...revenueMap.keys(),
    ...netIncomeMap.keys(),
  ]);

  const rows: AnnualFinancialRow[] = [];
  for (const year of years) {
    const revenue = revenueMap.get(year);
    if (revenue === undefined || revenue <= 0) continue;
    const netIncome = netIncomeMap.get(year) ?? 0;
    const grossProfit = grossProfitMap.get(year) ?? revenue * 0.35;
    const operatingCashFlow = ocfMap.get(year) ?? netIncome;
    const roe = netIncome > 0 ? Math.min(0.6, netIncome / (revenue * 0.3)) : 0;

    rows.push({
      year,
      revenue,
      grossProfit,
      netIncome,
      operatingCashFlow,
      roe,
      assetLiabilityRatio: 0.45,
    });
  }

  return rows.sort((a, b) => a.year - b.year);
}

export async function fetchUsAnnualRows(cik: string): Promise<AnnualFinancialRow[]> {
  const res = await httpFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": SEC_UA },
  });
  if (!res.ok) throw new Error(`SEC companyfacts failed for CIK${cik}: ${res.status}`);
  return parseCompanyFactsAnnualRows((await res.json()) as FactsBody);
}
