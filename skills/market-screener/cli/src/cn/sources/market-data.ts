/**
 * CN 市场与报表适配：输出带来源、期间和截止日约束的原始事实。
 * 数值观察不自行证明会计范围、监管适用性或跨期可比性；这些资格由后续模型判断。
 */
import {
  ordinaryReturnContextSchema,
  shareStructureSchema,
  type FinancialFact,
  type SecurityRecord,
} from "../../shared/financial-model.js";

export const EASTMONEY_F10_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://emweb.securities.eastmoney.com/",
};
type RawRow = Record<string, string | number | null | undefined>;

/** 同一累计报告接口；金额已按非金融代表样本对照披露核验，不使用每股值反推。 */
export function cnRecentFinancialsUrl(ticker: string, exchange: string, asOf: string): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const quarterEnd = month <= 3 ? `${year - 1}-12-31` : month <= 6 ? `${year}-03-31` :
    month <= 9 ? `${year}-06-30` : `${year}-09-30`;
  return "https://datacenter-web.eastmoney.com/api/data/v1/get?" + new URLSearchParams({
    reportName: "RPT_F10_FINANCE_MAINFINADATA", columns: "ALL",
    filter: `(SECUCODE="${ticker}.${exchange}")(REPORT_DATE>='${year - 2}-01-01')(REPORT_DATE<='${quarterEnd}')`,
    pageSize: "20", pageNumber: "1", sortTypes: "-1", sortColumns: "REPORT_DATE",
  });
}

/** 使用 recent.* 隔离辅助事实；不得成为年度财务事实或行业路由的证据。 */
export function parseCnRecentFinancialFacts(
  body: unknown,
  options: { sourceId: string; entity: string; basis: string },
): FinancialFact[] {
  const root = body as { result?: { data?: RawRow[]; pages?: number }; success?: boolean };
  const rows = root?.result?.data;
  if (root?.success === false || !Array.isArray(rows) || !rows.length || (root.result?.pages ?? 1) > 1)
    throw new Error("recent_financials_invalid_or_incomplete_response");
  const fields = {
    period: "REPORT_DATE", revenue: "TOTALOPERATEREVE", parentProfit: "PARENTNETPROFIT",
    adjustedParentProfit: "KCFJCXSYJLR", operatingCashFlow: "NETCASH_OPERATE_PK",
  };
  const facts: FinancialFact[] = [];
  for (const [i, row] of rows.entries()) {
    if (row.SECURITY_CODE !== options.entity || row.ORG_TYPE !== "通用")
      throw new Error("recent_financials_entity_or_statement_family_mismatch");
    const end = String(row.REPORT_DATE ?? "").slice(0, 10);
    const label = ({ "03-31": "一季报", "06-30": "中报", "09-30": "三季报", "12-31": "年报" } as Record<string, string>)[end.slice(5)];
    const dates = [row.NOTICE_DATE, row.UPDATE_DATE].map(v => String(v ?? "").slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !label || row.REPORT_TYPE !== label ||
      dates.some(v => !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))) ||
      typeof row.CURRENCY !== "string") throw new Error("recent_financials_period_or_metadata_missing");
    const year = Number(end.slice(0, 4)), publishedAt = dates.sort().at(-1)!;
    for (const [field, key] of Object.entries(fields)) {
      const raw = row[key] ?? null, marker = field === "period";
      const value = marker ? end : typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
      const currencyMatches = row.CURRENCY === "CNY";
      facts.push({
        id: `${options.sourceId}:${i}:recent.${field}`, field: `recent.${field}`,
        entity: options.entity, year, period: { start: `${year}-01-01`, end }, publishedAt,
        basis: options.basis, unit: marker ? "date" : String(row.CURRENCY),
        state: !currencyMatches ? "conflicting" : value === undefined ? "missing" : "observed",
        ...(currencyMatches && value !== undefined ? { value } : {}),
        evidence: [{ sourceId: options.sourceId, locator: `/result/data/${i}/${key}`, raw }],
        ...(!currencyMatches ? { reason: "recent_currency_mismatch" } :
          value === undefined ? { reason: "recent_amount_missing" } : {}),
      });
    }
  }
  return facts;
}

