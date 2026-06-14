import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { MetricValue } from "../funnel/types.js";

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
const PE_HISTORY_YEARS = 10;
/** Consumer/healthcare mispricing supporting floor (fcf_yield_vs_risk_free min 0.04). */
const RISK_FREE_RATE = 0.04;

function ebitdaForRow(row: AnnualFinancialRow): number {
  return row.operatingProfit ?? row.grossProfit * 0.7;
}

function netDebtProxy(row: AnnualFinancialRow): number {
  const debt = row.revenue * row.assetLiabilityRatio;
  const cash = row.operatingCashFlow * 0.1;
  return Math.max(0, debt - cash);
}

function evEbitdaForRow(row: AnnualFinancialRow, marketCap: number): number | undefined {
  const ebitda = ebitdaForRow(row);
  if (ebitda <= 0 || marketCap <= 0) return undefined;
  return (marketCap + netDebtProxy(row)) / ebitda;
}

function roicProxyFromRoe(roe: number): number {
  return roe * 0.85;
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
    true
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
  const midCycleOpMargin = midCycleAverage(last7.map((r) => operatingMargin(r)));
  if (midCycleOpMargin !== undefined) {
    metrics.mid_cycle_operating_margin = mv(midCycleOpMargin);
  }

  const midCycleEbitda = midCycleAverage(last7.map((r) => ebitdaForRow(r)));
  if (midCycleEbitda !== undefined && midCycleEbitda > 0) {
    metrics.mid_cycle_ebitda = mv(midCycleEbitda);
    if (ctx.marketCap > 0) {
      metrics.mid_cycle_ev_ebitda = mv((ctx.marketCap + netDebtProxy(latest)) / midCycleEbitda);
    }
  }

  const peHistory = sorted
    .slice(-PE_HISTORY_YEARS)
    .map((r) => (r.netIncome > 0 && ctx.marketCap > 0 ? ctx.marketCap / r.netIncome : undefined))
    .filter((v): v is number => v !== undefined && v > 0);
  if (metrics.mid_cycle_pe?.value !== undefined && peHistory.length >= 2) {
    const peMed = median(peHistory);
    if (peMed > 0) {
      metrics.mid_cycle_pe_vs_10y_median = mv(metrics.mid_cycle_pe.value / peMed);
    }
  }

  const evHistory = sorted
    .slice(-PE_HISTORY_YEARS)
    .map((r) => evEbitdaForRow(r, ctx.marketCap))
    .filter((v): v is number => v !== undefined && v > 0);
  const currentEvEbitda = evEbitdaForRow(latest, ctx.marketCap);
  if (currentEvEbitda !== undefined && evHistory.length >= 2) {
    const evMed = median(evHistory);
    if (evMed > 0) {
      metrics.ev_ebitda_vs_5y_median = mv(currentEvEbitda / evMed);
    }
  }

  const marginHistory = sorted.slice(-MID_CYCLE_WINDOW_YEARS).map((r) => operatingMargin(r));
  if (marginHistory.length >= 2) {
    const marginMedian = median(marginHistory);
    metrics.operating_margin_vs_10y_median = mv(opMargin - marginMedian);
  }

  if (sorted.length >= 11) {
    metrics.revenue_10y_cagr = mv(
      cagr(sorted[sorted.length - 11].revenue, latest.revenue, 10)
    );
  } else if (sorted.length >= 2) {
    metrics.revenue_10y_cagr = mv(
      cagr(sorted[0].revenue, latest.revenue, Math.max(1, sorted.length - 1))
    );
  }

  const roe3y = sorted.slice(-3).map((r) => r.roe);
  if (roe3y.length > 0) metrics.roe_3y_avg = mv(avg(roe3y));

  const latestRevenueYoy = revenueYoyHistory[revenueYoyHistory.length - 1];
  if (latestRevenueYoy !== undefined) {
    metrics.revenue_yoy = mv(latestRevenueYoy);
    metrics.revenue_growth_yoy = mv(latestRevenueYoy);
  }

  const latestFcf = ctx.fcf ?? fcfForRow(latest);
  const fcfMargin = latest.revenue > 0 ? latestFcf / latest.revenue : 0;
  if (latest.revenue > 0) metrics.fcf_margin = mv(fcfMargin);
  metrics.rule_of_40 = mv(((latestRevenueYoy ?? 0) + fcfMargin) * 100);

  metrics.roic_ttm = mv(roicProxyFromRoe(latest.roe));
  metrics.roic = metrics.roic_ttm;
  if (metrics.debt_to_equity) {
    metrics.net_debt_to_equity = metrics.debt_to_equity;
  }
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
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function industryGroupKey(record: SecurityRecord): string {
  return `${record.market}::${record.industryProxy ?? "unknown"}`;
}

function metricValues(group: SecurityRecord[], key: string): number[] {
  return group
    .map((r) => r.metrics[key]?.value)
    .filter((v): v is number => v !== undefined);
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
  { base: "pe_ttm", vsPeer: "pe_ttm_vs_peer_median", vsIndustry: "pe_ttm_vs_industry_median", mode: "ratio" as const },
  { base: "pb", vsPeer: "pb_vs_peer_median", vsIndustry: "pb_vs_industry_median", mode: "ratio" as const },
  { base: "ps", vsPeer: "ps_vs_peer_median", vsIndustry: "ps_vs_industry_median", mode: "ratio" as const },
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
