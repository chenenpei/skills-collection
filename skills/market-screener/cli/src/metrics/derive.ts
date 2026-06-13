import type { SecurityRecord } from "../engine/kill-gates.js";
import type { MetricValue } from "../engine/types.js";

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

function debtToEquityFromAlr(alr: number): number {
  if (alr <= 0 || alr >= 1) return 0;
  return alr / (1 - alr);
}

function netDebtToEbitdaProxy(row: AnnualFinancialRow): number {
  const ebitda = row.operatingProfit ?? row.grossProfit * 0.7;
  if (ebitda <= 0) return 99;
  const debtProxy = row.revenue * row.assetLiabilityRatio;
  return Math.max(0, (debtProxy - row.operatingCashFlow * 0.1) / ebitda);
}

function operatingMargin(row: AnnualFinancialRow): number {
  if (row.revenue <= 0) return 0;
  if (row.operatingProfit !== undefined && row.operatingProfit > 0) {
    return row.operatingProfit / row.revenue;
  }
  // Proxy when operating profit is unavailable (see spec/conventions.yaml).
  return (row.grossProfit / row.revenue) * 0.35;
}

export interface DeriveContext {
  marketCap: number;
  currency: string;
  priceToBook?: number;
  trailingPe?: number;
  fcf?: number;
}

export function deriveFromAnnualRows(
  rows: AnnualFinancialRow[],
  ctx: DeriveContext
): Pick<
  SecurityRecord,
  "metrics" | "revenueYoyHistory" | "ocfNegativeYears" | "netLossWidening" | "latestFinancialMonthsOld"
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
  const fcfYield =
    ctx.marketCap > 0 && ctx.fcf !== undefined ? ctx.fcf / ctx.marketCap : undefined;

  const metrics: Record<string, MetricValue> = {
    revenue: mv(latest.revenue),
    net_income: mv(latest.netIncome),
    operating_cash_flow: mv(latest.operatingCashFlow),
    roe_ttm: mv(latest.roe),
    roe_5y_avg: mv(avg(roes)),
    gross_margin: mv(grossMargin),
    operating_margin: mv(opMargin),
    gross_margin_3y_max_decline_pp: mv(computeGrossMarginMaxDeclinePp(grossMargins)),
    fcf_conversion_5y: mv(avg(fcfConversions.length ? fcfConversions : [0])),
    net_debt_to_ebitda: mv(netDebtToEbitdaProxy(latest)),
    debt_to_equity: mv(debtToEquityFromAlr(latest.assetLiabilityRatio)),
    revenue_3y_cagr: mv(
      sorted.length >= 4
        ? cagr(sorted[sorted.length - 4].revenue, latest.revenue, 3)
        : cagr(sorted[0].revenue, latest.revenue, Math.max(1, sorted.length - 1))
    ),
    roic_5y_avg: mv(avg(roes) * 0.85),
  };

  if (fcfYield !== undefined) metrics.fcf_yield = mv(fcfYield);
  if (ctx.trailingPe !== undefined && ctx.priceToBook !== undefined) {
    metrics.graham_composite = mv(ctx.trailingPe * ctx.priceToBook);
  }

  return {
    metrics,
    revenueYoyHistory,
    ocfNegativeYears,
    netLossWidening,
    latestFinancialMonthsOld: 6,
  };
}