function isAnnualReportDate(reportDate: string): boolean {
  return String(reportDate).slice(0, 10).endsWith("-12-31");
}

function parseAnnualReportDateYear(reportDate: string): number {
  return Number(String(reportDate).slice(0, 4));
}
// 年报口径、公告日和币种必须同时成立，才把提供商字段变成可用观察。
export function parseCnStatementFacts(
  body: unknown,
  options: {
    sourceId: string;
    entity: string;
    basis: string;
    kind: "income" | "balance" | "cashflow" | "indicators";
    sourceUrl?: string;
  },
): import("../../shared/financial-model.js").FinancialFact[] {
  const root = body as { data?: RawRow[]; result?: { data?: RawRow[] } };
  const rows = root?.data ?? root?.result?.data;
  if (!Array.isArray(rows) || !rows.length)
    throw new Error(`Invalid/empty financial response: ${options.sourceId}`);
  const prefix = root.data ? "/data" : "/result/data";
  const mappings: Record<typeof options.kind, Array<[string, string, string?, number?]>> = {
    income: [
      ["parentProfit", "PARENT_NETPROFIT"],
      ["netProfit", "NETPROFIT"],
      ["reportedAdjustedParentProfit", "DEDUCT_PARENT_NETPROFIT"],
      ["revenue", "OPERATE_INCOME"],
      ["cost", "OPERATE_COST"],
      ["businessTax", "OPERATE_TAX_ADD"],
      ["sellingExpense", "SALE_EXPENSE"],
      ["adminExpense", "MANAGE_EXPENSE"],
      ["researchExpense", "RESEARCH_EXPENSE"],
      ["assetImpairment", "ASSET_IMPAIRMENT_INCOME"],
      ["creditImpairment", "CREDIT_IMPAIRMENT_INCOME"],
      ["interestExpense", "FE_INTEREST_EXPENSE"],
      ["profitBeforeTax", "TOTAL_PROFIT"],
    ],
    balance: [
      ["equity", "TOTAL_EQUITY"],
      ["parentEquity", "TOTAL_PARENT_EQUITY"],
      ["minorityEquity", "MINORITY_EQUITY"],
      ["nonordinaryEquity", "OTHER_EQUITY_TOOL"],
      ["preferredEquity", "PREFERRED_SHARES"],
      ["perpetualEquity", "PERPETUAL_BOND"],
      ["assets", "TOTAL_ASSETS"],
      ["currentAssets", "TOTAL_CURRENT_ASSETS"],
      ["liabilities", "TOTAL_LIABILITIES"],
      ["monetaryFunds", "MONETARYFUNDS"],
      ["shortBorrowings", "SHORT_LOAN"],
      ["longBorrowings", "LONG_LOAN"],
      ["leaseLiabilities", "LEASE_LIAB"],
      ["currentNoncurrentLiabilities", "NONCURRENT_LIAB_1YEAR"],
      ["shortBondsPayable", "SHORT_BOND_PAYABLE"],
      ["notesPayable", "NOTE_PAYABLE"],
      ["bondsPayable", "BOND_PAYABLE"],
      ["longPayables", "LONG_PAYABLE"],
      ["otherCurrentLiabilities", "OTHER_CURRENT_LIAB"],
      ["otherNoncurrentLiabilities", "OTHER_NONCURRENT_LIAB"],
      ["otherPayables", "TOTAL_OTHER_PAYABLE"],
    ],
    cashflow: [
      ["operatingCashFlow", "NETCASH_OPERATE"],
      ["capex", "CONSTRUCT_LONG_ASSET"],
    ],
    // The ordinary CAS EPS contract is validated for the indicator fields,
    // not inferred from a similarly named income or diluted EPS column.
    indicators: [
      ["casOrdinaryBasicEps", "EPSJB", "currency/share"],
      // Annual ordinary book value per share, not TOTAL_SHARE (a current snapshot).
      ["reportedOrdinaryBps", "BPS", "currency/share"],
      ["casAdjustedOrdinaryBasicEps", "EPSKCJB", "currency/share"],
      ["weightedRoe", "ROEJQ", "ratio", 0.01],
      ["adjustedWeightedRoe", "ROEKCJQ", "ratio", 0.01],
      ["parentProfit", "PARENTNETPROFIT"],
      ["reportedAdjustedParentProfit", "KCFJCXSYJLR"],
    ],
  };
  const facts: FinancialFact[] = [];
  for (const [i, row] of rows.entries()) {
    const reportDate = String(row.REPORT_DATE ?? "").slice(0, 10);
    if (!isAnnualReportDate(reportDate) || row.REPORT_TYPE !== "年报") continue;
    if (String(row.SECURITY_CODE ?? "") !== options.entity)
      throw new Error("Statement entity mismatch");
    const year = parseAnnualReportDateYear(reportDate);
    const dates = [row.NOTICE_DATE, row.UPDATE_DATE]
      .filter((v) => typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v))
      .map((v) => String(v).slice(0, 10));
    if (!dates.length || typeof row.CURRENCY !== "string")
      throw new Error("Statement missing publication date or currency");
    const publishedAt = dates.sort().at(-1)!;
    const firstPublishedAt =
      typeof row.NOTICE_DATE === "string" && /^\d{4}-\d\d-\d\d/.test(row.NOTICE_DATE)
        ? row.NOTICE_DATE.slice(0, 10)
        : publishedAt;
    facts.push({
      id: `${options.sourceId}:${i}:annual-report`,
      field: "annualReportYear",
      entity: options.entity,
      year,
      period: { start: `${year}-01-01`, end: reportDate },
      publishedAt: firstPublishedAt,
      basis: options.basis,
      unit: "year",
      state: "observed",
      value: year,
      evidence: [
        { sourceId: options.sourceId, locator: `${prefix}/${i}/REPORT_DATE`, raw: row.REPORT_DATE },
      ],
      reason: "identified_complete_annual_report",
    });
    if (typeof row.ORG_TYPE === "string" && row.ORG_TYPE.trim())
      facts.push({
        id: `${options.sourceId}:${i}:ORG_TYPE`,
        field: "statementFamily",
        entity: options.entity,
        year,
        period: { start: `${year}-01-01`, end: reportDate },
        publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: row.ORG_TYPE,
        evidence: [
          { sourceId: options.sourceId, locator: `${prefix}/${i}/ORG_TYPE`, raw: row.ORG_TYPE },
        ],
      });
    // This provider's annual balance row is the common consolidated statement
    // contract for TOTAL_* amounts. Keep the row binding explicit so a total
    // liability can only be used as a conservative debt bound with its peer.
    const consolidatedUrl = (() => {
      try {
        const u = new URL(options.sourceUrl ?? "");
        return (
          u.hostname === "emweb.securities.eastmoney.com" &&
          u.pathname === "/PC_HSF10/NewFinanceAnalysis/zcfzbAjaxNew" &&
          u.searchParams.get("companyType") === "4" &&
          u.searchParams.get("reportDateType") === "0" &&
          u.searchParams.get("reportType") === "1" &&
          u.searchParams.get("code")?.endsWith(options.entity) === true
        );
      } catch {
        return false;
      }
    })();
    if (options.kind === "balance" && consolidatedUrl && row.ORG_TYPE === "通用")
      facts.push({
        id: `${options.sourceId}:${i}:balance.consolidatedContext`,
        field: "balance.consolidatedContext",
        entity: options.entity,
        year,
        period: { start: reportDate, end: reportDate },
        publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify({
          contract: "eastmoney_annual_consolidated_balance_v1",
          row: `${prefix}/${i}`,
        }),
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `${prefix}/${i}/REPORT_DATE`,
            raw: row.REPORT_DATE,
          },
        ],
        reason: "eastmoney_annual_consolidated_balance_row",
      });
    const returns: Partial<Record<"weightedRoe" | "adjustedWeightedRoe", FinancialFact>> = {};
    for (const [field, column, unit, scale = 1] of mappings[options.kind]) {
      const raw = row[column];
      const numeric =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && /^[-+]?\d+(\.\d+)?$/.test(raw.trim())
            ? Number(raw)
            : undefined;
      const valid = numeric !== undefined && Number.isFinite(numeric);
      const fact: FinancialFact = {
        id: `${options.sourceId}:${i}:${column}`,
        field,
        entity: options.entity,
        year,
        period: {
          start:
            options.kind === "balance" || field === "reportedOrdinaryBps"
              ? reportDate
              : `${year}-01-01`,
          end: reportDate,
        },
        publishedAt,
        basis: options.basis,
        unit: unit === "currency/share" ? `${row.CURRENCY}/share` : (unit ?? row.CURRENCY),
        state: valid ? "observed" : "missing",
        ...(valid ? { value: numeric! * scale } : { reason: "source_field_missing" }),
        unitScale: scale,
        evidence:
          raw === undefined
            ? []
            : [{ sourceId: options.sourceId, locator: `${prefix}/${i}/${column}`, raw }],
      };
      facts.push(fact);
      if (field === "weightedRoe" || field === "adjustedWeightedRoe") returns[field] = fact;
    }
    // Validated against representative annual disclosures. These are reported
    // issuer indicators; the provider does not identify an applicable capital
    // regime or establish that historical periods are comparable.
    const reportedColumns: ReadonlyArray<readonly [string, string]> =
      row.ORG_TYPE === "银行"
        ? [
            ["totalCapital", "NEWCAPITALADER"],
            ["cet1", "HXYJBCZL"],
            ["loanNpl", "NONPERLOAN"],
            ["loanProvisionCoverage", "BLDKBBL"],
          ]
        : row.ORG_TYPE === "证券"
          ? [
              ["riskCoverage", "RISK_COVERAGE"],
              ["capitalLeverage", "CAPITAL_LEVERAGE_RATIO"],
              ["lcr", "LIQUIDITY_COVERAGE_RATIO"],
              ["nsfr", "NET_FUNDING_RATIO"],
            ]
          : [];
    if (options.kind === "indicators") {
      for (const [metric, column] of reportedColumns) {
        // CET1's distinction from the legacy "core capital" label was verified
        // for the current three-year window; do not silently backdate it.
        if (metric === "cet1" && year < 2023) continue;
        const raw = row[column];
        const numeric =
          typeof raw === "number"
            ? raw
            : typeof raw === "string" && /^[-+]?\d+(\.\d+)?$/.test(raw.trim())
              ? Number(raw)
              : undefined;
        const valid = numeric !== undefined && Number.isFinite(numeric);
        facts.push({
          id: `${options.sourceId}:${i}:${column}`,
          field: `reportedFinancial.${metric}`,
          entity: options.entity,
          year,
          period: { start: reportDate, end: reportDate },
          publishedAt,
          basis: options.basis,
          unit: "ratio",
          state: valid ? "observed" : "missing",
          ...(valid ? { value: numeric! * 0.01 } : {}),
          unitScale: 0.01,
          evidence:
            raw === undefined
              ? []
              : [{ sourceId: options.sourceId, locator: `${prefix}/${i}/${column}`, raw }],
          reason: valid ? "eastmoney_reported_indicator" : "source_field_missing",
        });
      }
    }
    const weightedRoe = returns.weightedRoe,
      adjustedWeightedRoe = returns.adjustedWeightedRoe;
    if (
      options.kind === "indicators" &&
      weightedRoe?.state === "observed" &&
      adjustedWeightedRoe?.state === "observed"
    ) {
      const context = ordinaryReturnContextSchema.parse({
        accountingStandard: "CAS",
        shareholderScope: "ordinary",
        reportYear: year,
        weightedRoeFactId: weightedRoe.id,
        adjustedWeightedRoeFactId: adjustedWeightedRoe.id,
      });
      facts.push({
        id: `${options.sourceId}:${i}:earnings.returnContext`,
        field: "earnings.returnContext",
        entity: options.entity,
        year,
        period: { start: `${year}-01-01`, end: reportDate },
        publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify(context),
        evidence: [...weightedRoe.evidence, ...adjustedWeightedRoe.evidence],
        reason: "eastmoney_indicator_roe_fields_validated_against_representative_annual_samples",
      });
    }
  }
  return facts;
}

const PE_PRICE_TOLERANCE = 0.01;
const PB_CEILING = 15;
export interface SanitizeCnQuoteResult {
  metrics: SecurityRecord["metrics"];
  warnings: string[];
}

// 行情值只在指定会话和截点内有效，避免把盘后或未来观察回填到历史筛选。
export function sanitizeCnQuoteMetrics(metrics: SecurityRecord["metrics"]): SanitizeCnQuoteResult {
  const price = metrics.price?.value;
  const pe = metrics.pe_ttm?.value;
  const pb = metrics.pb?.value;

  const peEqualsPrice =
    price !== undefined &&
    pe !== undefined &&
    price > 0 &&
    Math.abs(pe - price) / price <= PE_PRICE_TOLERANCE;
  const pbLikelyPe = pb !== undefined && pb > PB_CEILING && pe === undefined;
  const hasStale52w = metrics.price_vs_52w_high !== undefined || metrics.high_52w !== undefined;

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
/** Session freshness expires at the next possible close, without assuming weekdays are trading days. */
export function cnSessionObservationCurrent(observedAt: string, asOf: string): boolean {
  const observed = Date.parse(observedAt),
    cutoff = Date.parse(asOf),
    day = 86400000,
    closeOffset = 7 * 3600000;
  const nextClose = (Math.floor((observed - closeOffset) / day) + 1) * day + closeOffset;
  return Number.isFinite(observed) && Number.isFinite(cutoff) && cutoff < nextClose;
}

function quoteObservationCutoff(
  asOf: string,
  observedAt: string | undefined,
  session: boolean,
): number | undefined {
  const cutoff = Date.parse(asOf),
    observed = observedAt === undefined ? cutoff : Date.parse(observedAt);
  if (!Number.isFinite(cutoff) || !Number.isFinite(observed))
    throw new Error("Invalid quote cutoff");
  if (session && observedAt !== undefined && !cnSessionObservationCurrent(observedAt, asOf))
    return undefined;
  return Math.min(cutoff, observed);
}

/** Current observation of the latest disclosed effective structure; historical availability is not backdated. */
// 股本结构要求来源日期与证券代码绑定；无效记录宁可不产生事实。
export function parseCnShareStructureFacts(
  body: unknown,
  urlString: string,
  options: { sourceId: string; entity: string; basis: string; asOf: string; observedAt: string },
): import("../../shared/financial-model.js").FinancialFact[] {
  const url = new URL(urlString),
    filter = url.searchParams.get("filter") ?? "";
  const identity = filter.match(/^\(SECUCODE="(\d{6})\.(SH|SZ|BJ)"\)$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "datacenter.eastmoney.com" ||
    url.pathname !== "/securities/api/data/v1/get" ||
    url.searchParams.get("reportName") !== "RPT_F10_EH_EQUITY" ||
    url.searchParams.get("pageNumber") !== "1" ||
    url.searchParams.get("sortColumns") !== "END_DATE" ||
    url.searchParams.get("sortTypes") !== "-1"
  )
    throw new Error("Unsupported share structure contract");
  if (!identity || identity[1] !== options.entity)
    throw new Error("Share structure request identity mismatch");
  const root = body as { success?: boolean; result?: { data?: Array<Record<string, unknown>> } };
  if (root?.success !== true || !Array.isArray(root.result?.data) || !root.result.data.length)
    return [];
  const observed = Date.parse(options.observedAt),
    cutoff = Date.parse(options.asOf);
  if (!Number.isFinite(observed) || !Number.isFinite(cutoff) || observed > cutoff) return [];
  const rows = root.result.data;
  if (
    rows.some(
      (row) =>
        row.SECURITY_CODE !== options.entity || row.SECUCODE !== `${identity[1]}.${identity[2]}`,
    )
  )
    throw new Error("Share structure response identity mismatch");
  const validDate = (value: unknown) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(value) &&
    Number.isFinite(Date.parse(value.slice(0, 10))) &&
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10);
  if (
    rows.some(
      (row, index) =>
        !validDate(row.END_DATE) ||
        (index > 0 && String(rows[index - 1].END_DATE) < String(row.END_DATE)),
    )
  )
    return [];
  const selected = rows
    .map((row, index) => ({ row, index, date: String(row.END_DATE ?? "").slice(0, 10) }))
    .filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Date.parse(date) <= observed);
  const latest = selected
    .map((r) => r.date)
    .sort()
    .at(-1);
  const fields = {
    totalShares: "TOTAL_SHARES",
    aShares: "TOTAL_A_SHARES",
    bShares: "B_FREE_SHARE",
    restrictedBShares: "LIMITED_B_SHARES",
    hShares: "H_FREE_SHARE",
    restrictedHShares: "LIMITED_H_SHARES",
    otherShares: "OTHER_FREE_SHARES",
    preferredShares: "PREFERRED_SHARES",
  };
  const parseStructure = (row: Record<string, unknown>, date: string) =>
    shareStructureSchema.safeParse({
      effectiveDate: date,
      announcedAt: String(row.NOTICE_DATE ?? "").slice(0, 10),
      changeReason: row.CHANGE_REASON,
      ...Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column]])),
    });
  const facts: import("../../shared/financial-model.js").FinancialFact[] = [];
  for (const { row, index, date } of selected.filter((r) => r.date === latest)) {
    const parsed = parseStructure(row, date);
    if (!parsed.success || Date.parse(parsed.data.announcedAt) > observed) return [];
    const columns = [
      "SECURITY_CODE",
      "SECUCODE",
      "END_DATE",
      "NOTICE_DATE",
      "CHANGE_REASON",
      ...Object.values(fields),
    ];
    facts.push({
      id: `${options.sourceId}:${index}:share-structure`,
      field: "quote.shareStructure",
      entity: options.entity,
      basis: options.basis,
      year: Number(options.observedAt.slice(0, 4)),
      period: { start: options.observedAt, end: options.observedAt },
      publishedAt: options.observedAt,
      state: "observed",
      unit: "text",
      value: JSON.stringify(parsed.data),
      evidence: columns.map((column) => ({
        sourceId: options.sourceId,
        locator: `/result/data/${index}/${column}`,
        raw: row[column] as string | number | null,
      })),
      reason: "eastmoney_current_share_structure_observation",
    });
    // A includes restricted A shares.  Do not turn a blank B/H field into zero:
    // the reported total must be exhausted by the classes that are actually known.
    // A non-zero preferred or other class makes the ordinary-rights denominator
    // unresolved even if the provider's total happens to look usable.
    const knownOrdinary = [
      parsed.data.aShares,
      parsed.data.bShares,
      parsed.data.restrictedBShares,
      parsed.data.hShares,
      parsed.data.restrictedHShares,
    ]
      .filter((shares): shares is number => shares !== null)
      .reduce((sum, shares) => sum + shares, 0);
    const totalIsReconciledOrdinary =
      parsed.data.aShares > 0 &&
      Number.isSafeInteger(knownOrdinary) &&
      knownOrdinary === parsed.data.totalShares &&
      (parsed.data.otherShares === null || parsed.data.otherShares === 0) &&
      (parsed.data.preferredShares === null || parsed.data.preferredShares === 0);
    if (totalIsReconciledOrdinary) {
      const observationDate = new Date(observed + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      facts.push({
        id: `${options.sourceId}:${index}:ordinary-shares`,
        field: "ordinaryShares",
        entity: options.entity,
        basis: options.basis,
        year: Number(observationDate.slice(0, 4)),
        period: { start: observationDate, end: observationDate },
        publishedAt: options.observedAt,
        state: "observed",
        unit: "shares",
        value: parsed.data.totalShares,
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `/result/data/${index}/TOTAL_SHARES`,
            raw: row.TOTAL_SHARES as number,
          },
        ],
        reason: "eastmoney_current_total_ordinary_shares_reconciled",
      });
    }
  }
  // Preserve the existing response's history for report-to-quote share binding.
  // No additional request is made; an incomplete history cannot prove a conversion.
  const history = selected.map(({ row, date }) => parseStructure(row, date));
  if (
    history.length &&
    history.every((p) => p.success && Date.parse(p.data.announcedAt) <= observed)
  )
    facts.push({
      id: `${options.sourceId}:share-history`,
      field: "quote.shareHistory",
      entity: options.entity,
      basis: options.basis,
      year: Number(options.observedAt.slice(0, 4)),
      period: { start: options.observedAt, end: options.observedAt },
      publishedAt: options.observedAt,
      state: "observed",
      unit: "text",
      value: JSON.stringify(history.map((p) => p.data)),
      evidence: selected.flatMap(({ row, index }) =>
        ["END_DATE", "NOTICE_DATE", "CHANGE_REASON", ...Object.values(fields)].map((column) => ({
          sourceId: options.sourceId,
          locator: `/result/data/${index}/${column}`,
          raw: row[column] ?? null,
        })),
      ),
      reason: "eastmoney_observed_share_history",
    });
  return facts;
}

/** Price policy uses completed unadjusted daily closes; quote f43 may be zero before trading. */
export function parseCnPriceFacts(
  body: unknown,
  options: {
    sourceId: string;
    entity: string;
    basis: string;
    asOf: string;
    observedAt?: string;
    kind: "daily" | "shares" | "session";
  },
): import("../../shared/financial-model.js").FinancialFact[] {
  const data = (body as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object")
    throw new Error(`Invalid quote response: ${options.sourceId}`);
  const cutoff = quoteObservationCutoff(
    options.asOf,
    options.observedAt,
    options.kind === "session",
  );
  if (cutoff === undefined) return [];
  const observation = (
    field: string,
    value: number | string,
    unit: string,
    date: string,
    publishedAt: string,
    locator: string,
    raw: number | string,
  ): import("../../shared/financial-model.js").FinancialFact => ({
    id: `${options.sourceId}:${locator}`,
    field,
    value,
    unit,
    entity: options.entity,
    basis: options.basis,
    year: Number(date.slice(0, 4)),
    period: { start: date, end: date },
    publishedAt,
    state: "observed",
    evidence: [{ sourceId: options.sourceId, locator, raw }],
  });
  if (options.kind === "shares") {
    if (data.f57 !== options.entity) throw new Error("Quote identity mismatch");
    const shares = data.f84,
      timestamp = data.f86;
    if (
      typeof shares !== "number" ||
      !Number.isSafeInteger(shares) ||
      shares <= 0 ||
      typeof timestamp !== "number" ||
      !Number.isFinite(timestamp) ||
      timestamp * 1000 > cutoff
    )
      return [];
    const publishedAt = new Date(timestamp * 1000).toISOString();
    const date = new Date(timestamp * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Same-rights/ordinary-share applicability is checked separately before P3 can pass.
    return [
      observation("ordinaryShares", shares, "shares", date, publishedAt, "/data/f84", shares),
    ];
  }
  if (
    options.kind === "daily"
      ? data.code !== options.entity
      : !(
          (data.code === "000001" && data.market === 1) ||
          (data.code === "399001" && data.market === 0)
        )
  )
    throw new Error("Daily quote/session identity mismatch");
  if (!Array.isArray(data.klines)) throw new Error("Daily quote rows missing");
  const rows = data.klines.flatMap((raw: unknown, i: number) => {
    if (typeof raw !== "string") return [];
    const [date, , close] = raw.split(",");
    const publishedAt = `${date}T15:00:00+08:00`;
    const value = Number(close);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(new Date(publishedAt).getTime()) ||
      new Date(publishedAt).getTime() > cutoff ||
      !Number.isFinite(value) ||
      value <= 0
    )
      return [];
    return [{ raw, i, date, publishedAt, value }];
  });
  const latest = rows
    .map((r) => r.date)
    .sort()
    .at(-1);
  return rows
    .filter((r) => r.date === latest)
    .map((r) =>
      options.kind === "daily"
        ? observation(
            "price",
            r.value,
            "CNY/share",
            r.date,
            r.publishedAt,
            `/data/klines/${r.i}`,
            r.raw,
          )
        : observation(
            "scope.lastCompletedTradingDay",
            r.date,
            "text",
            r.date,
            r.publishedAt,
            `/data/klines/${r.i}`,
            r.raw,
          ),
    );
}

/** Tencent's blank adjustment argument and `day` rows describe unadjusted daily bars. */
export function parseTencentDailyFacts(
  body: unknown,
  urlString: string,
  options: {
    sourceId: string;
    entity: string;
    basis: string;
    asOf: string;
    observedAt?: string;
    kind: "daily" | "session";
  },
): import("../../shared/financial-model.js").FinancialFact[] {
  const url = new URL(urlString),
    args = url.searchParams.get("param")?.split(",") ?? [];
  if (
    url.protocol !== "https:" ||
    url.hostname !== "proxy.finance.qq.com" ||
    url.pathname !== "/ifzqgtimg/appstock/app/newfqkline/get" ||
    args.length !== 6 ||
    args[1] !== "day" ||
    args[5] !== "" ||
    !/^(sh|sz|bj)\d{6}$/.test(args[0])
  )
    throw new Error("Quote source requires a supported unadjusted Tencent daily contract");
  const symbol = args[0];
  if (
    options.kind === "daily"
      ? symbol.slice(2) !== options.entity
      : !["sh000001", "sz399001"].includes(symbol)
  )
    throw new Error("Tencent daily quote/session identity mismatch");
  const response = body as { code?: number; data?: Record<string, { day?: unknown }> };
  const bars = response?.data?.[symbol]?.day;
  if (response?.code !== 0 || !Array.isArray(bars))
    throw new Error("Tencent unadjusted daily rows missing");
  const cutoff = quoteObservationCutoff(
    options.asOf,
    options.observedAt,
    options.kind === "session",
  );
  if (cutoff === undefined) return [];
  const rows = bars.flatMap((row: unknown, index: number) => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row[0]))
      return [];
    const date = row[0],
      publishedAt = `${date}T15:00:00+08:00`,
      close = row[2];
    if (
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      Date.parse(publishedAt) > cutoff ||
      (typeof close !== "string" && typeof close !== "number") ||
      !Number.isFinite(Number(close)) ||
      Number(close) <= 0
    )
      return [];
    return [{ date, publishedAt, close, index }];
  });
  const latest = rows
    .map((r) => r.date)
    .sort()
    .at(-1);
  return rows
    .filter((r) => r.date === latest)
    .map((r) => {
      const daily = options.kind === "daily",
        locator = `/data/${symbol}/day/${r.index}/${daily ? 2 : 0}`;
      return {
        id: `${options.sourceId}:${locator}`,
        field: daily ? "price" : "scope.lastCompletedTradingDay",
        value: daily ? Number(r.close) : r.date,
        unit: daily ? "CNY/share" : "text",
        entity: options.entity,
        basis: options.basis,
        year: Number(r.date.slice(0, 4)),
        period: { start: r.date, end: r.date },
        publishedAt: r.publishedAt,
        state: "observed",
        evidence: [{ sourceId: options.sourceId, locator, raw: daily ? r.close : r.date }],
      };
    });
}
