/**
 * 公司筛选：对可靠财务事实应用质量、金融和净流动资产折价策略，输出每个条件的理由与计算依据。
 * 本模块不联网；先判定完整资格，再限制展示数量。研究资格与价格条件分别计算。
 */
import { type CnPolicy } from "../policy/loader.js";
import {
  regulatoryContextSchema,
  regulatoryMetricDefinitions,
  insuranceContextSchema,
  insuranceOperatingDefinitions,
  ordinaryReturnContextSchema,
  shareStructureSchema,
  businessSegmentsSchema,
  type InsuranceContext,
  type RegulatoryContext,
  latestDisclosedFiscalYear,
  type CalculationStep,
  type CompanyEvaluation,
  type CompanyFacts,
  type ConditionResult,
  type ConditionState,
  type FinancialFact,
  type StrategyResult,
  type StrategyId,
} from "../shared/financial-model.js";

type CoverageCounts = {
  input: number;
  qualityKnown: number;
  qualityPassed: number;
  researchKnown: number;
  researchPassed: number;
  researchDisplayed: number;
  opportunityPassed: number;
  displayed: number;
  qualityFailedWithUnknown: number;
};
type StrategySelector = "all" | "quality" | "financial" | "ncav";
type EvaluationSummary = {
  strategy: StrategySelector;
  inputCount: number;
  qualityCount: number;
  researchCount: number;
  opportunityCount: number;
  researchDisplayCount: number;
  displayCount: number;
  qualityPool: string[];
  researchCandidates: string[];
  opportunities: string[];
  researchDisplayed: string[];
  displayed: string[];
  backupLimit: number;
  backupCandidates: string[];
  backupDisplayed: string[];
  candidateQueue: Array<{
    id: string;
    tier: 1 | 2 | 3;
    displayed: boolean;
    reason: "selected" | "main_limit" | "backup_limit" | "duplicate_company";
    ranking?: CompanyEvaluation["researchRanking"];
    backupStrategy?: "ncav" | "financial_discount" | "earnings_repair";
  }>;
  terminalCounts: Record<string, number>;
  coverage: {
    byMethod: Record<string, CoverageCounts>;
    byIndustry: Record<string, CoverageCounts>;
  };
  unknownReasons: Record<string, number>;
  strategies?: Partial<
    Record<
      StrategyId,
      {
        qualified: string[];
        displayed: string[];
        qualifiedCount: number;
        displayCount: number;
        unionDisplayCount: number;
      }
    >
  >;
};
const evaluationIdentity = (r: CompanyEvaluation) => `${r.market}:${r.ticker}`;
const evaluationUnknownConditions = (conditions: ConditionResult[]): ConditionResult[] =>
  conditions.flatMap((c) => [
    ...(c.state === "unknown" ? [c] : []),
    ...evaluationUnknownConditions(c.components ?? []),
  ]);
const emptyCoverage = (): CoverageCounts => ({
  input: 0,
  qualityKnown: 0,
  qualityPassed: 0,
  researchKnown: 0,
  researchPassed: 0,
  researchDisplayed: 0,
  opportunityPassed: 0,
  displayed: 0,
  qualityFailedWithUnknown: 0,
});

/** Incrementally summarizes already-evaluated companies without retaining their evidence payloads. */
// 名单与覆盖统计：流式汇总全部资格，展示上限不影响通过判定。
export function createEvaluationAccumulator(
  limit: number,
  strategy: StrategySelector = "quality",
  backupLimit = 30,
) {
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error("Display limit must be a nonnegative integer");
  if (!Number.isInteger(backupLimit) || backupLimit < 0)
    throw new Error("Backup display limit must be a nonnegative integer");
  const weak: Array<{ id: string; pb: number; earningsYield: number; strategy: "financial_discount" | "earnings_repair" }> = [];
  const assetBackups: Array<{ id: string; value: number }> = [];
  const rankings = new Map<string, CompanyEvaluation["researchRanking"]>();
  const qualityPool: string[] = [];
  const opportunities: Array<{ id: string; value: number }> = [];
  const research: Array<{ id: string; value: number }> = [];
  const terminalCounts: Record<string, number> = {};
  const unknownReasons: Record<string, number> = {};
  const coverage: {
    byMethod: Record<string, CoverageCounts>;
    byIndustry: Record<string, CoverageCounts>;
  } = { byMethod: {}, byIndustry: {} };
  const coverageRows: Array<{ id: string; method: string; industries: string[] }> = [];
  const strategyRows = new Map<StrategyId, Array<{ id: string; value: number }>>();
  const companyKeys = new Map<string, string>();
  const unionState = (states: Array<ConditionState | undefined>): ConditionState =>
    states.includes("pass")
      ? "pass"
      : states.some((s) => s === undefined || s === "unknown" || s === "not_evaluated")
        ? "unknown"
        : states.every((s) => s === "not_applicable")
          ? "not_applicable"
          : "fail";
  const selected = (r: CompanyEvaluation) =>
    strategy === "ncav"
      ? { research: r.strategies?.ncav?.state, value: r.strategies?.ncav?.state }
      : strategy === "financial"
        ? {
            research: r.strategies?.financial_research?.state,
            value: r.strategies?.financial_value?.state,
          }
        : strategy === "all"
          ? {
              research: unionState([
                r.research,
                r.strategies?.financial_research?.state,
              ]),
              value: unionState([
                r.priority,
                r.strategies?.financial_value?.state,
              ]),
            }
          : { research: r.research, value: r.priority };
  const selectedSignal = (r: CompanyEvaluation) =>
    strategy === "ncav"
      ? r.strategies?.ncav?.signal?.value
      : strategy === "financial"
        ? r.strategies?.financial_value?.conditions.find(
            (c) => c.id === "FV.P3" && c.state !== "unknown",
          )?.value
        : r.conditions.find((c) => c.id === "P3" && c.state !== "unknown")?.value;
  let inputCount = 0;
  const count = (
    group: Record<string, CoverageCounts>,
    label: string,
    r: CompanyEvaluation,
    qualityUnknown: ConditionResult[],
  ) => {
    const n = (group[label] ??= emptyCoverage());
    const { research, value } = selected(r);
    n.input++;
    if (r.quality !== "unknown") n.qualityKnown++;
    if (r.quality === "pass") n.qualityPassed++;
    if (research === "pass" || research === "fail") n.researchKnown++;
    if (research === "pass") n.researchPassed++;
    if (value === "pass") n.opportunityPassed++;
    if (r.quality === "fail" && qualityUnknown.length) n.qualityFailedWithUnknown++;
  };
  const cloneCoverage = (group: Record<string, CoverageCounts>) =>
    Object.fromEntries(Object.entries(group).map(([label, n]) => [label, { ...n }]));
  return {
    accept(r: CompanyEvaluation): void {
      inputCount++;
      const id = evaluationIdentity(r),
        qualityUnknown = evaluationUnknownConditions(
          r.conditions.filter((c) => c.layer === "quality"),
        );
      const method =
        r.method.state === "applies" && !r.conditions.some((c) => c.reason === "method_pending")
          ? (r.method.value ?? "unresolved")
          : "unresolved";
      const industries = r.identity?.industryLabels.length
        ? r.identity.industryLabels
        : ["unlabeled"];
      coverageRows.push({ id, method, industries: [...new Set(industries)] });
      count(coverage.byMethod, method, r, qualityUnknown);
      for (const industry of new Set(industries))
        count(coverage.byIndustry, industry, r, qualityUnknown);
      if (r.quality === "pass") qualityPool.push(id);
      companyKeys.set(id, r.companyId);
      for (const [strategyId, result] of Object.entries(r.strategies ?? {}))
        if (result.state === "pass") {
          const rows = strategyRows.get(strategyId as StrategyId) ?? [];
          const signal =
            result.signal?.value ??
            (strategyId.startsWith("quality_")
              ? r.conditions.find((c) => c.id === "P3" && c.state !== "unknown")?.value
              : strategyId === "financial_research"
                ? r.strategies?.financial_value?.signal?.value
                : undefined);
          rows.push({
            id,
            value: typeof signal === "number" && Number.isFinite(signal) ? signal : -Infinity,
          });
          strategyRows.set(strategyId as StrategyId, rows);
        }
      rankings.set(id, r.researchRanking);
      if (strategy === "all" && r.strategies?.ncav?.state === "pass")
        assetBackups.push({ id, value: r.strategies.ncav.signal?.value ?? -Infinity });
      const lead = r.strategies?.financial_discount;
      if ((strategy === "all" || strategy === "financial") && lead?.state === "pass")
        weak.push({
          id, strategy: "financial_discount",
          pb: lead.conditions.find((c) => c.id === "FD.pb")?.value ?? Infinity,
          earningsYield:
            lead.conditions.find((c) => c.id === "FD.earningsYield")?.value ?? -Infinity,
        });
      const repair = r.strategies?.earnings_repair;
      if (strategy === "all" && repair?.state === "pass")
        weak.push({ id, strategy: "earnings_repair", pb: Infinity, earningsYield: repair.signal?.value ?? -Infinity });
      const financialResearch = r.strategies?.financial_research;
      const financialValue = r.strategies?.financial_value;
      const { research: selectedResearch, value: selectedValue } = selected(r);
      const signal = selectedSignal(r),
        value = typeof signal === "number" && Number.isFinite(signal) ? signal : -Infinity;
      if (selectedResearch === "pass") research.push({ id, value: strategy === "all" ? 0 : value });
      if (selectedValue === "pass") {
        const priceCondition =
          strategy === "financial"
            ? financialValue?.conditions.find((c) => c.id === "FV.P3")
            : r.conditions.find((c) => c.id === "P3");
        const conservativeValue =
          strategy === "ncav"
            ? value
            : (priceCondition?.value ?? priceCondition?.bounds?.lower ?? -Infinity);
        opportunities.push({ id, value: strategy === "all" ? 0 : conservativeValue });
      }
      const selectedTerminal =
        (strategy === "all" || strategy === "financial") &&
        selectedResearch !== "pass" &&
        lead?.state === "pass"
          ? "financial_discount_pass"
          : strategy === "all" && selectedResearch !== "pass" && repair?.state === "pass"
            ? "earnings_repair_pass"
          : strategy === "ncav"
            ? `ncav_${selectedValue}`
            : strategy === "all"
              ? `strategies_${selectedResearch}`
              : strategy === "financial"
                ? selectedResearch === "pass"
                  ? `financial_value_${selectedValue}`
                  : `financial_research_${selectedResearch}`
                : r.quality === "pass"
                  ? `priority_${r.priority}`
                  : `quality_${r.quality}`;
      const terminal =
        r.identity?.state === "not_yet_listed"
          ? "scope_not_yet_listed"
          : r.quality === "unknown" && r.collection && r.collection.state !== "complete"
            ? `collection_${r.collection.state}`
            : selectedTerminal;
      terminalCounts[terminal] = (terminalCounts[terminal] ?? 0) + 1;
      // Count affected companies once per reason, not the number of repeated formula operands.
      const selectedConditions =
        strategy === "quality"
          ? r.conditions
          : Object.values(r.strategies ?? {}).flatMap((s) => s.conditions);
      for (const reason of new Set(
        evaluationUnknownConditions(selectedConditions).flatMap((c) => [
          ...(c.reason !== "all_required" ? [c.reason] : []),
          ...c.missing,
        ]),
      ))
        unknownReasons[reason] = (unknownReasons[reason] ?? 0) + 1;
    },
    finish(): EvaluationSummary {
      // Price class first, then sustained reported return and conservative earnings yield.
      // These are explicit ordering signals, not a weighted intrinsic-value/quality score.
      const bandOrder = { undervalued: 0, normal: 1, expensive: 2, unknown: 3 };
      const numberOrder = (a?: number, b?: number) =>
        (Number.isFinite(b) ? b! : -Infinity) - (Number.isFinite(a) ? a! : -Infinity);
      const researchOrder = (a: string, b: string) => {
        const left = rankings.get(a), right = rankings.get(b);
        return bandOrder[left?.priceBand ?? "unknown"] - bandOrder[right?.priceBand ?? "unknown"] ||
          numberOrder(left?.returnMedian, right?.returnMedian) ||
          numberOrder(left?.earningsYield, right?.earningsYield) ||
          (companyKeys.get(a) ?? a).localeCompare(companyKeys.get(b) ?? b, "en") || a.localeCompare(b, "en");
      };
      const sorted = (rows: Array<{ id: string; value: number }>) =>
        [...rows].sort((a, b) => strategy === "all" || strategy === "financial"
          ? researchOrder(a.id, b.id)
          : b.value - a.value || a.id.localeCompare(b.id, "en")).map(r => r.id);
      const dedupeCompanies = (ids: string[]) => {
        const seen = new Set<string>();
        return ids.filter((id) => {
          const key = companyKeys.get(id) ?? id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const opportunityIds =
          strategy === "all" ? dedupeCompanies(sorted(opportunities)) : sorted(opportunities),
        researchIds = strategy === "all" ? dedupeCompanies(sorted(research)) : sorted(research);
      // Independent backup seats never consume a research seat. Asset coverage is
      // listed before financial book/earnings leads with specialist risks pending.
      const tiered = strategy === "all" || strategy === "financial";
      const weakIds = [...weak]
        .sort(
          (a, b) =>
            b.earningsYield - a.earningsYield || (a.pb === b.pb ? 0 : a.pb - b.pb) || a.id.localeCompare(b.id, "en"),
        )
        .map((r) => r.id);
      const assetIds = [...assetBackups].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id, "en")).map(r => r.id);
      const backupIds = [...assetIds, ...weakIds];
      const assetSet = new Set(assetIds);
      const repairStrategies = new Map(weak.map(r => [r.id, r.strategy]));
      const seenCompanies = new Set<string>();
      const queuedIds = new Set<string>();
      const candidateQueue: EvaluationSummary["candidateQueue"] = [];
      const pushRows = (ids: string[], tier: 1 | 2 | 3) => {
        for (const id of ids) {
          if (queuedIds.has(id)) continue;
          queuedIds.add(id);
          const key = companyKeys.get(id) ?? id;
          const duplicate = seenCompanies.has(key);
          seenCompanies.add(key);
          candidateQueue.push({
            id,
            tier,
            displayed: false,
            reason: duplicate ? "duplicate_company" : tier === 3 ? "backup_limit" : "main_limit",
            ...(tier < 3 ? (rankings.get(id) ? { ranking: rankings.get(id) } : {}) : { backupStrategy: assetSet.has(id) ? "ncav" as const : repairStrategies.get(id)! }),
          });
        }
      };
      pushRows(sorted(opportunities), 1);
      pushRows(sorted(research), 2);
      if (tiered) pushRows(backupIds, 3);
      const displayed: string[] = [];
      let weakCount = 0;
      for (const row of candidateQueue) {
        if (row.reason === "duplicate_company") continue;
        if (!tiered && row.tier !== 1) continue;
        if (row.tier === 3 ? weakCount >= backupLimit : displayed.length - weakCount >= limit) continue;
        row.displayed = true;
        row.reason = "selected";
        displayed.push(row.id);
        if (row.tier === 3) weakCount++;
      }
      const displayedSet = new Set(displayed);
      const researchDisplayed = tiered
        ? candidateQueue.filter((r) => r.displayed && r.tier < 3).map((r) => r.id)
        : researchIds.slice(0, limit);
      const researchSet = new Set(researchDisplayed);
      const strategies: NonNullable<EvaluationSummary["strategies"]> = {};
      const enabled =
        strategy === "all"
          ? ([
              "quality_research",
              "quality_value",
              "financial_research",
              "financial_value",
              "financial_discount",
              "earnings_repair",
              "ncav",
            ] as const)
          : strategy === "ncav"
            ? (["ncav"] as const)
            : strategy === "financial"
              ? (["financial_research", "financial_value", "financial_discount"] as const)
              : [];
      const displayedCompanies = new Set(displayed.map((id) => companyKeys.get(id) ?? id));
      for (const id of enabled) {
        const qualified =
            (id === "financial_discount" || id === "earnings_repair")
              ? dedupeCompanies(weakIds.filter(key => repairStrategies.get(key) === id))
              : [...(strategyRows.get(id) ?? [])]
                  .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id, "en"))
                  .map((r) => r.id),
          ownDisplay = qualified.slice(0, id === "financial_discount" || id === "earnings_repair" ? backupLimit : limit);
        strategies[id] = {
          qualified,
          displayed: ownDisplay,
          qualifiedCount: qualified.length,
          displayCount: ownDisplay.length,
          unionDisplayCount: new Set(
            qualified
              .filter((id) => displayedCompanies.has(companyKeys.get(id) ?? id))
              .map((id) => companyKeys.get(id) ?? id),
          ).size,
        };
      }
      const finishedCoverage = {
        byMethod: cloneCoverage(coverage.byMethod),
        byIndustry: cloneCoverage(coverage.byIndustry),
      };
      for (const row of coverageRows)
        if (displayedSet.has(row.id)) {
          finishedCoverage.byMethod[row.method].displayed++;
          for (const industry of row.industries) finishedCoverage.byIndustry[industry].displayed++;
        }
      for (const row of coverageRows)
        if (researchSet.has(row.id)) {
          finishedCoverage.byMethod[row.method].researchDisplayed++;
          for (const industry of row.industries)
            finishedCoverage.byIndustry[industry].researchDisplayed++;
        }
      return {
        strategy,
        inputCount,
        qualityCount: qualityPool.length,
        researchCount: researchIds.length,
        opportunityCount: opportunityIds.length,
        researchDisplayCount: researchDisplayed.length,
        displayCount: displayed.length,
        qualityPool: [...qualityPool],
        researchCandidates: researchIds,
        opportunities: opportunityIds,
        researchDisplayed,
        displayed,
        backupLimit,
        backupCandidates: candidateQueue.filter(r => r.tier === 3 && r.reason !== "duplicate_company").map(r => r.id),
        backupDisplayed: candidateQueue.filter(r => r.tier === 3 && r.displayed).map(r => r.id),
        candidateQueue,
        terminalCounts: { ...terminalCounts },
        coverage: finishedCoverage,
        unknownReasons: { ...unknownReasons },
        ...(strategy !== "quality" ? { strategies } : {}),
      };
    },
  };
}

/** Shared pure evaluation boundary; presentation never changes opportunity membership. */
export function evaluateCompanies(
  companies: CompanyFacts[],
  policy: CnPolicy,
  limit = policy.priority.displayLimit,
  options: {
    evaluateAll?: boolean;
    strategy?: StrategySelector;
    backupLimit?: number;
  } = {},
) {
  const accumulator = createEvaluationAccumulator(
    limit,
    options.strategy,
    options.backupLimit ?? policy.priority.backupLimit ?? policy.strategies?.financialDiscount?.displayLimit,
  );
  const results = companies.map((c) => {
    const result = evaluateCompany(c, policy, options);
    accumulator.accept(result);
    return result;
  });
  return { results, summary: accumulator.finish() };
}

interface Quantity {
  low: number;
  high: number;
  facts: string[];
  missing: string[];
}
// These are mutually exclusive year-end accounting roles. Footnote totals and
// current lease/loan subcomponents must never be added again to this ledger.
const reportedDebtComponents = [
  "shortBorrowings",
  "longBorrowings",
  "bondsPayable",
  "shortBondsPayable",
  "leaseLiabilities",
  "currentNoncurrentLiabilities",
];
const reportedLiabilityFields = [
  ...reportedDebtComponents,
  "notesPayable",
  "longPayables",
  "otherCurrentLiabilities",
  "otherNoncurrentLiabilities",
  "otherPayables",
];
const distinct = (items: string[]) => [...new Set(items)];
const exact = (value: number, inputs: Quantity[] = []): Quantity => ({
  low: value,
  high: value,
  facts: distinct(inputs.flatMap((q) => q.facts)),
  missing: distinct(inputs.flatMap((q) => q.missing)),
});
const unresolved = (reason: string, facts: string[] = []): Quantity => ({
  low: -Infinity,
  high: Infinity,
  facts,
  missing: [reason],
});
// 事实运算：用上下界表达不确定性，只有整个区间支持判断时才给出通过或失败。
function eligibleFacts(c: CompanyFacts, field: string, year: number): FinancialFact[] {
  const candidates = c.facts.filter(
    (f) => f.field === field && f.year === year && f.entity === c.companyId,
  );
  const cutoff = new Date(c.asOf).getTime();
  return candidates.filter(
    (f) =>
      f.basis === c.basis &&
      new Date(f.publishedAt).getTime() <= cutoff &&
      new Date(f.period.end).getTime() <= cutoff,
  );
}
function read(c: CompanyFacts, field: string, year: number, unit = c.currency): Quantity {
  const available = eligibleFacts(c, field, year);
  let eligible = available.filter((f) => f.state !== "missing");
  if (!eligible.length)
    return unresolved(
      `${field}:${year}`,
      available.map((f) => f.id),
    );
  if (["price", "ordinaryShares"].includes(field)) {
    const latest = eligible
      .map((f) => f.period.end)
      .sort()
      .at(-1);
    eligible = eligible.filter((f) => f.period.end === latest);
  }
  const signature = (f: CompanyFacts["facts"][number]) =>
    JSON.stringify([f.state, f.value, f.unit, f.period]);
  if (
    !eligible.length ||
    eligible.some((f) => signature(f) !== signature(eligible[0]) || !f.evidence.length)
  )
    return unresolved(
      `${field}:${year}${eligible.length > 1 ? ":conflict" : ""}`,
      eligible.map((f) => f.id),
    );
  const f = eligible[0];
  if (
    !["observed", "derived"].includes(f.state) ||
    f.unit !== unit ||
    typeof f.value !== "number" ||
    !Number.isFinite(f.value) ||
    !f.evidence.length
  ) {
    return unresolved(`${field}:${year}:${f.reason ?? f.state}`, [f.id]);
  }
  const instant =
    field.startsWith("reportedFinancial.") ||
    [
      "currentAssets",
      "minorityEquity",
      "equity",
      "parentEquity",
      "nonordinaryEquity",
      "preferredEquity",
      "perpetualEquity",
      "ordinaryEquity",
      "reportedOrdinaryBps",
      "reportedDebt",
      "bookDebt",
      "debt",
      "availableCash",
      "nonoperatingAssets",
      "assets",
      "liabilities",
      "additionalFinancing",
      "price",
      "ordinaryShares",
      ...reportedLiabilityFields,
      "otherReportedInterestDebt",
    ].includes(field);
  const annual = f.period.start === `${year}-01-01` && f.period.end === `${year}-12-31`;
  if (
    (!instant && !annual) ||
    (instant && !["price", "ordinaryShares"].includes(field) && f.period.end !== `${year}-12-31`) ||
    Number(f.period.end.slice(0, 4)) !== year
  )
    return unresolved(`${field}:${year}:period_mismatch`, [f.id]);
  const nonnegative =
    field.startsWith("reportedFinancial.") ||
    [
      "capex",
      "reportedDebt",
      "bookDebt",
      "debt",
      "liabilities",
      "additionalFinancing",
      "availableCash",
      "nonoperatingAssets",
      "interestExpense",
      "cost",
      "businessTax",
      "sellingExpense",
      "adminExpense",
      "researchExpense",
      "ordinaryShares",
      "price",
      ...reportedLiabilityFields,
      "otherReportedInterestDebt",
      "preferredEquity",
      "perpetualEquity",
    ].includes(field);
  if (nonnegative && f.value < 0)
    return unresolved(`${field}:${year}:invalid_negative_value`, [f.id]);
  return { low: f.value, high: f.value, facts: eligible.map((f) => f.id), missing: [] };
}
function sum(qs: Quantity[]): Quantity {
  return {
    low: qs.reduce((s, q) => s + q.low, 0),
    high: qs.reduce((s, q) => s + q.high, 0),
    facts: distinct(qs.flatMap((q) => q.facts)),
    missing: distinct(qs.flatMap((q) => q.missing)),
  };
}
function difference(a: Quantity, b: Quantity): Quantity {
  return { ...sum([a, b]), low: a.low - b.high, high: a.high - b.low };
}
function minimum(qs: Quantity[]): Quantity {
  return {
    ...sum(qs),
    low: Math.min(...qs.map((q) => q.low)),
    high: Math.min(...qs.map((q) => q.high)),
  };
}
function median(qs: Quantity[]): Quantity {
  const midpoint = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]; // financial windows are odd: 3, 5, 7
  };
  return { ...sum(qs), low: midpoint(qs.map((q) => q.low)), high: midpoint(qs.map((q) => q.high)) };
}
function ratio(a: Quantity, b: Quantity): Quantity {
  const inputs = sum([a, b]);
  if (b.low !== b.high || b.low <= 0)
    return {
      ...inputs,
      low: -Infinity,
      high: Infinity,
      missing: distinct([...inputs.missing, ...(b.high <= 0 ? ["nonpositive_denominator"] : [])]),
    };
  return { ...inputs, low: a.low / b.low, high: a.high / b.low };
}
function positives(qs: Quantity[]): Quantity {
  return {
    ...sum(qs),
    low: qs.filter((q) => q.low > 0).length,
    high: qs.filter((q) => q.high > 0).length,
  };
}
function compare(
  id: string,
  q: Quantity,
  operator: ">=" | ">" | "<=" | "<",
  target: number,
  formula: string,
): ConditionResult {
  const test = (v: number) =>
    operator === ">="
      ? v >= target
      : operator === ">"
        ? v > target
        : operator === "<="
          ? v <= target
          : v < target;
  const ascending = operator === ">=" || operator === ">";
  const state = test(ascending ? q.low : q.high)
    ? "pass"
    : !test(ascending ? q.high : q.low)
      ? "fail"
      : "unknown";
  return {
    id,
    layer: id.startsWith("P") ? "priority" : "quality",
    state,
    reason: state === "unknown" ? "insufficient_evidence" : "threshold",
    factIds: q.facts,
    missing: q.missing,
    formula,
    threshold: { operator, value: target },
    proof: q.low === q.high ? "exact" : "bound",
    ...(q.low === q.high && Number.isFinite(q.low)
      ? { value: q.low }
      : {
          bounds: {
            ...(Number.isFinite(q.low) ? { lower: q.low } : {}),
            ...(Number.isFinite(q.high) ? { upper: q.high } : {}),
          },
        }),
  };
}
export function aggregateConditions(conditions: ConditionResult[]): ConditionState {
  if (conditions.some((c) => c.state === "fail")) return "fail";
  if (
    !conditions.length ||
    conditions.some((c) => c.state === "unknown" || c.state === "not_evaluated")
  )
    return "unknown";
  return "pass";
}
function group(id: string, components: ConditionResult[]): ConditionResult {
  return {
    id,
    layer: id.startsWith("P") ? "priority" : "quality",
    state: aggregateConditions(components),
    reason: "all_required",
    components,
    factIds: distinct(components.flatMap((c) => c.factIds)),
    missing: distinct(components.flatMap((c) => c.missing)),
  };
}
function pending(id: string, reason: string, state: ConditionState = "unknown"): ConditionResult {
  return {
    id,
    layer: id.startsWith("P") ? "priority" : "quality",
    state,
    reason,
    factIds: [],
    missing: state === "unknown" ? [reason] : [],
  };
}
function financialLayer(condition: ConditionResult): ConditionResult {
  return {
    ...condition,
    layer: "financial",
    components: condition.components?.map(financialLayer),
  };
}
/** Bank/broker research deliberately reuses risk/scope facts, but never the old quality P0/P1/P2 decision. */
// 独立金融策略：专用风险要求替代普通企业的现金流与债务要求。
function financialStrategies(
  c: CompanyFacts,
  policy: CnPolicy,
  methodValid: boolean,
  stale: boolean,
  n1: ConditionResult,
  roes: Quantity[],
  risk: ConditionResult | undefined,
  scope: ConditionResult | undefined,
  p3: ConditionResult,
): Partial<Record<"financial_research" | "financial_value", StrategyResult>> {
  const config = policy.strategies?.financial ?? {
    methods: ["bank", "broker"] as const,
    positiveProfitYears: 4,
    roeMedian: 0.08,
    roeRecentMedian: 0.08,
  };
  const insurance = ["pc_insurance", "life_insurance", "insurance_group"].includes(
    c.method.value ?? "",
  );
  const applicable = config.methods.includes(c.method.value as (typeof config.methods)[number]);
  // A routed financial method without frozen financial rules remains a visible
  // coverage gap. Only non-financial methods are truly not applicable here.
  const pendingFinancial =
    !applicable &&
    [
      "financial_lease",
      "pc_insurance",
      "life_insurance",
      "insurance_group",
      "trust",
      "futures",
      "mixed",
    ].includes(c.method.value ?? "");
  const unavailable = !methodValid
    ? "method_pending"
    : stale && (applicable || pendingFinancial)
      ? "stale_financials"
      : undefined;
  const years = Array.from({ length: 5 }, (_, i) => c.latestFiscalYear - 4 + i),
    profits = years.map((year) =>
      insurance ? insuranceReportedProfit(c, year) : read(c, "parentProfit", year),
    );
  const profitCondition = group("FR.profits", [
    compare(
      "FR.profits.positive",
      positives(profits),
      ">=",
      config.positiveProfitYears,
      "count(reported PNI>0,5y)",
    ),
    compare("FR.profits.total", sum(profits), ">", 0, "sum(reported PNI,5y)"),
    compare("FR.profits.latest", profits.at(-1)!, ">", 0, "latest reported PNI"),
  ]);
  const roe5 = (values: Quantity[]) =>
    compare("FR.roe5", median(values), ">=", config.roeMedian, "median(reported weighted ROE,5y)");
  const roe3 = (values: Quantity[]) =>
    compare(
      "FR.roe3",
      median(values.slice(-3)),
      ">=",
      config.roeRecentMedian,
      "median(reported weighted ROE,3y)",
    );
  const guardedRoe5 = guardedReturns(c, years, roe5(roes), (unknown) =>
    roe5(
      roes.map((q, i) =>
        unknown.has(years[i])
          ? unresolved(`reported_return_basis_unresolved:${years[i]}`, q.facts)
          : q,
      ),
    ),
  );
  const guardedRoe3 = guardedReturns(c, years.slice(-3), roe3(roes), (unknown) =>
    roe3(
      roes
        .slice(-3)
        .map((q, i) =>
          unknown.has(years.slice(-3)[i])
            ? unresolved(`reported_return_basis_unresolved:${years.slice(-3)[i]}`, q.facts)
            : q,
        ),
    ),
  );
  const insuranceRoe = insurance ? insuranceFinancialRoe(c, config.roeMedian) : undefined;
  const insuranceRiskResult = insurance ? insuranceFinancialRisk(c, policy) : undefined;
  const insuranceScope = insurance ? insuranceFinancialScope(c, policy) : undefined;
  const insuranceOperatingResult = insurance ? insuranceFinancialOperating(c, policy) : undefined;
  const applicableConditions = insurance
    ? [
        financialLayer(profitCondition),
        financialLayer(insuranceRoe!),
        financialLayer(insuranceOperatingResult!),
        financialLayer(insuranceRiskResult!),
        financialLayer(insuranceScope!),
      ]
    : [
        financialLayer(profitCondition),
        financialLayer(guardedRoe5),
        financialLayer(guardedRoe3),
        financialLayer(risk ?? pending("F.risk", "financial_risk_missing")),
        financialLayer(scope ?? pending("F.scope", "financial_scope_missing")),
      ];
  const unsupported = methodValid && pendingFinancial;
  const researchConditions = unsupported
    ? [
        {
          ...financialLayer(pending("FR.method", "financial_method_not_supported")),
          factIds: c.method.evidence,
        },
      ]
    : unavailable
      ? [financialLayer(pending("FR.method", unavailable))]
      : pendingFinancial
        ? [financialLayer(pending("FR.method", "financial_method_pending"))]
        : !applicable
          ? [financialLayer(pending("FR.method", "method_not_supported", "not_applicable"))]
          : applicableConditions;
  const researchState =
    applicable && !unavailable
      ? aggregateConditions(researchConditions)
      : unavailable || pendingFinancial
        ? "unknown"
        : "not_applicable";
  const research: StrategyResult = {
    id: "financial_research",
    applicability: !methodValid
      ? "unknown"
      : applicable
        ? "pass"
        : pendingFinancial
          ? "unknown"
          : "not_applicable",
    state: researchState,
    conditions: researchConditions,
  };
  const valueCondition = financialLayer({
    ...p3,
    id: "FV.P3",
    formula: insurance
      ? p3.formula
      : `(1-${policy.priority.earningsHaircut})*min(median(reported PNI,5y), median(reported PNI,3y), latest PNI)/same-rights ordinary shares/current price`,
  });
  const valueState = !applicable
    ? researchState
    : researchState === "fail"
      ? "fail"
      : researchState === "unknown"
        ? "unknown"
        : valueCondition.state;
  const value: StrategyResult = {
    id: "financial_value",
    applicability: research.applicability,
    state: valueState,
    conditions: applicable ? [...researchConditions, valueCondition] : researchConditions,
    ...(applicable
      ? {
          signal: {
            name: "conservative_earnings_yield",
            unit: "ratio" as const,
            direction: "higher_is_better" as const,
            ...(typeof valueCondition.value === "number" ? { value: valueCondition.value } : {}),
          },
        }
      : {}),
  };
  return { financial_research: research, financial_value: value };
}
type Period = { start: string; end: string };
const annualWindow = (c: CompanyFacts, count = 5): Period => ({
  start: `${c.latestFiscalYear - count + 1}-01-01`,
  end: `${c.latestFiscalYear}-12-31`,
});
function scopeCovers(c: CompanyFacts, key: string, period: Period, state = "applies"): boolean {
  const proof = c.checks[key];
  return (
    proof?.state === state &&
    proof.evidence.length > 0 &&
    !!proof.coverage &&
    Date.parse(proof.coverage.start) <= Date.parse(period.start) &&
    Date.parse(proof.coverage.end) >= Date.parse(period.end)
  );
}
function ordinaryReportedScope(
  c: CompanyFacts,
  key: "cash" | "capital" | "interest" | "financing",
): boolean {
  return c.method.value === "nonfinancial" && !c.checks[key]?.evidence.length;
}
function guarded(
  c: CompanyFacts,
  keys: string[],
  result: ConditionResult,
  periods: Record<string, Period> = {},
): ConditionResult {
  const unknown = keys.filter(
    (key) =>
      !((key === "cash" || key === "capital") && ordinaryReportedScope(c, key)) &&
      !scopeCovers(c, key, periods[key] ?? annualWindow(c)),
  );
  const evidence = keys.flatMap((key) => c.checks[key]?.evidence ?? []);
  if (unknown.length)
    return {
      ...pending(result.id, `scope_unresolved:${unknown.join(",")}`),
      factIds: distinct([...result.factIds, ...evidence]),
      components: [{ ...result, state: "not_evaluated", reason: "scope_unresolved" }],
    };
  return { ...result, factIds: distinct([...result.factIds, ...evidence]) };
}
/** A common annual ROE definition can support the return condition alone. */
function guardedReturns(
  c: CompanyFacts,
  years: number[],
  result: ConditionResult,
  withUnknownYears: (years: Set<number>) => ConditionResult,
): ConditionResult {
  const reviewed = guarded(c, ["earnings"], result, {
    earnings: { start: `${years[0]}-01-01`, end: `${years.at(-1)}-12-31` },
  });
  if (
    scopeCovers(c, "earnings", { start: `${years[0]}-01-01`, end: `${years.at(-1)}-12-31` }) ||
    c.checks.earnings?.evidence.length
  )
    return reviewed;
  const evidence: string[] = [],
    missing: string[] = [],
    unknownYears = new Set<number>();
  for (const year of years) {
    const contexts = eligibleFacts(c, "earnings.returnContext", year);
    evidence.push(...contexts.map((f) => f.id));
    const restatements = eligibleFacts(c, "earnings.restatementContext", year).filter(
      (f) => f.state === "observed",
    );
    if (restatements.length) {
      evidence.push(...restatements.map((f) => f.id));
      missing.push(`reported_return_restatement_unbridged:${year}`);
      unknownYears.add(year);
    }
    try {
      if (
        !contexts.length ||
        contexts.some(
          (f) =>
            f.state !== "observed" ||
            f.unit !== "text" ||
            !f.evidence.length ||
            f.period.start !== `${year}-01-01` ||
            f.period.end !== `${year}-12-31`,
        )
      )
        throw new Error("Invalid annual return basis");
      for (const f of contexts) {
        const context = ordinaryReturnContextSchema.parse(JSON.parse(String(f.value)));
        if (context.reportYear !== year) throw new Error("Wrong return year");
        // This annual binding declares CAS, so it cannot certify an IFRS17 window.
        if (
          ["pc_insurance", "life_insurance", "insurance_group"].includes(c.method.value ?? "") &&
          insuranceReturnBasis(c, year)?.standard !== "CAS25-2023"
        )
          throw new Error("Insurance return accounting basis mismatch");
        for (const field of c.method.value === "nonfinancial"
          ? (["weightedRoe", "adjustedWeightedRoe"] as const)
          : (["weightedRoe"] as const)) {
          const id = context[`${field}FactId`],
            bound = c.facts.filter((q) => q.id === id),
            q = read(c, field, year, "ratio");
          if (
            bound.length !== 1 ||
            bound[0].field !== field ||
            bound[0].state !== "observed" ||
            !q.facts.includes(id)
          )
            throw new Error("Unbound annual return");
          evidence.push(id);
        }
      }
    } catch {
      missing.push(`reported_return_basis_unresolved:${year}`);
      unknownYears.add(year);
    }
  }
  if (missing.length) {
    const bounded = withUnknownYears(unknownYears);
    if (bounded.state === "fail")
      return {
        ...bounded,
        reason: "reported_return_basis_bound",
        proof: "bound",
        factIds: distinct([...bounded.factIds, ...evidence]),
        missing: distinct([...bounded.missing, ...missing]),
      };
    return {
      ...reviewed,
      factIds: distinct([...reviewed.factIds, ...evidence]),
      missing: distinct([...reviewed.missing, ...missing]),
    };
  }
  return {
    ...result,
    reason: "annual_reported_return_basis",
    factIds: distinct([...result.factIds, ...evidence]),
  };
}
/** A fresh class breakdown must exhaust the quoted count; missing classes are never filled with zero. */
function guardedQuote(c: CompanyFacts, shares: Quantity, result: ConditionResult): ConditionResult {
  const reviewed = guarded(c, ["quote"], result, { quote: { start: c.asOf, end: c.asOf } });
  if (
    (c.checks.quote && !scopeCovers(c, "quote", { start: c.asOf, end: c.asOf })) ||
    c.market !== "CN" ||
    c.currency !== "CNY" ||
    !c.quoteDate
  )
    return reviewed;
  const close = Date.parse(`${c.quoteDate}T15:00:00+08:00`),
    cutoff = Date.parse(c.asOf);
  const structures = c.facts.filter(
    (f) =>
      f.field === "quote.shareStructure" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) >= close &&
      Date.parse(f.publishedAt) <= cutoff,
  );
  if (!structures.length)
    return reviewed.state === "unknown"
      ? {
          ...reviewed,
          missing: distinct([
            ...reviewed.missing,
            ...result.missing,
            ...shares.missing,
            "share_structure_missing_or_stale",
          ]),
        }
      : reviewed;
  const ids = distinct([...result.factIds, ...structures.map((f) => f.id)]);
  const unresolvedStructure = (reason: string) => ({
    ...pending(result.id, reason),
    factIds: ids,
    missing: distinct([reason, ...result.missing, ...shares.missing]),
  });
  if (!isExact(shares)) return unresolvedStructure("quoted_share_count_unresolved");
  for (const f of structures) {
    const parsed =
      typeof f.value === "string"
        ? shareStructureSchema.safeParse(
            (() => {
              try {
                return JSON.parse(f.value as string);
              } catch {
                return null;
              }
            })(),
          )
        : undefined;
    if (
      f.state !== "observed" ||
      f.unit !== "text" ||
      !f.evidence.length ||
      f.period.start !== f.publishedAt ||
      f.period.end !== f.publishedAt ||
      !parsed?.success
    )
      return unresolvedStructure("share_structure_unresolved");
    const s = parsed.data;
    if (s.effectiveDate > c.quoteDate || Date.parse(s.announcedAt) > Date.parse(f.publishedAt))
      return unresolvedStructure("share_structure_not_effective_for_quote");
    // A includes its restricted shares. B/H restricted and listed amounts are separate roles.
    // A null role contributes no known shares; only exact reconciliation proves no residual.
    const known = [s.aShares, s.bShares, s.restrictedBShares, s.hShares, s.restrictedHShares]
      .filter((n): n is number => n !== null)
      .reduce((a, b) => a + b, 0);
    if (
      s.aShares <= 0 ||
      (s.otherShares !== null && s.otherShares !== 0) ||
      !Number.isSafeInteger(known) ||
      known !== s.totalShares ||
      s.totalShares !== shares.low
    )
      return unresolvedStructure("share_class_reconciliation_unresolved");
  }
  return { ...result, reason: "reported_ordinary_share_structure", factIds: ids };
}
function isExact(q: Quantity): boolean {
  return q.low === q.high && Number.isFinite(q.low);
}
function mapExact(q: Quantity, fn: (n: number) => number): Quantity {
  return isExact(q) ? exact(fn(q.low), [q]) : { ...q, low: -Infinity, high: Infinity };
}
/** Reported parent earnings are adjusted only for a known non-ordinary claim. */
function reportedEarnings(c: CompanyFacts, year: number, adjusted = false): Quantity {
  const parent = read(c, adjusted ? "reportedAdjustedParentProfit" : "parentProfit", year);
  const direct = read(c, adjusted ? "adjustedOrdinaryProfit" : "ordinaryProfit", year);
  const eps = read(
    c,
    adjusted ? "casAdjustedOrdinaryBasicEps" : "casOrdinaryBasicEps",
    year,
    `${c.currency}/share`,
  );
  const comparable = isExact(direct) ? direct : parent;
  if (
    isExact(eps) &&
    eps.low !== 0 &&
    isExact(comparable) &&
    comparable.low !== 0 &&
    Math.sign(eps.low) !== Math.sign(comparable.low)
  ) {
    return unresolved(
      `reported_earnings_eps_conflict:${year}`,
      distinct([...comparable.facts, ...eps.facts]),
    );
  }
  const allocationField = adjusted
    ? "adjustedNonordinaryProfitAllocation"
    : "nonordinaryProfitAllocation";
  const claims = eligibleFacts(c, allocationField, year);
  const equityClaims = [year - 1, year]
    .flatMap((y) =>
      ["nonordinaryEquity", "preferredEquity", "perpetualEquity"].flatMap((field) =>
        eligibleFacts(c, field, y),
      ),
    )
    .filter((f) => f.state !== "missing");
  // The aggregate other-equity balance can be a convertible bond's conversion
  // option. It does not establish a claim on this year's reported parent profit.
  // Identified preferred/perpetual instruments retain the ownership guard;
  // neither their balance nor an unclassified balance is a distribution amount.
  const knownEquityClaim = equityClaims.some(
    (f) =>
      f.field !== "nonordinaryEquity" &&
      typeof f.value === "number" &&
      Number.isFinite(f.value) &&
      f.value > 0 &&
      f.evidence.length > 0,
  );
  const otherAllocation = eligibleFacts(
    c,
    adjusted ? "nonordinaryProfitAllocation" : "adjustedNonordinaryProfitAllocation",
    year,
  ).some((f) => f.state !== "missing");
  if (!claims.length) {
    if (
      eligibleFacts(c, adjusted ? "adjustedOrdinaryProfit" : "ordinaryProfit", year).some(
        (f) => f.state !== "missing",
      ) &&
      !isExact(direct)
    )
      return unresolved(
        `reported_earnings_claim_unresolved:${year}`,
        distinct([...parent.facts, ...direct.facts]),
      );
    if (isExact(direct)) return direct;
    if (knownEquityClaim || otherAllocation)
      return unresolved(
        `reported_earnings_claim_unresolved:${year}`,
        distinct([...parent.facts, ...direct.facts, ...equityClaims.map((f) => f.id)]),
      );
    return { ...parent, facts: distinct([...parent.facts, ...equityClaims.map((f) => f.id)]) };
  }
  const allocation = read(c, allocationField, year);
  if (!isExact(parent) || !isExact(allocation) || allocation.low < 0)
    return {
      ...sum([parent, allocation]),
      low: -Infinity,
      high: Infinity,
      missing: distinct([
        ...parent.missing,
        ...allocation.missing,
        "reported_earnings_claim_unresolved",
      ]),
    };
  const adjustedValue = difference(parent, allocation);
  if (
    eligibleFacts(c, adjusted ? "adjustedOrdinaryProfit" : "ordinaryProfit", year).some(
      (f) => f.state !== "missing",
    ) &&
    (!isExact(direct) || direct.low !== adjustedValue.low)
  )
    return unresolved(
      `reported_earnings_claim_unresolved:${year}`,
      distinct([...adjustedValue.facts, ...direct.facts]),
    );
  return adjustedValue;
}
/** Only concrete financing outside the fixed columns requires reconciliation.
 * A sourced absence or zero is auxiliary evidence and cannot create a new gate. */
function reportedFinancingConflicts(c: CompanyFacts, year: number): FinancialFact[] {
  return [
    "classification.financingNotesPayable",
    "classification.noncurrentFinancingPayables",
    "classification.otherFinancingLiabilities",
    "additionalFinancing",
  ]
    .flatMap((field) => eligibleFacts(c, field, year))
    .filter((f) => {
      if (f.state === "missing") return false;
      if (f.field === "additionalFinancing")
        return !isExact(read(c, f.field, year)) || read(c, f.field, year).low !== 0;
      try {
        const value = JSON.parse(String(f.value));
        if (f.state !== "observed") return true;
        if (
          value.state === "absent" &&
          Array.isArray(value.components) &&
          value.components.length === 0
        )
          return false;
        return (
          value.state !== "components" ||
          !Array.isArray(value.components) ||
          !value.components.length ||
          value.components.some((field: string) => {
            const q = read(c, field, year);
            return !isExact(q) || q.low !== 0;
          })
        );
      } catch {
        return true;
      }
    });
}

const insuranceServiceFields = [
  "insurance.serviceRevenue",
  "insurance.serviceExpense",
  "insurance.reinsuranceAllocation",
  "insurance.reinsuranceRecovery",
];
const insuranceServiceAlgorithm =
  "insurance-service-after-reinsurance-v1:sum(signed-consolidated-statement-operands)";
/** Four explicitly signed annual statement amounts; never a liability movement total. */
function insuranceServiceOperands(c: CompanyFacts, year: number): Quantity {
  const amounts = insuranceServiceFields.map((field) => read(c, field, year));
  const facts = insuranceServiceFields.flatMap((field) => eligibleFacts(c, field, year));
  if (
    facts.some((f) => f.state !== "observed") ||
    !amounts.every(isExact) ||
    amounts[0].low < 0 ||
    amounts[1].low > 0 ||
    amounts[2].low > 0 ||
    amounts[3].low < 0
  )
    return unresolved(
      `insurance_service_statement_unresolved:${year}`,
      facts.map((f) => f.id),
    );
  // At least one complete statement must support the quartet. Do not splice
  // unrelated reports into an apparently complete annual statement.
  const sources = insuranceServiceFields.map(
    (field) =>
      new Set(eligibleFacts(c, field, year).flatMap((f) => f.evidence.map((e) => e.sourceId))),
  );
  if (![...sources[0]].some((id) => sources.every((ids) => ids.has(id))))
    return unresolved(
      `insurance_service_statement_sources_unmatched:${year}`,
      facts.map((f) => f.id),
    );
  return sum(amounts);
}
/** Derived facts retain their observed operands and exact formula. */
function deriveCompanyFacts(c: CompanyFacts): FinancialFact[] {
  c = { ...c, facts: [...c.facts] };
  const derived: FinancialFact[] = [];
  const record = (field: string, year: number, q: Quantity, annual: boolean, algorithm: string) => {
    if (!isExact(q) || eligibleFacts(c, field, year).some((f) => f.state !== "missing")) return;
    const operands = c.facts.filter((f) => q.facts.includes(f.id));
    const result: FinancialFact = {
      id: `derived:${c.companyId}:${field}:${year}`,
      field,
      entity: c.companyId,
      year,
      period: { start: `${year}-${annual ? "01-01" : "12-31"}`, end: `${year}-12-31` },
      publishedAt: operands
        .map((f) => f.publishedAt)
        .sort((a, b) => Date.parse(a) - Date.parse(b))
        .at(-1)!,
      basis: c.basis,
      unit: c.currency,
      state: "derived",
      value: q.low,
      evidence: operands.flatMap((f) => f.evidence),
      derivation: { algorithm, inputs: q.facts },
    };
    derived.push(result);
    c.facts.push(result);
  };
  const absence = (field: string, year: number, annual: boolean): Quantity => {
    const facts = eligibleFacts(c, field, year);
    const valid =
      facts.length > 0 &&
      facts.every(
        (f) =>
          f.state === "observed" &&
          f.value === true &&
          f.unit === "boolean" &&
          f.evidence.length > 0 &&
          f.period.end === `${year}-12-31` &&
          f.period.start === `${year}-${annual ? "01-01" : "12-31"}`,
      );
    return valid
      ? { ...exact(0), facts: facts.map((f) => f.id) }
      : unresolved(
          `${field}:${year}`,
          facts.map((f) => f.id),
        );
  };
  for (let year = c.latestFiscalYear - 7; year <= c.latestFiscalYear; year++) {
    for (const field of reportedDebtComponents) {
      record(
        field,
        year,
        absence(`${field}AbsentAtYearEnd`, year, false),
        false,
        `reported-absence-v1:${field}AbsentAtYearEnd`,
      );
    }
    record(
      "insurance.serviceResult",
      year,
      insuranceServiceOperands(c, year),
      true,
      insuranceServiceAlgorithm,
    );
    const fixed = reportedDebtComponents.map((field) => read(c, field, year));
    const supplementalFacts = eligibleFacts(c, "otherReportedInterestDebt", year);
    const supplemental = supplementalFacts.length
      ? read(c, "otherReportedInterestDebt", year)
      : exact(0);
    const financingConflicts = reportedFinancingConflicts(c, year);
    if ([...fixed, supplemental].every(isExact) && !financingConflicts.length)
      record(
        "reportedDebt",
        year,
        sum([...fixed, supplemental]),
        false,
        `D_reported-v1:sum(${[...reportedDebtComponents, ...(supplementalFacts.length ? ["otherReportedInterestDebt"] : [])].join(",")})`,
      );
  }
  return derived;
}
/** D_reported is the fixed set of report columns plus a sourced supplemental item when present. */
function reportedDebt(c: CompanyFacts, year: number): Quantity {
  if (c.checks.financing?.state === "unresolved" && c.checks.financing.evidence.length)
    return unresolved("reported_financing_scope_conflict", c.checks.financing.evidence);
  const supplied = read(c, "reportedDebt", year);
  if (isExact(supplied) || eligibleFacts(c, "reportedDebt", year).length) return supplied;
  const fixed = reportedDebtComponents.map((field) => {
    const q = read(c, field, year);
    return isExact(q) ? q : { ...q, low: Math.max(0, q.low) };
  });
  const supplementalFacts = eligibleFacts(c, "otherReportedInterestDebt", year);
  const financingConflicts = reportedFinancingConflicts(c, year);
  if (financingConflicts.length)
    return unresolved(
      "reported_financing_scope_conflict",
      distinct([...fixed.flatMap((q) => q.facts), ...financingConflicts.map((f) => f.id)]),
    );
  const supplemental = supplementalFacts.length
    ? read(c, "otherReportedInterestDebt", year)
    : exact(0);
  return sum([...fixed, supplemental]);
}
/** A total-liabilities peer can bound incomplete report debt, but never replace it. */
function boundedReportedDebt(c: CompanyFacts, year: number): Quantity {
  const direct = reportedDebt(c, year);
  if (c.method.value !== "nonfinancial" || c.checks.financing?.state === "unresolved")
    return direct;
  const conflicts = reportedFinancingConflicts(c, year);
  if (conflicts.length)
    return unresolved(
      "reported_financing_scope_conflict",
      conflicts.map((f) => f.id),
    );
  const contexts = eligibleFacts(c, "balance.consolidatedContext", year).filter((f) => {
    if (
      f.state !== "observed" ||
      f.unit !== "text" ||
      typeof f.value !== "string" ||
      !f.evidence.length ||
      f.period.start !== `${year}-12-31` ||
      f.period.end !== `${year}-12-31`
    )
      return false;
    try {
      const v = JSON.parse(f.value);
      return v.contract === "eastmoney_annual_consolidated_balance_v1" && typeof v.row === "string";
    } catch {
      return false;
    }
  });
  const liabilities = read(c, "liabilities", year);
  if (!isExact(liabilities) || !contexts.length) return direct;
  const peer = (context: FinancialFact) => {
    try {
      const row = JSON.parse(String(context.value)).row;
      return liabilities.facts.some((id) =>
        c.facts
          .find((f) => f.id === id)
          ?.evidence.some(
            (e) =>
              e.sourceId === context.evidence[0]!.sourceId &&
              e.locator === `${row}/TOTAL_LIABILITIES`,
          ),
      );
    } catch {
      return false;
    }
  };
  const context = contexts.find(peer);
  if (!context) return direct;
  if (isExact(direct))
    return direct.low > liabilities.low
      ? unresolved(
          "reported_debt_liability_bound_conflict",
          distinct([...direct.facts, ...liabilities.facts, context.id]),
        )
      : direct;
  const unreliable = ["reportedDebt", ...reportedDebtComponents, "otherReportedInterestDebt"].some(
    (field) =>
      eligibleFacts(c, field, year).some((f) => f.state !== "missing") &&
      !isExact(read(c, field, year)),
  );
  if (unreliable) return direct;
  // Rebuild only the known lower bound; missing components remain missing and
  // no derived D_reported value is fabricated from the liability total.
  const fixed = reportedDebtComponents.map((field) => {
    const q = read(c, field, year);
    return isExact(q) ? q : { ...q, low: Math.max(0, q.low) };
  });
  const supplementalFacts = eligibleFacts(c, "otherReportedInterestDebt", year);
  const supplemental = supplementalFacts.length
    ? read(c, "otherReportedInterestDebt", year)
    : exact(0);
  const lower = sum([...fixed, supplemental]);
  // Each amount must have a peer in the bound's statement row. Agreeing
  // corroborating copies may come from another captured response; read() above
  // has already rejected differences in value, period, unit or state.
  // A verified zero adds no debt, so a same-scope absence disclosure needs no row peer.
  const peerDebtFacts = [...fixed, supplemental].every(
    (q) =>
      (isExact(q) && q.low === 0) ||
      !q.facts.length ||
      q.facts.some((id) => {
        const f = c.facts.find((candidate) => candidate.id === id);
        try {
          const row = JSON.parse(String(context.value)).row;
          return !!f?.evidence.some(
            (e) => e.sourceId === context.evidence[0]!.sourceId && e.locator.startsWith(`${row}/`),
          );
        } catch {
          return false;
        }
      }),
  );
  if (!peerDebtFacts) return direct;
  if (lower.low > liabilities.low)
    return unresolved(
      "reported_debt_liability_bound_conflict",
      distinct([...lower.facts, ...liabilities.facts, context.id]),
    );
  return {
    ...lower,
    high: liabilities.low,
    facts: distinct([...lower.facts, ...liabilities.facts, context.id]),
  };
}
interface RegulatoryPeriod {
  context: RegulatoryContext;
  factIds: string[];
  date: string;
}
function regulatoryPeriod(
  c: CompanyFacts,
  reportYear: number,
  position: "closing" | "opening" = "closing",
): RegulatoryPeriod | undefined {
  const year = position === "closing" ? reportYear : reportYear - 1;
  const candidates = eligibleFacts(c, "regulatory.context", year).filter((f) => {
    try {
      const v = JSON.parse(String(f.value));
      return v.reportYear === reportYear && v.position === position;
    } catch {
      return false;
    }
  });
  if (!candidates.length || new Set(candidates.map((f) => f.value)).size !== 1) return;
  const date = `${year}-12-31`;
  if (
    candidates.some(
      (f) =>
        f.state !== "observed" ||
        f.unit !== "text" ||
        !f.evidence.length ||
        f.period.start !== date ||
        f.period.end !== date,
    )
  )
    return;
  const parsed = regulatoryContextSchema.safeParse(JSON.parse(String(candidates[0].value)));
  if (!parsed.success || parsed.data.subject !== c.companyId) return;
  return { context: parsed.data, factIds: candidates.map((f) => f.id), date };
}
function regulatoryAmount(
  c: CompanyFacts,
  p: RegulatoryPeriod,
  metric: string,
  kind: "actual" | "requirement",
): Quantity {
  const binding = p.context.metrics[metric];
  const id = kind === "actual" ? binding?.actualFactId : binding?.requirementFactId;
  const definition =
    regulatoryMetricDefinitions[metric as keyof typeof regulatoryMetricDefinitions];
  if (!id || !definition || binding.definition !== definition)
    return unresolved(`regulatory_${kind}_unresolved:${metric}:${p.date}`, p.factIds);
  const facts = c.facts.filter((f) => f.id === id);
  const f = facts[0];
  const usable =
    facts.length === 1 &&
    f.entity === c.companyId &&
    f.basis === c.basis &&
    f.field === `regulatory.${kind}.${metric}` &&
    f.state === "observed" &&
    f.unit === (["netCapital", "ownSettlementReserve"].includes(metric) ? c.currency : "ratio") &&
    typeof f.value === "number" &&
    Number.isFinite(f.value) &&
    (f.value >= 0 ||
      (kind === "actual" &&
        [
          "coreSolvency",
          "comprehensiveSolvency",
          "netCapital",
          "netCapitalEquity",
          "futuresRiskCoverage",
          "trustRiskCoverage",
        ].includes(metric))) &&
    f.evidence.length > 0 &&
    f.period.start === p.date &&
    f.period.end === p.date &&
    f.year === Number(p.date.slice(0, 4)) &&
    Date.parse(f.publishedAt) <= Date.parse(c.asOf);
  return usable
    ? { ...exact(f.value as number), facts: [...p.factIds, f.id] }
    : unresolved(`regulatory_${kind}_unresolved:${metric}:${p.date}`, [
        ...p.factIds,
        ...facts.map((f) => f.id),
      ]);
}
/** Only machine-rounding tolerance, never a disclosure-precision allowance or a relaxed threshold. */
function compareRegulatory(
  id: string,
  q: Quantity,
  operator: ">=" | ">" | "<=" | "<",
  target: number,
  formula: string,
): ConditionResult {
  const result = compare(id, q, operator, target, formula);
  if (
    isExact(q) &&
    Math.abs(q.low - target) <= Number.EPSILON * 8 * Math.max(1, Math.abs(q.low), Math.abs(target))
  )
    result.state = operator === ">" || operator === "<" ? "fail" : "pass";
  return result;
}
function regulatoryCondition(
  c: CompanyFacts,
  p: RegulatoryPeriod,
  metric: string,
  id: string,
  rule: {
    direction: "minimum" | "maximum";
    absolute?: number;
    margin?: number;
    multiple?: number;
    requirementKind?: "regulatory" | "warning";
    requirement?: "required" | "optional_when_present";
    strict?: boolean;
  },
  actualOverride?: Quantity,
): ConditionResult {
  const actual = actualOverride ?? regulatoryAmount(c, p, metric, "actual");
  const binding = p.context.metrics[metric];
  if (!binding || binding.direction !== rule.direction)
    return { ...pending(id, `regulatory_direction_unresolved:${metric}`), factIds: actual.facts };
  const components: ConditionResult[] = [];
  if (rule.absolute !== undefined)
    components.push(
      compareRegulatory(
        `${id}.absolute`,
        actual,
        rule.direction === "minimum" ? ">=" : "<=",
        rule.absolute,
        `${metric}: disclosed actual value`,
      ),
    );
  const requirementRequired = rule.requirement !== "optional_when_present";
  // Candidate floors/ceilings are independently meaningful. A disclosed
  // individual requirement still constrains them, but its absence is not proof
  // that no numeric regulatory requirement exists.
  if (!requirementRequired && !binding.requirementFactId) return group(id, components);
  const requirement =
    rule.requirementKind && binding.requirementKind !== rule.requirementKind
      ? unresolved(
          `regulatory_requirement_kind_unresolved:${metric}:${rule.requirementKind}`,
          p.factIds,
        )
      : regulatoryAmount(c, p, metric, "requirement");
  const exemptions = c.facts.filter((f) => f.id === binding.requirementFactId);
  const e = exemptions[0];
  const noNumericLimit =
    !requirementRequired &&
    ["loanNpl", "leaseNpl"].includes(metric) &&
    exemptions.length === 1 &&
    e.field === `regulatory.requirement.${metric}` &&
    e.entity === c.companyId &&
    e.basis === c.basis &&
    e.state === "not_applicable" &&
    e.unit === "text" &&
    e.value === undefined &&
    e.reason === "no_applicable_numeric_requirement" &&
    e.evidence.length > 0 &&
    e.period.start === p.date &&
    e.period.end === p.date &&
    e.year === Number(p.date.slice(0, 4)) &&
    Date.parse(e.publishedAt) <= Date.parse(c.asOf);
  if (noNumericLimit) return group(id, components);
  else if (
    !isExact(requirement) ||
    requirement.low < 0 ||
    (requirement.low === 0 && metric !== "ownSettlementReserve")
  )
    components.push({
      ...pending(`${id}.requirement`, `regulatory_requirement_unresolved:${metric}:${p.date}`),
      factIds: distinct([...actual.facts, ...requirement.facts]),
      ...(isExact(actual) ? { value: actual.low } : {}),
      formula: `${metric}: disclosed actual value; applicable requirement unresolved`,
    });
  else {
    const threshold = requirement.low * (rule.multiple ?? 1) + (rule.margin ?? 0);
    const q = { ...actual, facts: distinct([...actual.facts, ...requirement.facts]) };
    const operator =
      rule.direction === "minimum" ? (rule.strict ? ">" : ">=") : rule.strict ? "<" : "<=";
    components.push(
      compareRegulatory(
        `${id}.requirement`,
        q,
        operator,
        threshold,
        `${metric}: actual ${operator} applicable ${rule.requirementKind ?? "regulatory"} requirement${rule.multiple ? ` * ${rule.multiple}` : ""}${rule.margin ? ` + ${rule.margin} percentage-point ratio` : ""}`,
      ),
    );
  }
  return group(id, components);
}
/** Validated provider credit ratios are reported observations, not claims about
 * a legal-entity/consolidated regulatory scope or a complete capital regime. */
function reportedCredit(
  c: CompanyFacts,
  policy: CnPolicy,
  reportYear: number,
  id: string,
): ConditionResult[] {
  const lease = c.method.value === "financial_lease";
  const npl = lease ? "leaseNpl" : "loanNpl",
    provision = lease ? "leaseProvisionCoverage" : "loanProvisionCoverage";
  const ratio = (metric: string, year: number) =>
    read(c, `reportedFinancial.${metric}`, year, "ratio");
  const current = (
    metric: string,
    direction: "maximum" | "minimum",
    threshold: number,
  ): ConditionResult => {
    const value = ratio(metric, reportYear),
      operator = direction === "maximum" ? "<=" : ">=";
    const absolute = compareRegulatory(
      `${id}.${metric}`,
      value,
      operator,
      threshold,
      `reported ${lease ? "finance-lease" : "bank"} ${metric} ratio`,
    );
    const field = `reportedFinancial.requirement.${metric}`,
      requirements = eligibleFacts(c, field, reportYear);
    if (!requirements.length) return absolute;
    const requirement = ratio(`requirement.${metric}`, reportYear);
    const valid =
      isExact(requirement) &&
      requirement.low > 0 &&
      requirements.every((f) => f.reason?.split(";").includes(`direction:${direction}`));
    const applied = valid
      ? compareRegulatory(
          `${id}.${metric}.requirement`,
          { ...value, facts: distinct([...value.facts, ...requirement.facts]) },
          operator,
          requirement.low,
          "reported credit ratio against disclosed current requirement",
        )
      : {
          ...pending(`${id}.${metric}.requirement`, "reported_credit_requirement_unresolved"),
          factIds: requirement.facts,
        };
    return group(`${id}.${metric}`, [{ ...absolute, id: `${absolute.id}.absolute` }, applied]);
  };
  const conditions = [
    current(npl, "maximum", policy.financial.nplCeiling),
    current(provision, "minimum", policy.financial.provisionCoverage),
  ];
  if (id === "F.risk") {
    const values = [reportYear - 2, reportYear - 1, reportYear].map((year) => ratio(npl, year));
    conditions.push(
      values.every(isExact)
        ? {
            ...compareRegulatory(
              `${id}.nplTrend`,
              difference(values[2], values[0]),
              "<=",
              policy.financial.nplIncrease,
              "latest reported NPL ratio - earliest of three consecutive year ends",
            ),
            factIds: distinct(values.flatMap((q) => q.facts)),
          }
        : {
            ...pending(`${id}.nplTrend`, "reported_credit_history_missing"),
            factIds: distinct(values.flatMap((q) => q.facts)),
            missing: distinct(values.flatMap((q) => q.missing)),
          },
    );
  }
  return conditions;
}
/** Bank LCR/NSFR values in an issuer report can be evaluated without claiming
 * that a separately disclosed capital context has the same subject or scope. */
function reportedBankLiquidity(
  c: CompanyFacts,
  policy: CnPolicy,
  reportYear: number,
  id: string,
): ConditionResult[] {
  const ratio = (metric: string) => read(c, `reportedFinancial.${metric}`, reportYear, "ratio");
  return (["lcr", "nsfr"] as const).map((metric) => {
    const value = ratio(metric),
      threshold = metric === "lcr" ? policy.financial.bankLcr : policy.financial.bankNsfr;
    const absolute = compareRegulatory(
      `${id}.${metric}`,
      value,
      ">=",
      threshold,
      `reported bank ${metric} ratio`,
    );
    const requirements = eligibleFacts(c, `reportedFinancial.requirement.${metric}`, reportYear);
    if (!requirements.length) return absolute;
    const requirement = ratio(`requirement.${metric}`);
    const valid =
      isExact(requirement) &&
      requirement.low > 0 &&
      requirements.every((f) => f.reason?.split(";").includes("direction:minimum"));
    const applied = valid
      ? compareRegulatory(
          `${id}.${metric}.requirement`,
          { ...value, facts: distinct([...value.facts, ...requirement.facts]) },
          ">=",
          requirement.low,
          "reported bank liquidity ratio against disclosed current requirement",
        )
      : {
          ...pending(`${id}.${metric}.requirement`, "reported_liquidity_requirement_unresolved"),
          factIds: requirement.facts,
        };
    return group(`${id}.${metric}`, [{ ...absolute, id: `${absolute.id}.absolute` }, applied]);
  });
}
function hasRegulatoryContext(c: CompanyFacts, year: number): boolean {
  return eligibleFacts(c, "regulatory.context", year).length > 0;
}
function contextBindsLiquidity(p: RegulatoryPeriod, metric: "lcr" | "nsfr"): boolean {
  return p.context.liquidityMetrics.includes(metric) || !!p.context.metrics[metric];
}
function financialRisk(
  c: CompanyFacts,
  policy: CnPolicy,
  reportYear = c.latestFiscalYear,
  id = "F.risk",
): ConditionResult {
  const p = regulatoryPeriod(c, reportYear);
  if (!p) {
    // Absence of a capital/liquidity context must not hide usable API credit
    // facts. Conflicting/invalid supplied contexts do not take this fallback.
    if (
      ["bank", "financial_lease"].includes(c.method.value!) &&
      !hasRegulatoryContext(c, reportYear)
    ) {
      const liquidity =
        c.method.value === "bank" ? reportedBankLiquidity(c, policy, reportYear, id) : [];
      return group(id, [
        ...(id === "F.risk" ? reportedCredit(c, policy, reportYear, id) : []),
        ...liquidity,
        ...(liquidity.some(
          (condition) => condition.state === "unknown" || condition.state === "not_evaluated",
        )
          ? [pending(`${id}.liquidity`, "liquidity_regime_unresolved")]
          : []),
        pending(`${id}.capital`, `regulatory_context_missing:${reportYear}:closing`),
      ]);
    }
    return pending(id, `regulatory_context_missing:${reportYear}:closing`);
  }
  const f = policy.financial;
  const conditions: ConditionResult[] = [];
  if (c.method.value === "broker") {
    const points = [p];
    if (id === "F.risk") {
      const opening = regulatoryPeriod(c, reportYear, "opening");
      if (!opening) conditions.push(pending(`${id}.opening`, "regulatory_opening_missing"));
      else {
        points.push(opening);
        if (
          opening.context.scope !== p.context.scope ||
          opening.context.comparisonBasis !== p.context.comparisonBasis
        )
          conditions.push(pending(`${id}.comparability`, "regulatory_opening_not_comparable"));
      }
    }
    for (const point of points) {
      const prefix = `${id}.${point.context.position}`;
      conditions.push(
        regulatoryCondition(c, point, "riskCoverage", `${prefix}.riskCoverage`, {
          direction: "minimum",
          absolute: f.brokerRiskCoverage,
          requirement: "optional_when_present",
        }),
      );
      for (const name of ["capitalLeverage", "lcr", "nsfr"])
        conditions.push(
          regulatoryCondition(c, point, name, `${prefix}.${name}`, {
            direction: "minimum",
            multiple: f.brokerRelativeMargin,
          }),
        );
      if (
        !["lcr", "nsfr"].every((name) => point.context.liquidityMetrics.includes(name)) ||
        point.context.liquidityMetrics.some((name) => !["lcr", "nsfr"].includes(name))
      )
        conditions.push(pending(`${prefix}.liquidity`, "liquidity_regime_unresolved"));
    }
    return group(id, conditions);
  }
  const metric = (name: string, rule: Parameters<typeof regulatoryCondition>[4]) =>
    conditions.push(regulatoryCondition(c, p, name, `${id}.${name}`, rule));
  if (c.method.value === "futures") {
    if (
      p.context.scope !== "legal_entity" ||
      p.context.assetScope !== "own_funds_excluding_client_assets"
    )
      return { ...pending(id, "proprietary_regulatory_scope_unresolved"), factIds: p.factIds };
    metric("futuresRiskCoverage", {
      direction: "minimum",
      absolute: f.futuresRiskCoverage,
      requirementKind: "regulatory",
      requirement: "optional_when_present",
    });
    for (const name of ["netCapital", "netCapitalEquity", "ownLiquidityRatio"])
      metric(name, { direction: "minimum", requirementKind: "warning", strict: true });
    metric("ownDebtEquity", { direction: "maximum", requirementKind: "warning", strict: true });
    metric("ownSettlementReserve", { direction: "minimum", requirementKind: "regulatory" });
    return group(id, conditions);
  }
  if (c.method.value === "trust") {
    if (
      p.context.scope !== "legal_entity" ||
      p.context.assetScope !== "proprietary_excluding_trust_assets"
    )
      return { ...pending(id, "proprietary_regulatory_scope_unresolved"), factIds: p.factIds };
    metric("trustRiskCoverage", {
      direction: "minimum",
      absolute: f.trustRiskCoverage,
      requirementKind: "regulatory",
      requirement: "optional_when_present",
    });
    metric("netCapitalEquity", {
      direction: "minimum",
      absolute: f.trustCapitalEquity,
      requirementKind: "regulatory",
      requirement: "optional_when_present",
    });
    return group(id, conditions);
  }
  const lease = c.method.value === "financial_lease";
  const npl = lease ? "leaseNpl" : "loanNpl";
  const credit = id !== "F.risk" ? [] : reportedCredit(c, policy, reportYear, id);
  const reportedLiquidity =
    c.method.value === "bank" ? reportedBankLiquidity(c, policy, reportYear, id) : [];
  // P2 repeats capital/liquidity at three year ends. Credit keeps the base
  // window; historical provision coverage is not an extra opportunity gate.
  if (id === "F.risk") {
    if (!p.context.metrics[npl]) conditions.push(credit[0]);
    else
      metric(npl, {
        direction: "maximum",
        absolute: f.nplCeiling,
        requirement: "optional_when_present",
      });
    if (!p.context.metrics[lease ? "leaseProvisionCoverage" : "loanProvisionCoverage"])
      conditions.push(credit[1]);
    else
      metric(lease ? "leaseProvisionCoverage" : "loanProvisionCoverage", {
        direction: "minimum",
        absolute: f.provisionCoverage,
        requirement: "optional_when_present",
      });
  }
  for (const name of lease ? ["cet1", "tier1", "totalCapital"] : ["cet1", "totalCapital"])
    metric(name, { direction: "minimum", margin: f.capitalMargin });
  const boundLiquidity = lease
    ? p.context.liquidityMetrics
    : [
        ...new Set([
          ...p.context.liquidityMetrics,
          ...(["lcr", "nsfr"] as const).filter((name) => contextBindsLiquidity(p, name)),
        ]),
      ];
  if (lease && !boundLiquidity.length)
    conditions.push(pending(`${id}.liquidity`, "liquidity_regime_unresolved"));
  for (const name of boundLiquidity) {
    if (lease && ["lcr", "nsfr", "liquidityRatio"].includes(name))
      metric(name, { direction: "minimum", multiple: f.leaseLiquidityRelativeMargin });
    else if (name === "lcr" || name === "nsfr")
      metric(name, {
        direction: "minimum",
        absolute: name === "lcr" ? f.bankLcr : f.bankNsfr,
        requirement: "optional_when_present",
      });
    else conditions.push(pending(`${id}.${name}`, "liquidity_method_pending"));
  }
  if (!lease)
    for (const name of ["lcr", "nsfr"] as const) {
      // A related binding (including a malformed one) must be resolved through
      // that binding, never bypassed by a parallel reported value.
      if (!contextBindsLiquidity(p, name))
        conditions.push(reportedLiquidity.find((condition) => condition.id === `${id}.${name}`)!);
    }
  if (id === "F.risk") {
    const periods = [reportYear - 2, reportYear - 1, reportYear].map((y) => regulatoryPeriod(c, y));
    const reportedHistory = periods.every(
      (q, i) =>
        !q?.context.metrics[npl] &&
        (q || !eligibleFacts(c, "regulatory.context", reportYear - 2 + i).length),
    );
    if (reportedHistory)
      conditions.push(credit.find((condition) => condition.id === `${id}.nplTrend`)!);
    else if (
      periods.some((q) => !q) ||
      periods.some(
        (q) =>
          q!.context.scope !== p.context.scope ||
          q!.context.comparisonBasis !== p.context.comparisonBasis,
      )
    )
      conditions.push(pending(`${id}.nplTrend`, "credit_history_not_comparable"));
    else {
      const amounts = periods.map((q) => regulatoryAmount(c, q!, npl, "actual"));
      conditions.push(
        amounts.every(isExact)
          ? compareRegulatory(
              `${id}.nplTrend`,
              difference(amounts[2], amounts[0]),
              "<=",
              f.nplIncrease,
              "latest NPL ratio - earliest NPL ratio in three year-end observations",
            )
          : {
              ...pending(`${id}.nplTrend`, "credit_history_missing"),
              factIds: distinct(amounts.flatMap((q) => q.facts)),
            },
      );
    }
  }
  return group(id, conditions);
}
/** The primary route and each metric's own scope determine applicability.
 * A segment inventory supplies observations, never a second company filter. */
function companyBusinessScope(c: CompanyFacts): ConditionResult {
  return {
    ...pending("F.scope", "company_level_method_scope", "not_applicable"),
    factIds: c.method.evidence,
  };
}
function scopeObservations(c: CompanyFacts): ConditionResult[] {
  const segments = c.facts.filter(
    (f) =>
      f.field === "business.segments" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const observations: ConditionResult[] = segments.map((f, index) => {
    let reason = "reported_segments_observation_only";
    if (f.year !== c.latestFiscalYear)
      reason = "historical_segments_not_required_for_current_qualification";
    else {
      try {
        if (
          f.state !== "observed" ||
          f.unit !== "text" ||
          !f.evidence.length ||
          f.period.start !== `${f.year}-01-01` ||
          f.period.end !== `${f.year}-12-31`
        )
          throw new Error("invalid segment context");
        businessSegmentsSchema.parse(JSON.parse(String(f.value)));
        if (new Set(segments.filter((x) => x.year === f.year).map((x) => x.value)).size !== 1)
          reason = "conflicting_segment_observations_not_used";
      } catch {
        reason = "invalid_segment_observation_not_used";
      }
    }
    return {
      ...pending(`O.segments.${f.year}.${index}`, reason, "not_evaluated"),
      factIds: [f.id],
      formula: "Auxiliary disclosure; not a required company-level condition",
    };
  });
  const children = c.facts.filter(
    (f) =>
      f.entity !== c.companyId &&
      f.basis === c.basis &&
      /^(insurance|regulatory)\./.test(f.field) &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  if (children.length)
    observations.push({
      ...pending(
        "O.subsidiaries",
        "subsidiary_details_not_used_as_group_qualification",
        "not_evaluated",
      ),
      factIds: children.map((f) => f.id),
      formula:
        "Supplied subsidiary details are retained for research; they do not certify a material impact on the screened company",
    });
  return observations;
}
/** A sourced adverse scope assessment applies to the affected company metric.
 * Missing optional scope reviews do not create a new proof requirement. */
function knownCapitalScopeConflict(c: CompanyFacts): ConditionResult | undefined {
  const check = c.checks.capital;
  if (check?.state === "unresolved" && check.evidence.length)
    return {
      ...pending("F.risk.scope", "known_company_capital_scope_conflict"),
      factIds: check.evidence,
    };
}

interface InsurancePeriod {
  context: InsuranceContext;
  factIds: string[];
  year: number;
}
function insurancePeriod(c: CompanyFacts, year: number): InsurancePeriod | undefined {
  const facts = eligibleFacts(c, "insurance.context", year);
  if (
    !facts.length ||
    new Set(facts.map((f) => f.value)).size !== 1 ||
    facts.some(
      (f) =>
        f.state !== "observed" ||
        f.unit !== "text" ||
        !f.evidence.length ||
        f.period.start !== `${year}-01-01` ||
        f.period.end !== `${year}-12-31`,
    )
  )
    return;
  try {
    const parsed = insuranceContextSchema.safeParse(JSON.parse(String(facts[0].value)));
    if (parsed.success && parsed.data.subject === c.companyId && parsed.data.reportYear === year)
      return {
        context: parsed.data,
        factIds: distinct([
          ...facts.map((f) => f.id),
          ...eligibleFacts(c, "insurance.accountingBasis", year).map((f) => f.id),
        ]),
        year,
      };
  } catch {
    /* Invalid sourced context remains unknown. */
  }
}
interface InsuranceReturnBasis {
  standard: string;
  factIds: string[];
}
/** Annual accounting facts certify return comparability independently of operating or capital context. */
function insuranceReturnBasis(c: CompanyFacts, year: number): InsuranceReturnBasis | undefined {
  const facts = eligibleFacts(c, "insurance.accountingBasis", year);
  const contextFacts = eligibleFacts(c, "insurance.context", year);
  if (
    !facts.length ||
    facts.some(
      (f) =>
        f.state !== "observed" ||
        f.unit !== "text" ||
        !f.evidence.length ||
        f.period.start !== `${year}-01-01` ||
        f.period.end !== `${year}-12-31`,
    )
  )
    return;
  const standards = distinct(facts.map((f) => String(f.value)));
  if (standards.length !== 1 || !["CAS25-2023", "IFRS17"].includes(standards[0])) return;
  // A supplied context remains evidence: it may not contradict the independent
  // annual basis, but its operating and capital bindings are irrelevant here.
  if (contextFacts.length) {
    const context = insurancePeriod(c, year);
    if (
      !context ||
      context.context.accountingStandard !== standards[0] ||
      (context.context.accountingBasisFactId !== undefined &&
        !facts.some((f) => f.id === context.context.accountingBasisFactId))
    )
      return;
  }
  return {
    standard: standards[0],
    factIds: distinct([...facts.map((f) => f.id), ...contextFacts.map((f) => f.id)]),
  };
}
function insuranceReturnBases(
  c: CompanyFacts,
  years = [c.latestFiscalYear - 2, c.latestFiscalYear - 1, c.latestFiscalYear],
): InsuranceReturnBasis[] | undefined {
  const bases = years.map((year) => insuranceReturnBasis(c, year));
  if (
    !bases.every((basis): basis is InsuranceReturnBasis => !!basis) ||
    new Set(bases.map((basis) => basis.standard)).size !== 1
  )
    return;
  const contexts = years
    .map((year) => insurancePeriod(c, year))
    .filter((context): context is InsurancePeriod => !!context);
  const kind =
    c.method.value === "pc_insurance"
      ? "pc"
      : c.method.value === "life_insurance"
        ? "life"
        : "group";
  if (
    contexts.some((context) => context.context.kind !== kind) ||
    new Set(
      contexts.map((context) =>
        JSON.stringify([
          context.context.kind,
          context.context.scope,
          context.context.comparisonBasis,
        ]),
      ),
    ).size > 1
  )
    return;
  return bases;
}
function insuranceReturnFactIds(c: CompanyFacts, years: number[]): string[] {
  return distinct(
    years.flatMap((year) =>
      ["insurance.accountingBasis", "insurance.context"].flatMap((field) =>
        eligibleFacts(c, field, year).map((f) => f.id),
      ),
    ),
  );
}
function insuranceAccountingBasis(c: CompanyFacts, p: InsurancePeriod): boolean {
  const basis = insuranceReturnBasis(c, p.year),
    id = p.context.accountingBasisFactId;
  return (
    !!id && !!basis && basis.standard === p.context.accountingStandard && basis.factIds.includes(id)
  );
}
/** Five reported annual profits retain their original accounting break; returns never use this bridge. */
function insuranceReportedProfit(c: CompanyFacts, year: number): Quantity {
  const candidates = c.facts.filter(
    (f) =>
      f.field === "parentProfit" &&
      f.entity === c.companyId &&
      f.year === year &&
      f.state !== "missing" &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const bases = distinct(candidates.map((f) => f.basis));
  return bases.length === 1
    ? read({ ...c, basis: bases[0] }, "parentProfit", year)
    : unresolved(
        `reported_profit_basis_unresolved:${year}`,
        candidates.map((f) => f.id),
      );
}
function insuranceOperand(
  c: CompanyFacts,
  p: InsurancePeriod,
  metric: keyof typeof insuranceOperatingDefinitions,
): Quantity {
  const binding = p.context.operating[metric];
  const candidates = c.facts.filter((f) => f.id === binding?.factId);
  const f = candidates[0];
  const unit = metric === "combinedRatio" ? "ratio" : c.currency;
  if (
    binding?.definition !== insuranceOperatingDefinitions[metric] ||
    candidates.length !== 1 ||
    f.entity !== c.companyId ||
    f.field !== `insurance.${metric}` ||
    f.basis !== c.basis ||
    f.year !== p.year ||
    f.period.start !== `${p.year}-01-01` ||
    f.period.end !== `${p.year}-12-31` ||
    f.state !== "observed" ||
    f.unit !== unit ||
    typeof f.value !== "number" ||
    !Number.isFinite(f.value) ||
    !f.evidence.length ||
    Date.parse(f.publishedAt) > Date.parse(c.asOf) ||
    ((metric === "combinedRatio" || metric === "combinedRatioDenominator") && f.value < 0)
  )
    return unresolved(`insurance_operand_unresolved:${c.companyId}:${metric}:${p.year}`, [
      ...p.factIds,
      ...candidates.map((f) => f.id),
    ]);
  const q = read(c, `insurance.${metric}`, p.year, unit);
  return { ...q, facts: distinct([...p.factIds, ...q.facts]) };
}
function insuranceOperating(c: CompanyFacts, policy: CnPolicy): ConditionResult {
  if (c.method.value === "insurance_group")
    return pending(
      "F.operating",
      "group_operating_covered_by_consolidated_returns",
      "not_applicable",
    );
  // A sourced life-insurance route and comparable consolidated statements can
  // establish operating performance without asserting a legal capital scope.
  if (
    c.method.value === "life_insurance" &&
    c.method.state === "applies" &&
    c.method.evidence.length &&
    ![c.latestFiscalYear - 2, c.latestFiscalYear - 1, c.latestFiscalYear].some(
      (y) => eligibleFacts(c, "insurance.context", y).length,
    )
  ) {
    const years = [c.latestFiscalYear - 2, c.latestFiscalYear - 1, c.latestFiscalYear];
    const bases = insuranceReturnBases(c, years);
    const comparable = !!bases && bases.every((basis) => basis.standard === "CAS25-2023");
    const evidence = distinct([
      ...c.method.evidence,
      ...(bases?.flatMap((basis) => basis.factIds) ?? insuranceReturnFactIds(c, years)),
    ]);
    if (!comparable)
      return {
        ...pending("F.operating", "insurance_service_statement_basis_unresolved"),
        factIds: evidence,
      };
    const service = years.map((y) => {
      const operands = insuranceServiceOperands(c, y),
        result = read(c, "insurance.serviceResult", y);
      return isExact(operands) && isExact(result) && operands.low === result.low
        ? { ...result, facts: distinct([...result.facts, ...operands.facts, ...evidence]) }
        : unresolved(
            `insurance_service_statement_unresolved:${y}`,
            distinct([...result.facts, ...operands.facts, ...evidence]),
          );
    });
    const id = `F.operating.${c.companyId}`;
    return group("F.operating", [
      group(id, [
        compare(
          `${id}.serviceTotal`,
          sum(service),
          ">",
          0,
          "sum(insurance service result after reinsurance,3y)",
        ),
        compare(
          `${id}.servicePositive`,
          positives(service),
          ">=",
          2,
          "count(insurance service result>0,3y)",
        ),
      ]),
    ]);
  }
  const subjects = [c];
  if (!subjects.length) return pending("F.operating", "insurance_operating_subjects_unresolved");
  return group(
    "F.operating",
    subjects.map((s) => {
      const id = `F.operating.${s.companyId}`;
      const periods = [s.latestFiscalYear - 2, s.latestFiscalYear - 1, s.latestFiscalYear].map(
        (y) => insurancePeriod(s, y),
      );
      if (
        periods.some((p) => !p || !insuranceAccountingBasis(s, p)) ||
        new Set(
          periods.map((p) =>
            JSON.stringify([
              p?.context.kind,
              p?.context.scope,
              p?.context.accountingStandard,
              p?.context.comparisonBasis,
            ]),
          ),
        ).size !== 1
      )
        return {
          ...pending(id, `insurance_operating_history_not_comparable:${s.companyId}`),
          factIds: distinct(periods.flatMap((p) => p?.factIds ?? [])),
        };
      const ps = periods as InsurancePeriod[];
      if (ps[0].context.kind === "life") {
        const service = ps.map((p) => insuranceOperand(s, p, "serviceResult"));
        return group(id, [
          compare(
            `${id}.serviceTotal`,
            sum(service),
            ">",
            0,
            "sum(insurance service result after reinsurance,3y)",
          ),
          compare(
            `${id}.servicePositive`,
            positives(service),
            ">=",
            2,
            "count(insurance service result>0,3y)",
          ),
        ]);
      }
      if (ps[0].context.kind !== "pc")
        return pending(id, `insurance_operating_method_pending:${s.companyId}`);
      const denominators = ps.map((p) => insuranceOperand(s, p, "combinedRatioDenominator"));
      const ratios = ps.map((p) => insuranceOperand(s, p, "combinedRatio"));
      const definition = ps[0].context.denominatorDefinition;
      const matching =
        !!definition && ps.every((p) => p.context.denominatorDefinition === definition);
      const weighted = denominators.every((q) => isExact(q) && q.low > 0)
        ? ratio(
            sum(ratios.map((q, i) => mapExact(q, (v) => v * denominators[i].low))),
            sum(denominators),
          )
        : unresolved(
            `combined_ratio_denominator_unresolved:${s.companyId}`,
            sum(denominators).facts,
          );
      weighted.facts = distinct([...weighted.facts, ...sum(denominators).facts]);
      return group(id, [
        compare(
          `${id}.underwriting`,
          sum(ps.map((p) => insuranceOperand(s, p, "underwritingResult"))),
          ">",
          0,
          "sum(underwriting result, comparable 3y)",
        ),
        matching
          ? compareRegulatory(
              `${id}.combinedRatio`,
              weighted,
              "<=",
              policy.insurance.combinedRatio,
              "sum(combined ratio * matching denominator)/sum(denominator),3y",
            )
          : pending(
              `${id}.combinedRatio`,
              `combined_ratio_definitions_not_comparable:${s.companyId}`,
            ),
        compareRegulatory(
          `${id}.latestCombinedRatio`,
          ratios[2],
          "<=",
          policy.insurance.latestCombinedRatio,
          "latest annual combined ratio",
        ),
      ]);
    }),
  );
}
/**
 * A missing rating is disclosed as unverified rather than treated as a passed
 * rating.  Conversely, a later usable adverse grade cannot be hidden by an
 * older favourable context binding.  The current risk check is the only place
 * where ratings apply; historical capital checks have no rating requirement.
 */
function insuranceRating(
  c: CompanyFacts,
  p: InsurancePeriod | undefined,
  id: string,
): ConditionResult {
  const binding = p?.context.rating;
  const cutoff = Date.parse(c.asOf.slice(0, 10));
  // Exclude known future disclosures; an invalid date is unresolved evidence,
  // not proof that an adverse observation lies outside the current window.
  const available = c.facts.filter(
    (f) =>
      f.field === "insurance.riskRating" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      f.state !== "missing" &&
      !(Date.parse(f.publishedAt) > Date.parse(c.asOf)) &&
      !(Date.parse(f.period.end) > cutoff),
  );
  const factIds = distinct([...(p?.factIds ?? []), ...available.map((f) => f.id)]);
  if (!available.length)
    return {
      ...pending(id, "insurance_rating_not_verified", "not_applicable"),
      factIds,
      formula: "评级未核验；缺失不作为资格门槛",
    };
  const grade = (f: FinancialFact) =>
    f.state === "observed" &&
    f.unit === "text" &&
    f.evidence.length > 0 &&
    typeof f.value === "string" &&
    ["AAA", "AA", "A", "BBB", "BB", "B", "C", "D"].includes(f.value);
  const blank = (f: FinancialFact) =>
    f.state === "observed" &&
    (f.value === undefined || f.value === null || (typeof f.value === "string" && !f.value.trim()));
  const quarterEnd = (date: string) => /^\d{4}-(03-31|06-30|09-30|12-31)$/.test(date);
  const timely = (f: FinancialFact) =>
    quarterEnd(f.period.end) &&
    f.year === Number(f.period.end.slice(0, 4)) &&
    Date.parse(f.period.start) <= Date.parse(f.period.end) &&
    Date.parse(f.publishedAt) >= Date.parse(f.period.end);
  const reliable = available.filter((f) => grade(f) && timely(f));
  const unresolved = available.filter((f) => !blank(f) && !reliable.includes(f));
  // Evidence that cannot establish one reliable grade must remain visible and
  // unresolved; in particular, an adverse observation with an unclear period
  // or system is never silently discarded.
  if (unresolved.length)
    return { ...pending(id, `solvency_risk_rating_unresolved:${c.companyId}`), factIds };
  if (!reliable.length)
    return {
      ...pending(id, "insurance_rating_not_verified", "not_applicable"),
      factIds,
      formula: "评级未核验；缺失不作为资格门槛",
    };
  const latest = reliable
    .map((f) => f.period.end)
    .sort()
    .at(-1)!;
  const latestFacts = reliable.filter((f) => f.period.end === latest);
  const grades = distinct(latestFacts.map((f) => String(f.value)));
  if (grades.length !== 1)
    return { ...pending(id, `solvency_risk_rating_unresolved:${c.companyId}`), factIds };
  const f = latestFacts[0],
    bindingQuarterEnd = binding
      ? `${binding.quarter.slice(0, 4)}-${["03-31", "06-30", "09-30", "12-31"][Number(binding.quarter.at(-1)) - 1]}`
      : "";
  const bindingUsable =
    !!binding && binding.system === "solvency_risk_comprehensive" && binding.regime.length > 0;
  // A current, reliable C/D in the applicable comprehensive-rating context is
  // a proven risk failure even when its context still names an older grade.
  if (bindingUsable && ["C", "D"].includes(String(f.value)))
    return {
      ...pending(id, "solvency_risk_comprehensive_rating", "fail"),
      factIds,
      formula: `${binding.regime}: latest available risk comprehensive rating ${f.value}; B or above`,
    };
  const boundFacts = c.facts.filter((x) => x.id === binding?.factId);
  const bound = boundFacts[0];
  const validBinding =
    bindingUsable &&
    boundFacts.length === 1 &&
    !!bound &&
    latestFacts.includes(bound) &&
    bound.period.end === bindingQuarterEnd;
  if (!validBinding)
    return {
      ...pending(id, `solvency_risk_rating_unresolved:${c.companyId}`),
      factIds: distinct([...factIds, ...boundFacts.map((f) => f.id)]),
    };
  return {
    ...pending(id, "solvency_risk_comprehensive_rating", "pass"),
    factIds,
    formula: `${binding.regime}: ${binding.quarter} risk comprehensive rating ${f.value}; B or above`,
  };
}
function insuranceRisk(
  c: CompanyFacts,
  policy: CnPolicy,
  year = c.latestFiscalYear,
  id = "F.risk",
  includeRating = id === "F.risk",
): ConditionResult {
  const conflict = knownCapitalScopeConflict(c);
  if (conflict) return { ...conflict, id };
  return group(
    id,
    [c].map((s) => {
      const prefix = `${id}.${s.companyId}`;
      const p = insurancePeriod(s, year),
        reg = regulatoryPeriod(s, year);
      const capital =
        !p ||
        !reg ||
        !reg.factIds.includes(p.context.regulatoryContextFactId ?? "") ||
        (p.context.scope === "group" ? "regulatory_consolidated" : "legal_entity") !==
          reg.context.scope
          ? [
              pending(
                `${prefix}.capital`,
                `insurance_solvency_context_unresolved:${s.companyId}:${year}`,
              ),
            ]
          : [
              regulatoryCondition(s, reg, "coreSolvency", `${prefix}.coreSolvency`, {
                direction: "minimum",
                absolute: policy.insurance.coreSolvency,
              }),
              regulatoryCondition(
                s,
                reg,
                "comprehensiveSolvency",
                `${prefix}.comprehensiveSolvency`,
                { direction: "minimum", absolute: policy.insurance.comprehensiveSolvency },
              ),
            ];
      return group(prefix, [
        ...capital,
        ...(includeRating ? [insuranceRating(s, p, `${prefix}.rating`)] : []),
      ]);
    }),
  );
}
/** The independent insurance strategy uses current operating proof; the
 * retained quality path intentionally keeps its stronger three-year tests. */
function insuranceFinancialOperating(c: CompanyFacts, policy: CnPolicy): ConditionResult {
  const id = "F.operating",
    p = insurancePeriod(c, c.latestFiscalYear);
  const contextFacts = eligibleFacts(c, "insurance.context", c.latestFiscalYear);
  // Consolidated group returns and group capital are evaluated through their
  // own conditions. A direct-insurer operating statement is not a group gate.
  if (c.method.value === "insurance_group")
    return {
      ...pending(id, "group_operating_not_required", "not_applicable"),
      factIds: p?.factIds ?? [],
    };
  // A complete consolidated life-service statement is sufficient operating
  // evidence on its own.  It does not certify the separate legal capital
  // scope, and a supplied (but invalid or conflicting) context is never bypassed.
  if (c.method.value === "life_insurance" && !contextFacts.length) {
    const basis = insuranceReturnBasis(c, c.latestFiscalYear),
      operands = insuranceServiceOperands(c, c.latestFiscalYear),
      service = read(c, "insurance.serviceResult", c.latestFiscalYear);
    const factIds = distinct([
      ...(basis?.factIds ?? insuranceReturnFactIds(c, [c.latestFiscalYear])),
      ...operands.facts,
      ...service.facts,
    ]);
    if (!basis || !isExact(operands) || !isExact(service) || operands.low !== service.low)
      return {
        ...pending(id, `insurance_service_statement_unresolved:${c.latestFiscalYear}`),
        factIds,
      };
    return {
      ...compare(
        `${id}.${c.companyId}.serviceResult`,
        service,
        ">",
        0,
        "latest comparable insurance service result after reinsurance",
      ),
      factIds,
    };
  }
  if (!p || !insuranceAccountingBasis(c, p))
    return pending(id, `insurance_service_statement_unresolved:${c.latestFiscalYear}`);
  if (c.method.value === "pc_insurance") {
    if (p.context.kind !== "pc" || p.context.scope !== "legal_entity")
      return pending(
        id,
        `insurance_operating_scope_unresolved:${c.companyId}:${c.latestFiscalYear}`,
      );
    return group(id, [
      compare(
        `${id}.${c.companyId}.underwriting`,
        insuranceOperand(c, p, "underwritingResult"),
        ">",
        0,
        "latest annual underwriting result",
      ),
      compareRegulatory(
        `${id}.${c.companyId}.combinedRatio`,
        insuranceOperand(c, p, "combinedRatio"),
        "<=",
        policy.insurance.combinedRatio,
        "latest disclosed overall combined ratio",
      ),
    ]);
  }
  if (c.method.value === "life_insurance") {
    if (p.context.kind !== "life" || p.context.scope !== "legal_entity")
      return pending(
        id,
        `insurance_operating_scope_unresolved:${c.companyId}:${c.latestFiscalYear}`,
      );
    if (p.context.operating.serviceResult)
      return compare(
        `${id}.${c.companyId}.serviceResult`,
        insuranceOperand(c, p, "serviceResult"),
        ">",
        0,
        "latest comparable insurance service result after reinsurance",
      );
    const operands = insuranceServiceOperands(c, c.latestFiscalYear),
      service = read(c, "insurance.serviceResult", c.latestFiscalYear),
      factIds = distinct([...p.factIds, ...operands.facts, ...service.facts]);
    if (!isExact(operands) || !isExact(service) || operands.low !== service.low)
      return {
        ...pending(id, `insurance_service_statement_unresolved:${c.latestFiscalYear}`),
        factIds,
      };
    return {
      ...compare(
        `${id}.${c.companyId}.serviceResult`,
        service,
        ">",
        0,
        "latest comparable insurance service result after reinsurance",
      ),
      factIds,
    };
  }
  return pending(id, "insurance_operating_method_pending");
}
function insuranceFinancialRoe(c: CompanyFacts, threshold: number): ConditionResult {
  const years = [c.latestFiscalYear - 2, c.latestFiscalYear - 1, c.latestFiscalYear],
    bases = insuranceReturnBases(c, years),
    roes = years.map((year) => read(c, "weightedRoe", year, "ratio"));
  const factIds = distinct([
    ...(bases?.flatMap((b) => b.factIds) ?? insuranceReturnFactIds(c, years)),
    ...roes.flatMap((q) => q.facts),
  ]);
  if (!bases || !roes.every(isExact))
    return {
      ...pending("FR.roe", "insurance_three_year_return_evidence_unresolved"),
      factIds,
      missing: distinct([
        "insurance_three_year_return_evidence_unresolved",
        ...roes.flatMap((q) => q.missing),
      ]),
    };
  return {
    ...compare(
      "FR.roe",
      median(roes),
      ">=",
      threshold,
      "median(reported weighted ROE, comparable insurance 3y)",
    ),
    factIds,
  };
}
/** Capital belongs to the screened subject: group regulatory ratios are valid
 * only for the group, while direct insurers require legal-entity ratios. */
function insuranceFinancialRisk(c: CompanyFacts, policy: CnPolicy): ConditionResult {
  const conflict = knownCapitalScopeConflict(c);
  if (conflict) return group("F.risk", [conflict]);
  const id = "F.risk",
    p = insurancePeriod(c, c.latestFiscalYear),
    reg = regulatoryPeriod(c, c.latestFiscalYear);
  const expectedScope =
    c.method.value === "insurance_group" ? "regulatory_consolidated" : "legal_entity";
  const expectedKind =
    c.method.value === "insurance_group"
      ? "group"
      : c.method.value === "pc_insurance"
        ? "pc"
        : "life";
  // A verified life route and its own regulatory table bind capital without a
  // second operating context. Supplied invalid/conflicting contexts still block.
  const independentLife =
    c.method.value === "life_insurance" &&
    c.method.state === "applies" &&
    c.method.evidence.length > 0 &&
    !eligibleFacts(c, "insurance.context", c.latestFiscalYear).length;
  const contextBound =
    independentLife ||
    (!!p &&
      p.context.kind === expectedKind &&
      p.context.scope ===
        (expectedScope === "regulatory_consolidated" ? "group" : "legal_entity") &&
      !!reg?.factIds.includes(p.context.regulatoryContextFactId ?? ""));
  if (!reg || !contextBound || reg.context.scope !== expectedScope)
    return group(id, [
      pending(
        `${id}.${c.companyId}.capital`,
        `insurance_solvency_context_unresolved:${c.companyId}:${c.latestFiscalYear}`,
      ),
      insuranceRating(c, p, `${id}.${c.companyId}.rating`),
    ]);
  return group(id, [
    regulatoryCondition(c, reg, "coreSolvency", `${id}.${c.companyId}.coreSolvency`, {
      direction: "minimum",
      absolute: policy.insurance.coreSolvency,
      requirement: "optional_when_present",
    }),
    regulatoryCondition(
      c,
      reg,
      "comprehensiveSolvency",
      `${id}.${c.companyId}.comprehensiveSolvency`,
      {
        direction: "minimum",
        absolute: policy.insurance.comprehensiveSolvency,
        requirement: "optional_when_present",
      },
    ),
    insuranceRating(c, p, `${id}.${c.companyId}.rating`),
  ]);
}
/** Group capital must belong to the screened group; child disclosures are optional. */
function insuranceFinancialScope(c: CompanyFacts, policy: CnPolicy): ConditionResult {
  if (c.method.value !== "insurance_group") return companyBusinessScope(c);
  const p = insurancePeriod(c, c.latestFiscalYear),
    reg = regulatoryPeriod(c, c.latestFiscalYear);
  const own =
    p &&
    reg &&
    p.context.kind === "group" &&
    p.context.scope === "group" &&
    reg.context.scope === "regulatory_consolidated" &&
    reg.factIds.includes(p.context.regulatoryContextFactId ?? "");
  const ownScope = own
    ? {
        ...pending("F.scope.group", "complete_regulated_group_scope", "pass"),
        factIds: distinct([...p!.factIds, ...reg!.factIds]),
      }
    : pending(
        "F.scope.group",
        `insurance_solvency_context_unresolved:${c.companyId}:${c.latestFiscalYear}`,
      );
  return group("F.scope", [ownScope, companyBusinessScope(c)]);
}
function evaluateQualityCompany(
  c: CompanyFacts,
  policy: CnPolicy,
  options: { evaluateAll?: boolean; strategy?: StrategySelector } = {},
): CompanyEvaluation {
  const identity = c.identity ? { identity: c.identity } : {};
  if (
    c.identity?.state === "not_yet_listed" ||
    (c.collection && ["pending", "interrupted"].includes(c.collection.state))
  ) {
    const nonfinancial = c.method.value === "nonfinancial";
    const state: ConditionState = nonfinancial ? "not_applicable" : "not_evaluated";
    const reason = nonfinancial ? "method_not_supported" : "financial_not_evaluated";
    const condition = financialLayer(pending("FR.method", reason, state));
    const strategies =
      options.strategy === "financial"
        ? {
            financial_research: {
              id: "financial_research" as const,
              applicability: nonfinancial ? ("not_applicable" as const) : ("unknown" as const),
              state,
              conditions: [condition],
            },
            financial_value: {
              id: "financial_value" as const,
              applicability: nonfinancial ? ("not_applicable" as const) : ("unknown" as const),
              state,
              conditions: [condition],
            },
          }
        : undefined;
    return {
      ticker: c.ticker,
      companyId: c.companyId,
      market: c.market,
      companyName: c.companyName,
      ...identity,
      method: c.method,
      quality: "unknown",
      research: "unknown",
      priority: "unknown",
      conditions: [],
      strategies,
      policyVersion: policy.version,
      ...(c.collection ? { collection: c.collection } : {}),
    };
  }
  c = { ...c, latestFiscalYear: latestDisclosedFiscalYear(c) };
  const observations = scopeObservations(c);
  const derivedFacts = deriveCompanyFacts(c);
  c = { ...c, facts: [...c.facts, ...derivedFacts] };
  const insuranceMethod = ["pc_insurance", "life_insurance", "insurance_group"].includes(
    c.method.value ?? "",
  );
  const regulatedMethod = ["bank", "broker", "financial_lease", "trust", "futures"].includes(
    c.method.value ?? "",
  );
  const financialMethod = regulatedMethod || insuranceMethod;
  const years = Array.from({ length: 5 }, (_, i) => c.latestFiscalYear - 4 + i);
  const profits = years.map((year) =>
    insuranceMethod ? insuranceReportedProfit(c, year) : read(c, "parentProfit", year),
  );
  const n1 = group("N1", [
    compare("N1.positive", positives(profits), ">=", 4, "count(PNI>0)"),
    compare("N1.total", sum(profits), ">", 0, "sum(PNI)"),
    ...(insuranceMethod
      ? [
          compare(
            "N1.history",
            exact(profits.filter(isExact).length, profits),
            ">=",
            5,
            "five disclosed annual profits; original accounting bases retained",
          ),
        ]
      : []),
  ]);
  if (insuranceMethod && n1.components!.at(-1)!.state === "fail")
    Object.assign(n1.components!.at(-1)!, {
      state: "unknown",
      reason: "five_reported_profit_years_required",
    });
  n1.state = aggregateConditions(n1.components!);
  n1.proof = n1.components!.some((r) => r.proof === "bound") ? "bound" : "exact";
  const returnYears = insuranceMethod ? years.slice(-3) : years;
  const roes = returnYears.map((year) =>
    financialMethod
      ? read(c, "weightedRoe", year, "ratio")
      : minimum([
          read(c, "weightedRoe", year, "ratio"),
          read(c, "adjustedWeightedRoe", year, "ratio"),
        ]),
  );
  const returnCondition = (values: Quantity[]) =>
    group("N2", [
      compare(
        "N2.median",
        median(values),
        ">=",
        policy.quality.roeMedian,
        financialMethod
          ? `median(reported weighted ROE,${returnYears.length}y)`
          : "median(min(reported ROE, adjusted ROE),5y)",
      ),
      ...(!insuranceMethod
        ? [
            compare(
              "N2.recent",
              median(values.slice(-3)),
              ">=",
              policy.quality.roeRecentMedian,
              "median(R,3y)",
            ),
          ]
        : []),
    ]);
  const returnResult = returnCondition(roes);
  let n2 = guardedReturns(c, returnYears, returnResult, (unknown) =>
    returnCondition(
      roes.map((q, i) =>
        unknown.has(returnYears[i])
          ? unresolved(`reported_return_basis_unresolved:${returnYears[i]}`, q.facts)
          : q,
      ),
    ),
  );
  if (insuranceMethod) {
    const bases = insuranceReturnBases(c, returnYears),
      factIds = distinct([
        ...n2.factIds,
        ...(bases?.flatMap((basis) => basis.factIds) ?? insuranceReturnFactIds(c, returnYears)),
      ]);
    n2 =
      bases && roes.every(isExact)
        ? { ...n2, factIds, formula: "median(reported weighted ROE, comparable 3y)" }
        : {
            ...pending("N2", "insurance_three_year_return_evidence_unresolved"),
            factIds,
            missing: distinct([
              "insurance_three_year_return_evidence_unresolved",
              ...roes.flatMap((q) => q.missing),
            ]),
          };
  }
  const cash = years.map((year) => read(c, "operatingCashFlow", year));
  const netProfit = years.map((year) => read(c, "netProfit", year));
  const fcf = years.map((year, i) => difference(cash[i], read(c, "capex", year)));
  const n3 = guarded(
    c,
    ["cash"],
    group("N3", [
      compare("N3.profit", sum(netProfit), ">", 0, "sum(consolidated NI)"),
      compare(
        "N3.conversion",
        ratio(sum(cash), sum(netProfit)),
        ">=",
        policy.quality.ocfConversion,
        "sum(OCF)/sum(consolidated NI)",
      ),
      compare("N3.positive", positives(cash), ">=", 4, "count(OCF>0)"),
      compare("N3.recent", sum(cash.slice(-2)), ">", 0, "sum(OCF,2y)"),
    ]),
  );
  const n4 = compare("N4", sum(fcf), ">=", 0, "sum(OCF-capex,5y)");
  const year = c.latestFiscalYear;
  const debt = boundedReportedDebt(c, year);
  const equity = read(c, "equity", year);
  const parentEquity = read(c, "parentEquity", year);
  const leverage = compare(
    "N5.leverage",
    ratio(debt, equity),
    "<=",
    policy.quality.debtEquity,
    "D_reported / consolidated equity",
  );
  let n5 = group("N5", [
    compare("N5.parent_equity", parentEquity, ">", 0, "reported parent equity"),
    compare("N5.equity", equity, ">", 0, "consolidated equity"),
    leverage,
  ]);
  n5.proof = leverage.proof;
  const averageCash = mapExact(sum(cash.slice(-3)), (n) => n / 3);
  const debtRatio = ratio(debt, averageCash);
  const n6 = guarded(
    c,
    ["cash"],
    group("N6", [
      compare("N6.cash", averageCash, ">", 0, "mean(OCF,3y)"),
      compare("N6.coverage", debtRatio, "<=", policy.quality.debtOcf, "D_reported/mean(OCF,3y)"),
    ]),
    { cash: annualWindow(c, 3) },
  );
  n6.proof = debtRatio.low === debtRatio.high ? "exact" : "bound";
  const cycle = c.checks.cycle;
  const cycleYears = Array.from({ length: 7 }, (_, i) => year - 6 + i);
  const cycleConfirmed =
    scopeCovers(c, "cycle", annualWindow(c)) ||
    (cycle?.state === "applies" &&
      cycle?.reason === "verified_fine_business_cycle_mapping" &&
      cycle.evidence.length > 0 &&
      !!cycle.coverage &&
      Date.parse(cycle.coverage.end) >= Date.parse(`${year}-12-31`));
  const noncycleConfirmed =
    scopeCovers(c, "cycle", annualWindow(c), "not_applicable") ||
    (cycle?.state === "not_applicable" &&
      ["verified_fine_business_cycle_mapping", "standard_nonfinancial_window"].includes(
        cycle?.reason ?? "",
      ) &&
      cycle.evidence.length > 0 &&
      !!cycle.coverage &&
      Date.parse(cycle.coverage.end) >= Date.parse(`${year}-12-31`));
  const uncertainCycle = !financialMethod && !cycleConfirmed && !noncycleConfirmed;
  let cycleCondition: ConditionResult;
  if (noncycleConfirmed)
    cycleCondition = {
      ...pending(
        "cycle",
        cycle.reason === "standard_nonfinancial_window"
          ? "standard_nonfinancial_window"
          : "verified_noncyclical",
        "not_applicable",
      ),
      factIds: cycle.evidence,
    };
  else if (!financialMethod) {
    const cycleCash = cycleYears.map((y) =>
      difference(read(c, "operatingCashFlow", y), read(c, "capex", y)),
    );
    const cycleFcf = compare("cycle.cash", sum(cycleCash), ">=", 0, "sum(FCF,7y)");
    const cycleRoes = cycleYears.map((y) =>
      minimum([read(c, "weightedRoe", y, "ratio"), read(c, "adjustedWeightedRoe", y, "ratio")]),
    );
    const cycleReturn = (values: Quantity[]) =>
      compare("cycle.return", median(values), ">=", policy.quality.roeMedian, "median(R,7y)");
    cycleCondition = group("cycle", [
      guardedReturns(c, cycleYears, cycleReturn(cycleRoes), (unknown) =>
        cycleReturn(
          cycleRoes.map((q, i) =>
            unknown.has(cycleYears[i])
              ? unresolved(`reported_return_basis_unresolved:${cycleYears[i]}`, q.facts)
              : q,
          ),
        ),
      ),
      compare(
        "cycle.profit",
        positives(cycleYears.map((y) => read(c, "parentProfit", y))),
        ">=",
        5,
        "count(PNI>0,7y)",
      ),
      guarded(c, ["cash"], cycleFcf, { cash: annualWindow(c, 7) }),
    ]);
    cycleCondition.factIds = distinct([...cycleCondition.factIds, ...(cycle?.evidence ?? [])]);
    if (!cycleConfirmed)
      cycleCondition = {
        ...cycleCondition,
        state: cycleCondition.state === "pass" ? "pass" : "unknown",
        reason:
          cycleCondition.state === "pass"
            ? "cycle_applicability_independent_bound"
            : "cycle_scope_unresolved",
        proof: "bound",
        missing: distinct([
          ...cycleCondition.missing,
          ...(cycleCondition.state === "pass" ? [] : ["cycle_scope_unresolved"]),
        ]),
      };
  } else cycleCondition = pending("cycle", "not_a_nonfinancial_method", "not_applicable");
  // Required insurance facts are checked by N1/N2, operating, risk and scope.
  // A separate report-package gate adds no evidence and cannot decide a condition.
  // 信托与期货已有专用事实契约；其余尚未支持的方法保留明确的未评估状态。
  const financialValidation =
    financialMethod && !["bank", "broker", "trust", "futures"].includes(c.method.value!)
      ? [
          pending(
            "F.methodValidation",
            c.method.value === "financial_lease"
              ? "financial_method_not_supported"
              : "method_validation_pending",
          ),
        ]
      : [];
  let conditions = insuranceMethod
    ? [
        n1,
        n2,
        insuranceOperating(c, policy),
        insuranceRisk(c, policy),
        companyBusinessScope(c),
        ...financialValidation,
      ]
    : regulatedMethod
      ? [n1, n2, financialRisk(c, policy), companyBusinessScope(c), ...financialValidation]
      : [n1, n2, n3, n4, n5, n6, cycleCondition, companyBusinessScope(c)];
  // Scope checks constrain the affected cash conditions, without erasing independent ROE failures.
  conditions = conditions.map((r) => (r.id === "N4" ? guarded(c, ["cash"], r) : r));
  const methodValid =
    c.method.state === "applies" &&
    (c.method.value === "nonfinancial" || financialMethod) &&
    c.method.evidence.length > 0 &&
    !!c.method.coverage &&
    Date.parse(c.method.coverage.start) <= Date.parse(`${year}-12-31`) &&
    Date.parse(c.method.coverage.end) >= Date.parse(`${year}-12-31`);
  const stale = new Date(c.asOf).getTime() > new Date(`${year + 2}-06-30T23:59:59Z`).getTime();
  if (!methodValid || stale)
    conditions = conditions.map((r) =>
      pending(r.id, stale ? "stale_financials" : "method_pending"),
    );
  const quality = aggregateConditions(conditions);
  const p0 = {
    ...pending("P0", quality === "pass" ? "base_qualified" : "base_not_qualified", quality),
    factIds: distinct(conditions.flatMap((r) => r.factIds)),
  };
  // A bank/broker financial strategy has its own research contract. Do not
  // let the quality early exit hide its price condition.
  const independentFinancial = options.strategy === "financial" && financialMethod;
  if (quality !== "pass" && !options.evaluateAll && !independentFinancial) {
    const later = ["P1", "P2", "P3"].map((id) =>
      pending(id, "base_not_qualified", "not_evaluated"),
    );
    const strategies =
      options.strategy === "financial"
        ? financialStrategies(
            c,
            policy,
            methodValid,
            stale,
            n1,
            roes,
            undefined,
            undefined,
            later[2],
          )
        : undefined;
    return {
      ticker: c.ticker,
      companyId: c.companyId,
      market: c.market,
      companyName: c.companyName,
      ...identity,
      method: c.method,
      quality,
      research: aggregateConditions([p0, ...later.filter((r) => r.id !== "P3")]),
      priority: quality === "fail" ? "fail" : "unknown",
      conditions: [...conditions, p0, ...later],
      strategies,
      policyVersion: policy.version,
      observations,
      derivedFacts,
      ...(c.collection ? { collection: c.collection } : {}),
    };
  }
  const priorityYears = insuranceMethod
    ? returnYears
    : !financialMethod && (cycleConfirmed || uncertainCycle)
      ? cycleYears
      : years;
  const ordinary = priorityYears.map((y) =>
    financialMethod
      ? reportedEarnings(c, y)
      : minimum([reportedEarnings(c, y), reportedEarnings(c, y, true)]),
  );
  const priorityRoes = priorityYears.map((y) =>
    financialMethod
      ? read(c, "weightedRoe", y, "ratio")
      : minimum([read(c, "weightedRoe", y, "ratio"), read(c, "adjustedWeightedRoe", y, "ratio")]),
  );
  // Annual return contexts establish the reported annual basis. Earnings remain
  // report PNI/ANI and are adjusted only for a known special-claim conflict.
  const guardPriorityEarnings = (
    selectedYears: number[],
    result: ConditionResult,
  ): ConditionResult => {
    const checked = guardedReturns(c, selectedYears, result, () =>
      pending(result.id, "reported_earnings_basis_unresolved"),
    );
    return checked.reason === "annual_reported_return_basis"
      ? { ...checked, reason: "annual_reported_earnings_basis" }
      : checked;
  };
  const priorityFor = (window: number) =>
    guardPriorityEarnings(
      priorityYears.slice(-window),
      group("P1", [
        compare(
          "P1.return",
          median(priorityRoes.slice(-window)),
          ">=",
          policy.priority.roeMedian,
          "median(R,applicable window)",
        ),
        compare(
          "P1.recent",
          minimum(priorityRoes.slice(-3)),
          ">=",
          policy.priority.roeRecentFloor,
          "min(R,3y)",
        ),
        group(
          "P1.profits",
          priorityYears
            .slice(-window)
            .flatMap((y) =>
              (financialMethod
                ? [read(c, "parentProfit", y)]
                : [read(c, "parentProfit", y), read(c, "reportedAdjustedParentProfit", y)]
              ).map((q, i) =>
                compare(
                  `P1.profits.${y}.${i}`,
                  q,
                  ">",
                  0,
                  financialMethod ? "reported PNI>0" : "reported PNI/ANI>0",
                ),
              ),
            ),
        ),
      ]),
    );
  let p1 = priorityFor(priorityYears.length);
  if (uncertainCycle) {
    const alternatives = [
      { ...priorityFor(5), id: "P1.5y" },
      { ...p1, id: "P1.7y" },
    ];
    const state = alternatives.every((r) => r.state === "pass")
      ? "pass"
      : alternatives.every((r) => r.state === "fail")
        ? "fail"
        : "unknown";
    p1 = {
      ...group("P1", alternatives),
      state,
      reason:
        state === "unknown" ? "cycle_scope_unresolved" : "cycle_applicability_independent_bound",
      proof: "bound",
    };
    if (state === "unknown") p1.missing = distinct([...p1.missing, "cycle_scope_unresolved"]);
  }
  let p2 = group("P2", [
    compare("P2.positive", positives(fcf), ">=", 4, "count(FCF>0,5y)"),
    compare("P2.recent", sum(fcf.slice(-2)), ">", 0, "sum(FCF,2y)"),
    compare(
      "P2.conversion",
      ratio(sum(fcf), sum(netProfit)),
      ">=",
      policy.priority.fcfConversion,
      "sum(FCF)/sum(consolidated NI)",
    ),
  ]);
  if (insuranceMethod) {
    const bases = insuranceReturnBases(c, priorityYears);
    if (!bases)
      p1 = {
        ...pending("P1", "insurance_three_year_basis_unresolved"),
        factIds: distinct([...p1.factIds, ...insuranceReturnFactIds(c, priorityYears)]),
      };
    else
      p1 = {
        ...p1,
        formula: "reported return and ordinary profit, comparable insurance 3y",
        factIds: distinct([...p1.factIds, ...bases.flatMap((basis) => basis.factIds)]),
      };
    p2 = group(
      "P2",
      years.slice(-3).map((y) => insuranceRisk(c, policy, y, `P2.${y}`, false)),
    );
  } else if (regulatedMethod) {
    const history = years.slice(-3).map((y) => financialRisk(c, policy, y, `P2.${y}`));
    const contexts = years.slice(-3).map((y) => regulatoryPeriod(c, y));
    if (contexts.some((p) => !p) || new Set(contexts.map((p) => p?.context.scope)).size !== 1)
      history.push(pending("P2.scope", "regulatory_history_scope_unresolved"));
    p2 = group("P2", history);
  } else p2 = guarded(c, ["cash"], p2);
  const shortReference = minimum([
    median(ordinary.slice(-5)),
    median(ordinary.slice(-3)),
    ordinary.at(-1)!,
  ]);
  const longReference = minimum([shortReference, median(ordinary)]);
  const reference = uncertainCycle
    ? { ...sum([shortReference, longReference]), low: longReference.low, high: shortReference.high }
    : !financialMethod && cycleConfirmed
      ? longReference
      : shortReference;
  const latestInstantYear = (field: string) =>
    c.facts
      .filter(
        (f) =>
          f.field === field &&
          f.entity === c.companyId &&
          f.basis === c.basis &&
          new Date(f.publishedAt) <= new Date(c.asOf) &&
          new Date(f.period.end) <= new Date(c.asOf),
      )
      .sort((a, b) => b.period.end.localeCompare(a.period.end))[0]?.year ??
    Number(c.asOf.slice(0, 4));
  const quoteYear = latestInstantYear("price");
  const price = read(c, "price", quoteYear, `${c.currency}/share`);
  const shares = read(c, "ordinaryShares", latestInstantYear("ordinaryShares"), "shares");
  const perShare = ratio(reference, shares),
    haircutFactor = 1 - policy.priority.earningsHaircut;
  const discounted =
    haircutFactor === 0
      ? exact(0, [perShare])
      : { ...perShare, low: perShare.low * haircutFactor, high: perShare.high * haircutFactor };
  let p3 = guardedQuote(
    c,
    shares,
    guardPriorityEarnings(
      priorityYears,
      compare(
        "P3",
        ratio(discounted, price),
        ">=",
        policy.priority.earningsYield,
        "(1-haircut)*min(median(E,5y),median(E,3y),latest E[,median(E,7y)])/current same-rights ordinary shares/price",
      ),
    ),
  );
  const unresolvedClaims = ordinary.filter((q) =>
    q.missing.some((reason) => /reported_earnings_(claim_unresolved|eps_conflict)/.test(reason)),
  );
  if (unresolvedClaims.length)
    p3 = {
      ...pending("P3", "reported_earnings_claim_unresolved"),
      factIds: distinct([...p3.factIds, ...unresolvedClaims.flatMap((q) => q.facts)]),
      missing: distinct([
        "reported_earnings_claim_unresolved",
        ...unresolvedClaims.flatMap((q) => q.missing),
      ]),
    };
  const quote = c.facts.find(
    (f) => f.field === "price" && f.year === quoteYear && f.period.end === c.quoteDate,
  );
  if (
    !c.quoteDate ||
    c.quoteDate !== c.lastCompletedTradingDay ||
    quote?.period.end !== c.quoteDate ||
    c.quoteDate > c.asOf.slice(0, 10)
  )
    p3 = {
      ...pending("P3", "quote_date_unverified"),
      factIds: p3.factIds,
      missing: distinct([
        "quote_date_unverified",
        ...p3.missing,
        ...price.missing,
        ...shares.missing,
        ...(!c.quoteDate ? ["price_date_missing"] : []),
        ...(!c.lastCompletedTradingDay ? ["market_session_unverified"] : []),
      ]),
    };
  if (insuranceMethod) {
    const bases = insuranceReturnBases(c, priorityYears);
    if (!bases)
      p3 = {
        ...pending("P3", "insurance_three_year_basis_unresolved"),
        factIds: distinct([...p3.factIds, ...insuranceReturnFactIds(c, priorityYears)]),
      };
    else
      p3 = {
        ...p3,
        formula:
          "(1-haircut)*min(median(E,comparable insurance 3y),latest E)/current same-rights ordinary shares/price",
        factIds: distinct([...p3.factIds, ...bases.flatMap((basis) => basis.factIds)]),
      };
  }
  const priorityConditions = [p1, p2, p3].map((r) =>
    methodValid && !stale ? r : pending(r.id, stale ? "stale_financials" : "method_pending"),
  );
  conditions = [...conditions, p0, ...priorityConditions];
  const strategies =
    options.strategy === "financial"
      ? financialStrategies(
          c,
          policy,
          methodValid,
          stale,
          n1,
          roes,
          conditions.find((r) => r.id === "F.risk"),
          conditions.find((r) => r.id === "F.scope"),
          p3,
        )
      : undefined;
  return {
    ticker: c.ticker,
    companyId: c.companyId,
    market: c.market,
    companyName: c.companyName,
    ...identity,
    method: c.method,
    quality,
    research: aggregateConditions([p0, ...priorityConditions.filter((r) => r.id !== "P3")]),
    priority: aggregateConditions([p0, ...priorityConditions]),
    conditions,
    strategies,
    policyVersion: policy.version,
    observations,
    derivedFacts,
    ...(c.collection ? { collection: c.collection } : {}),
  };
}

/** Reject known adverse audit evidence without treating an absent opinion as failure. */
function knownAuditFailures(c: CompanyFacts, year: number, conditionId: string): ConditionResult[] {
  const failures: ConditionResult[] = [];
  for (const f of eligibleFacts(c, "auditOpinion", year)) {
    if (
      f.state === "observed" &&
      f.unit === "text" &&
      f.evidence.length &&
      [
        "qualified",
        "adverse",
        "disclaimer",
        "nonstandard",
        "保留意见",
        "否定意见",
        "无法表示意见",
        "非标准无保留意见",
      ].includes(String(f.value))
    )
      failures.push({
        ...pending(conditionId, "known_nonstandard_audit", "fail"),
        factIds: [f.id],
      });
  }
  return failures;
}

/** Financial bargain leads use a separate hypothesis, not a relaxed specialist risk pass. */
function financialDiscountStrategy(input: CompanyFacts, policy: CnPolicy): StrategyResult {
  const finish = (
    conditions: ConditionResult[],
    applicability: ConditionState = "pass",
  ): StrategyResult => ({
    id: "financial_discount",
    applicability,
    state: applicability === "not_applicable" ? "not_applicable" : aggregateConditions(conditions),
    conditions: conditions.map(financialLayer),
  });
  const unavailable = (reason: string, state: ConditionState = "unknown") =>
    finish([pending("FD.method", reason, state)], state === "not_applicable" ? state : "unknown");
  const config = policy.strategies?.financialDiscount;
  if (!config) return unavailable("financial_discount_not_enabled", "not_evaluated");
  if (
    input.identity?.state === "not_yet_listed" ||
    (input.collection && ["pending", "interrupted"].includes(input.collection.state))
  )
    return unavailable("financial_discount_not_evaluated", "not_evaluated");
  const c = { ...input, latestFiscalYear: latestDisclosedFiscalYear(input) },
    year = c.latestFiscalYear,
    date = `${year}-12-31`;
  if (c.market !== "CN")
    return unavailable("financial_discount_market_not_applicable", "not_applicable");
  if (c.method.reason?.includes("conflict")) return unavailable("financial_identity_conflict");
  if (c.method.state === "applies" && c.method.value === "nonfinancial")
    return unavailable("nonfinancial_discount_not_applicable", "not_applicable");
  const familyFacts = eligibleFacts(c, "statementFamily", year).filter(
    (f) => f.state !== "missing",
  );
  const families = new Set(familyFacts.map((f) => f.value));
  const financialFamily =
    families.size === 1 &&
    familyFacts.length > 0 &&
    familyFacts.every(
      (f) =>
        f.state === "observed" &&
        f.unit === "text" &&
        f.evidence.length > 0 &&
        f.period.end === date &&
        ["银行", "证券", "保险"].includes(String(f.value)),
    );
  if (families.size > 1 || familyFacts.some((f) => f.state === "conflicting"))
    return unavailable("financial_identity_conflict");
  const profiles = c.facts.filter(
    (f) =>
      f.field === "business.profile" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf) &&
      Date.parse(f.period.end) <= Date.parse(c.asOf),
  );
  const latestProfile = profiles
    .map((f) => f.publishedAt)
    .sort()
    .at(-1);
  const financialProfile = profiles.filter((f) => f.publishedAt === latestProfile);
  const profileApplies =
    financialProfile.length > 0 &&
    financialProfile.every((f) => {
      if (f.state !== "observed" || f.unit !== "text" || !f.evidence.length) return false;
      try {
        const v = JSON.parse(String(f.value));
        return (
          String(v.industry).startsWith("金融业-") &&
          /银行|证券|保险|期货|信托|融资租赁|金融投资|金融控股|信用资产/.test(
            String(v.mainBusiness ?? ""),
          )
        );
      } catch {
        return false;
      }
    });
  const routed =
    c.method.state === "applies" &&
    !!c.method.value &&
    c.method.value !== "mixed" &&
    c.method.evidence.length > 0 &&
    c.method.coverage &&
    c.method.coverage.start <= date &&
    c.method.coverage.end >= date;
  if (!routed && !financialFamily && !profileApplies)
    return unavailable("financial_identity_unresolved");
  if (c.currency !== "CNY") return unavailable("financial_discount_currency_unresolved");
  if (Date.parse(c.asOf) > Date.parse(`${year + 2}-06-30T23:59:59Z`))
    return unavailable("stale_financials");
  const method = {
    ...pending("FD.method", "financial_lead_applicable_specialist_risks_pending", "pass"),
    factIds: distinct([
      ...c.method.evidence,
      ...familyFacts.map((f) => f.id),
      ...financialProfile.map((f) => f.id),
    ]),
  };
  const profits = Array.from({ length: config.positiveProfitYears }, (_, i) => {
    const y = year - i;
    return compare(
      `FD.profits.${y}`,
      read(c, "parentProfit", y),
      ">",
      0,
      `reported parent profit ${y}`,
    );
  });
  const eps = read(c, "casOrdinaryBasicEps", year, "CNY/share"),
    bps = read(c, "reportedOrdinaryBps", year, "CNY/share");
  const metrics = [
    compare("FD.eps", eps, ">", 0, "latest annual disclosed basic EPS"),
    compare("FD.bps", bps, ">", 0, "latest annual ordinary BPS"),
  ];
  const core: ConditionResult[] = [];
  for (const field of [
    "nonordinaryEquity",
    "parentEquity",
    "ordinaryEquity",
    "ordinaryProfit",
    "nonordinaryProfitAllocation",
  ]) {
    const present = eligibleFacts(c, field, year).filter((f) => f.state !== "missing");
    const q = read(c, field, year);
    if (present.length && (!isExact(q) || (field === "nonordinaryEquity" && q.low < 0)))
      core.push({
        ...pending(`FD.core.${field}`, "financial_core_fact_conflict"),
        factIds: present.map((f) => f.id),
      });
  }
  const ordinary = read(c, "ordinaryProfit", year),
    allocation = read(c, "nonordinaryProfitAllocation", year),
    parent = read(c, "parentProfit", year);
  if (
    (isExact(ordinary) && ordinary.low <= 0 && isExact(eps) && eps.low > 0) ||
    (isExact(allocation) &&
      isExact(parent) &&
      allocation.low >= parent.low &&
      isExact(eps) &&
      eps.low > 0)
  )
    core.push({
      ...pending("FD.core.ownership", "financial_earnings_ownership_conflict"),
      factIds: distinct([...ordinary.facts, ...allocation.facts, ...parent.facts, ...eps.facts]),
    });
  for (const key of ["capital", "earnings", "coreAccounting"]) {
    const check = c.checks[key];
    if (check?.state === "unresolved" && check.evidence.length)
      core.push({
        ...pending(`FD.core.${key}`, "financial_core_scope_conflict"),
        factIds: check.evidence,
      });
  }
  // Only a sourced actual breach excludes a lead. The old policy's extra
  // safety margin is not a regulatory minimum, and missing risk facts stay pending.
  let regulation: RegulatoryPeriod | undefined;
  try {
    regulation = regulatoryPeriod(c, year);
  } catch {
    /* Unusable optional risk context grants no assurance. */
  }
  if (regulation)
    for (const [metric, binding] of Object.entries(regulation.context.metrics)) {
      if (binding.requirementKind !== "regulatory") continue;
      const actual = regulatoryAmount(c, regulation, metric, "actual"),
        requirement = regulatoryAmount(c, regulation, metric, "requirement");
      if (isExact(actual) && isExact(requirement)) {
        const r = compareRegulatory(
          `FD.core.regulatory.${metric}`,
          {
            ...actual,
            facts: distinct([...actual.facts, ...requirement.facts]),
          },
          binding.direction === "minimum" ? ">=" : "<=",
          requirement.low,
          `${metric}: disclosed applicable regulatory requirement (no additional policy margin)`,
        );
        if (r.state === "fail") core.push(r);
      }
    }
  if (
    ["insurance_group", "life_insurance", "pc_insurance"].includes(c.method.value ?? "") ||
    families.has("保险")
  ) {
    let insurance: InsurancePeriod | undefined;
    try {
      insurance = insurancePeriod(c, year);
    } catch {
      /* No unsupported scope is inferred. */
    }
    const rating = insuranceRating(c, insurance, "FD.core.insuranceRating");
    if (rating.state === "fail" || rating.state === "unknown") core.push(rating);
  }
  core.push(...knownAuditFailures(c, year, "FD.core.audit"));
  const conditions = [
    method,
    group("FD.profits", profits),
    ...metrics,
    core.length
      ? group("FD.core", core)
      : pending("FD.core", "no_known_core_exclusion_specialist_risks_pending", "pass"),
  ];
  // Do not spend quote requests on a failed or unresolved numeric prerequisite.
  if (aggregateConditions(conditions) !== "pass") return finish(conditions);
  const priceYear = Number(c.quoteDate?.slice(0, 4) ?? c.asOf.slice(0, 4));
  const price = read(c, "price", priceYear, "CNY/share"),
    shares = read(c, "ordinaryShares", priceYear, "shares");
  let quote = guardedQuote(
    c,
    shares,
    compare("FD.quote", price, ">", 0, "completed unadjusted daily close"),
  );
  if (
    !c.quoteDate ||
    c.quoteDate !== c.lastCompletedTradingDay ||
    c.quoteDate > c.asOf.slice(0, 10)
  )
    quote = {
      ...pending("FD.quote", "quote_date_unverified"),
      factIds: distinct([...price.facts, ...shares.facts]),
      missing: distinct(["quote_date_unverified", ...price.missing, ...shares.missing]),
    };
  if (price.facts.some((id) => c.facts.find((f) => f.id === id)?.period.end !== c.quoteDate))
    quote = {
      ...pending("FD.quote", "quote_date_unverified"),
      factIds: distinct([...price.facts, ...shares.facts]),
      missing: distinct(["quote_date_unverified", ...price.missing, ...shares.missing]),
    };
  if (quote.state !== "pass") return finish([...conditions, quote]);
  const binding = financialPerSharePrice(c, price, eps, bps);
  const pb =
    isExact(binding) && isExact(bps)
      ? exact(binding.low / bps.low, [binding, bps])
      : unresolved(
          "financial_pb_price_basis_unresolved",
          distinct([...binding.facts, ...bps.facts]),
        );
  const ey =
    isExact(binding) && binding.low > 0 && isExact(eps)
      ? exact(((1 - config.earningsHaircut) * eps.low) / binding.low, [binding, eps])
      : unresolved(
          "financial_earnings_price_basis_unresolved",
          distinct([...binding.facts, ...eps.facts]),
        );
  const result = finish([
    ...conditions,
    quote,
    {
      ...compare(
        "FD.shareBasis",
        binding,
        ">",
        0,
        "current close converted to annual per-share basis",
      ),
      missing: binding.missing,
    },
    compareRegulatory("FD.pb", pb, "<=", config.maxPb, "annual-basis price / annual ordinary BPS"),
    compareRegulatory(
      "FD.earningsYield",
      ey,
      ">=",
      config.minEarningsYield,
      `(1-${config.earningsHaircut}) * disclosed annual basic EPS / annual-basis price`,
    ),
  ]);
  result.signal = {
    name: "discounted_reported_earnings_yield",
    unit: "ratio",
    direction: "higher_is_better",
    ...(isExact(ey) ? { value: ey.low } : {}),
  };
  return result;
}

/** Same-rights structure is necessary for matching annual per-share facts to today's close. */
function financialPerSharePrice(
  c: CompanyFacts,
  price: Quantity,
  eps: Quantity,
  bps: Quantity,
): Quantity {
  const date = `${c.latestFiscalYear}-12-31`;
  const fields = c.facts.filter(
    (f) =>
      ["quote.shareStructure", "quote.shareHistory"].includes(f.field) &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      f.state === "observed" &&
      f.unit === "text" &&
      f.evidence.length &&
      f.period.start === f.publishedAt &&
      f.period.end === f.publishedAt &&
      Date.parse(f.publishedAt) >= Date.parse(`${c.quoteDate}T15:00:00+08:00`) &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const ids = distinct([...price.facts, ...eps.facts, ...bps.facts, ...fields.map((f) => f.id)]);
  const unknown = (reason: string) => unresolved(reason, ids);
  if (!isExact(price) || price.low <= 0) return unknown("financial_price_missing");
  const structures: Array<ReturnType<typeof shareStructureSchema.parse>> = [];
  try {
    for (const f of fields)
      if (f.field === "quote.shareStructure")
        structures.push(shareStructureSchema.parse(JSON.parse(String(f.value))));
  } catch {
    return unknown("financial_share_structure_invalid");
  }
  if (!structures.length || new Set(structures.map((s) => JSON.stringify(s))).size > 1)
    return unknown("financial_share_structure_missing_or_conflicting");
  const latest = structures[0];
  if (latest.effectiveDate > (c.quoteDate ?? "") || latest.announcedAt > c.asOf.slice(0, 10))
    return unknown("financial_share_structure_not_effective");
  const ordinaryTotal = (s: typeof latest) => {
    const known = [s.aShares, s.bShares, s.restrictedBShares, s.hShares, s.restrictedHShares]
      .filter((n): n is number => n !== null)
      .reduce((a, b) => a + b, 0);
    return s.aShares > 0 && known === s.totalShares && !s.otherShares && !s.preferredShares;
  };
  if (!ordinaryTotal(latest)) return unknown("financial_share_classes_unresolved");
  const bookConflict = (reportShares: number) => {
    const parent = read(c, "parentEquity", c.latestFiscalYear),
      tools = read(c, "nonordinaryEquity", c.latestFiscalYear),
      ordinary = read(c, "ordinaryEquity", c.latestFiscalYear);
    const book = isExact(ordinary)
      ? ordinary
      : isExact(parent) && isExact(tools)
        ? exact(parent.low - tools.low, [parent, tools])
        : undefined;
    if (book) ids.push(...book.facts.filter((id) => !ids.includes(id)));
    if (isExact(parent)) ids.push(...parent.facts.filter((id) => !ids.includes(id)));
    // Disclosed BPS commonly rounds to cents. Do not require a balance sheet
    // just to use a validated per-share field, but never bypass known disagreement.
    // With nonnegative other equity tools, parent equity is an upper bound even
    // when their amount is missing; that bound can reject a conflict, not prove BPS.
    return (
      isExact(bps) &&
      ((book !== undefined && Math.abs(book.low / reportShares - bps.low) > 0.0051) ||
        (isExact(parent) && bps.low > parent.low / reportShares + 0.0051))
    );
  };
  if (latest.effectiveDate <= date)
    return bookConflict(latest.totalShares)
      ? unknown("financial_bps_equity_conflict")
      : { ...price, facts: ids };
  let history: Array<ReturnType<typeof shareStructureSchema.parse>> = [];
  try {
    const observations = fields.filter((f) => f.field === "quote.shareHistory");
    if (observations.length !== 1) return unknown("financial_share_history_missing_or_conflicting");
    history = JSON.parse(String(observations[0].value)).map((v: unknown) =>
      shareStructureSchema.parse(v),
    );
  } catch {
    return unknown("financial_share_history_invalid");
  }
  history.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const report = history.filter((s) => s.effectiveDate <= date).at(-1);
  const changes = history.filter((s) => s.effectiveDate > date);
  if (!report || !changes.length || JSON.stringify(changes.at(-1)) !== JSON.stringify(latest))
    return unknown("financial_share_history_incomplete");
  const rows = [report, ...changes];
  if (rows.some((s) => !ordinaryTotal(s))) return unknown("financial_share_classes_unresolved");
  if (bookConflict(report.totalShares)) return unknown("financial_bps_equity_conflict");
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1],
      next = rows[i];
    if (next.announcedAt > c.asOf.slice(0, 10) || next.effectiveDate <= previous.effectiveDate)
      return unknown("financial_share_history_conflict");
    if (next.totalShares === previous.totalShares) continue;
    // A bonus/split scales old claims. Issuance, conversions and repurchases
    // also change the underlying equity, so a count ratio alone is insufficient.
    if (
      !/转增|送股|送红股|拆股/.test(next.changeReason) ||
      /增发|配股|回购|注销|债转股/.test(next.changeReason) ||
      next.totalShares <= previous.totalShares
    )
      return unknown("financial_capital_change_requires_reassessment");
    const classes = (s: typeof latest) => [s.aShares, (s.bShares ?? 0) + (s.restrictedBShares ?? 0), (s.hShares ?? 0) + (s.restrictedHShares ?? 0)];
    if (classes(next).some((amount, index) => Math.abs(amount / next.totalShares - classes(previous)[index] / previous.totalShares) > 1e-12))
      return unknown("financial_nonproportional_share_change");
    const annualFacts = c.facts.filter((f) => [...eps.facts, ...bps.facts].includes(f.id));
    if (annualFacts.some((f) => f.publishedAt.slice(0, 10) >= next.effectiveDate))
      return unknown("financial_per_share_restatement_unresolved");
  }
  const ratio = latest.totalShares / report.totalShares;
  return {
    low: price.low * ratio,
    high: price.low * ratio,
    facts: ids,
    missing: [],
  };
}

/** Seven-year earnings repair is independent of quality, cash and cycle gates.
 * Reuses ordinary-ownership, annual-context and quote guards; it is a research
 * price signal, not an assertion that reported earnings are distributable cash.
 */
function earningsRepairStrategy(input: CompanyFacts, policy: CnPolicy): StrategyResult {
  const finish = (conditions: ConditionResult[], applicability: ConditionState = "pass"): StrategyResult => ({
    id: "earnings_repair", applicability,
    state: applicability === "pass" ? aggregateConditions(conditions) : applicability,
    conditions: conditions.map(c => ({ ...c, layer: "repair" })),
  });
  const unavailable = (reason: string, state: ConditionState = "unknown") =>
    finish([pending("ER.method", reason, state)], state);
  const config = policy.strategies?.earningsRepair;
  if (!config) return unavailable("earnings_repair_not_enabled", "not_evaluated");
  if (input.identity?.state === "not_yet_listed" ||
    (input.collection && ["pending", "interrupted"].includes(input.collection.state)))
    return unavailable("collection_not_evaluated", "not_evaluated");
  const c = { ...input, latestFiscalYear: latestDisclosedFiscalYear(input) }, year = c.latestFiscalYear;
  if (c.market !== "CN") return unavailable("earnings_repair_market_not_applicable", "not_applicable");
  if (c.method.state !== "applies" || c.method.reason?.includes("conflict"))
    return unavailable("nonfinancial_method_unresolved");
  if (c.method.value !== "nonfinancial") return unavailable("financial_earnings_repair_not_applicable", "not_applicable");
  if (!c.method.coverage || c.method.coverage.start > `${year}-12-31` ||
    c.method.coverage.end < `${year}-12-31` || !c.method.evidence.length ||
    Date.parse(c.asOf) > Date.parse(`${year + 2}-06-30T23:59:59Z`))
    return unavailable("method_or_annual_period_unverified");
  const years = Array.from({ length: 7 }, (_, i) => year - 6 + i);
  const earnings = years.map(y => minimum([reportedEarnings(c, y), reportedEarnings(c, y, true)]));
  const reference = minimum([median(earnings), median(earnings.slice(-5)), median(earnings.slice(-3)), earnings.at(-1)!]);
  const history = guardedReturns(c, years,
    compare("ER.history", sum(earnings.map(e => mapExact(e, () => 1))), ">=", 7, "seven complete annual ordinary PNI/ANI observations"),
    () => pending("ER.history", "annual_earnings_basis_unresolved"));
  history.calculations = years.map((y, i) => ({ id: `ER.earnings.${y}`, year: y,
    formula: "min(ordinary parent profit, ordinary adjusted parent profit)", unit: c.currency,
    ...(isExact(earnings[i]) ? { value: earnings[i].low } : {}),
    factIds: earnings[i].facts, missing: earnings[i].missing }));
  const latestYear = (field: string) => c.facts.filter(f => f.field === field && f.entity === c.companyId &&
    f.basis === c.basis && Date.parse(f.period.end) <= Date.parse(c.asOf) &&
    Date.parse(f.publishedAt) <= Date.parse(c.asOf)).sort((a, b) => b.period.end.localeCompare(a.period.end))[0]?.year ?? Number(c.asOf.slice(0, 4));
  const price = read(c, "price", latestYear("price"), `${c.currency}/share`);
  const shares = read(c, "ordinaryShares", latestYear("ordinaryShares"), "shares");
  const factor = 1 - config.earningsHaircut;
  const discounted = { ...reference, low: reference.low * factor, high: reference.high * factor };
  let priceCondition = guardedQuote(c, shares, compare("ER.price", ratio(ratio(discounted, shares), price), ">=",
    config.minEarningsYield, `${factor} * min(median(E,7y),median(E,5y),median(E,3y),latest E) / ordinary market cap`));
  if (!c.quoteDate || c.quoteDate !== c.lastCompletedTradingDay ||
    !c.facts.some(f => f.field === "price" && f.period.end === c.quoteDate && f.state === "observed"))
    priceCondition = { ...pending("ER.price", "quote_date_unverified"), factIds: priceCondition.factIds,
      missing: distinct([...priceCondition.missing, "quote_date_unverified"]) };
  priceCondition.calculations = [{ id: "ER.reference", year, formula: "min(median(E,7y),median(E,5y),median(E,3y),latest E)",
    unit: c.currency, ...(isExact(reference) ? { value: reference.low } : {}), factIds: reference.facts,
    missing: reference.missing, assumptions: { earningsHaircut: config.earningsHaircut } }];
  const conditions = [history, compare("ER.positive", positives(earnings), ">=", 5, "count(E>0,7y)"),
    compare("ER.latest", earnings.at(-1)!, ">", 0, "latest E>0"),
    compare("ER.parentEquity", read(c, "parentEquity", year), ">", 0, "parent equity>0"),
    compare("ER.equity", read(c, "equity", year), ">", 0, "consolidated equity>0"), priceCondition];
  conditions.push(...knownAuditFailures(c, year, "ER.audit"));
  return { ...finish(conditions), signal: { name: "seven_year_discounted_earnings_yield", unit: "ratio",
    direction: "higher_is_better", ...(priceCondition.state !== "unknown" && priceCondition.value !== undefined ? { value: priceCondition.value } : {}) } };
}

/** Independent reported-book NCAV; quality/cycle/cash gates are deliberately absent. */
function ncavStrategy(input: CompanyFacts, policy: CnPolicy): StrategyResult {
  const finish = (
    conditions: ConditionResult[],
    applicability: ConditionState = "pass",
  ): StrategyResult => ({
    id: "ncav",
    applicability,
    state: aggregateConditions(conditions),
    conditions: conditions.map((r) => ({ ...r, layer: "ncav" })),
  });
  const unavailable = (
    reason: string,
    state: ConditionState = "unknown",
    applicability: ConditionState = "unknown",
  ): StrategyResult => ({
    id: "ncav",
    applicability,
    state,
    conditions: [{ ...pending("NCAV.method", reason, state), layer: "ncav" }],
  });
  if (
    input.identity?.state === "not_yet_listed" ||
    (input.collection && ["pending", "interrupted"].includes(input.collection.state))
  )
    return unavailable("ncav_not_evaluated", "not_evaluated");
  const c = { ...input, latestFiscalYear: latestDisclosedFiscalYear(input) },
    year = c.latestFiscalYear,
    date = `${year}-12-31`;
  const availableFamilies = eligibleFacts(c, "statementFamily", year).filter(
    (f) => f.state !== "missing",
  );
  const families = availableFamilies.filter(
    (f) =>
      f.state === "observed" &&
      f.unit === "text" &&
      f.evidence.length &&
      f.period.end === date &&
      ["银行", "证券", "保险"].includes(String(f.value)),
  );
  const familyValues = new Set(availableFamilies.map((f) => f.value));
  if (
    c.market === "CN" &&
    families.length &&
    families.length === availableFamilies.length &&
    familyValues.size === 1 &&
    !c.method.reason?.includes("conflict") &&
    !(c.method.state === "applies" && c.method.value === "nonfinancial")
  ) {
    const result = unavailable(
      "financial_statement_ncav_not_applicable",
      "not_applicable",
      "not_applicable",
    );
    result.conditions[0].factIds = families.map((f) => f.id);
    return result;
  }
  const valid =
    c.market === "CN" &&
    c.method.state === "applies" &&
    c.method.evidence.length > 0 &&
    c.method.coverage &&
    c.method.coverage.start <= date &&
    c.method.coverage.end >= date;
  if (!valid || c.method.value === "mixed") return unavailable("method_pending");
  if (c.method.value !== "nonfinancial")
    return unavailable("financial_ncav_not_applicable", "not_applicable", "not_applicable");
  if (!policy.strategies?.ncav)
    return unavailable("ncav_policy_not_enabled", "not_evaluated", "pass");
  if (c.currency !== "CNY") return unavailable("ncav_currency_unresolved", "unknown", "pass");
  if (Date.parse(c.asOf) > Date.parse(`${year + 2}-06-30T23:59:59Z`))
    return unavailable("stale_financials", "unknown", "pass");
  const ca = read(c, "currentAssets", year),
    liabilities = read(c, "liabilities", year);
  const nci = read(c, "minorityEquity", year),
    tools = read(c, "nonordinaryEquity", year);
  const nonnegative = (q: Quantity) => isExact(q) && q.low >= 0;
  const all = [ca, liabilities, nci, tools],
    ids = distinct(all.flatMap((q) => q.facts));
  const invalid = (reason: string): StrategyResult =>
    finish([
      {
        ...pending("NCAV.assets", reason),
        factIds: ids,
        missing: distinct([reason, ...all.flatMap((q) => q.missing)]),
      },
    ]);
  if (!nonnegative(ca) || !nonnegative(liabilities))
    return invalid("ncav_asset_liability_unresolved");
  // A pure missing operand permits a one-sided bound; a conflict/invalid value does not.
  const missingOnly = (field: string, q: Quantity) =>
    !isExact(q) &&
    !eligibleFacts(c, field, year).some((f) => f.state !== "missing") &&
    q.missing.every((m) => m === `${field}:${year}`);
  if (
    (!isExact(nci) && !missingOnly("minorityEquity", nci)) ||
    (!isExact(tools) && !missingOnly("nonordinaryEquity", tools)) ||
    (isExact(tools) && tools.low < 0)
  ) {
    // Unresolved ownership deductions cannot rescue nonpositive CA - L. Keep
    // the anomaly visible, and report only an upper bound, never an exact NCAV.
    const scope = c.checks.ncav;
    const coreConflict =
      scope?.evidence.length &&
      (scope.state === "unresolved" ||
        !scope.coverage ||
        scope.coverage.start > date ||
        scope.coverage.end < date);
    if (ca.low <= liabilities.low && !coreConflict) {
      const result = compare(
        "NCAV.assets",
        {
          low: -Infinity,
          high: ca.low - liabilities.low,
          facts: ids,
          missing: distinct(["ncav_equity_unresolved", ...all.flatMap((q) => q.missing)]),
        },
        ">",
        0,
        "NCAV <= CA - L; unresolved ownership deductions cannot increase ordinary claims",
      );
      return finish([{ ...result, reason: "ncav_nonpositive_asset_upper_bound" }]);
    }
    return invalid("ncav_equity_unresolved");
  }
  const details = ["preferredEquity", "perpetualEquity"].map((field) => read(c, field, year));
  const knownDetails = details.filter(isExact);
  if (isExact(tools) && knownDetails.reduce((total, q) => total + q.low, 0) > tools.low)
    return finish([
      {
        ...pending("NCAV.assets", "ncav_equity_total_conflict"),
        factIds: distinct([...ids, ...knownDetails.flatMap((q) => q.facts)]),
      },
    ]);
  // Only a sourced, applicable core issue blocks the strategy; missing optional reviews do not.
  const scope = c.checks.ncav;
  if (
    scope?.evidence.length &&
    (scope.state === "unresolved" ||
      !scope.coverage ||
      scope.coverage.start > date ||
      scope.coverage.end < date)
  )
    return finish([
      {
        ...pending("NCAV.assets", "ncav_core_conflict"),
        factIds: distinct([...ids, ...scope.evidence]),
      },
    ]);
  const exactEquity = isExact(nci) && isExact(tools);
  const upper =
    ca.low -
    liabilities.low -
    (isExact(nci) ? Math.max(nci.low, 0) : 0) -
    (isExact(tools) ? tools.low : 0);
  const ncav: Quantity = {
    low: exactEquity ? upper : -Infinity,
    high: upper,
    facts: ids,
    missing: distinct(all.flatMap((q) => q.missing)),
  };
  const assets = compare(
    "NCAV.assets",
    ncav,
    ">",
    0,
    "CA - L - max(NCI,0) - reported other equity tools",
  );
  const latestYear = (field: string) =>
    c.facts
      .filter(
        (f) =>
          f.field === field &&
          f.entity === c.companyId &&
          f.basis === c.basis &&
          Date.parse(f.publishedAt) <= Date.parse(c.asOf) &&
          Date.parse(f.period.end) <= Date.parse(c.asOf),
      )
      .sort((a, b) => b.period.end.localeCompare(a.period.end))[0]?.year ??
    Number(c.asOf.slice(0, 4));
  const price = read(c, "price", latestYear("price"), `${c.currency}/share`),
    shares = read(c, "ordinaryShares", latestYear("ordinaryShares"), "shares");
  const marketCap =
    isExact(price) && price.low > 0 && isExact(shares) && shares.low > 0
      ? exact(price.low * shares.low, [price, shares])
      : unresolved("ncav_market_cap_unresolved", distinct([...price.facts, ...shares.facts]));
  // Compare an amount gap, so a nonpositive NCAV never becomes a false positive ratio.
  const fraction = policy.strategies.ncav.marketCapRatio;
  const discount: Quantity = {
    ...sum([ncav, marketCap]),
    low: isExact(marketCap) ? ncav.low * fraction - marketCap.low : -Infinity,
    high: isExact(marketCap) ? ncav.high * fraction - marketCap.low : Infinity,
  };
  const discountCondition = compare(
    "NCAV.discount",
    discount,
    ">=",
    0,
    `${fraction} * NCAV_reported - same-rights ordinary market cap`,
  );
  // Floating operations at the inclusive boundary need machine-scale tolerance,
  // not a disclosure rounding allowance. Missing operands can never pass here.
  if (
    isExact(ncav) &&
    isExact(marketCap) &&
    Math.abs(discount.low) <=
      Number.EPSILON * 8 * Math.max(1, Math.abs(ncav.low * fraction), Math.abs(marketCap.low))
  )
    discountCondition.state = "pass";
  let priced = guardedQuote(c, shares, discountCondition);
  const quote = c.facts.find(
    (f) => f.field === "price" && f.year === latestYear("price") && f.period.end === c.quoteDate,
  );
  if (
    !c.quoteDate ||
    c.quoteDate !== c.lastCompletedTradingDay ||
    quote?.period.end !== c.quoteDate ||
    c.quoteDate > c.asOf.slice(0, 10)
  )
    priced = {
      ...pending("NCAV.discount", "quote_date_unverified"),
      factIds: priced.factIds,
      missing: distinct([
        "quote_date_unverified",
        ...priced.missing,
        ...price.missing,
        ...shares.missing,
      ]),
    };
  const result = finish([assets, priced]);
  if (
    exactEquity &&
    isExact(marketCap) &&
    priced.state !== "unknown" &&
    Number.isFinite(upper / marketCap.low)
  )
    result.signal = {
      name: "ncav_to_market_cap",
      unit: "ratio",
      direction: "higher_is_better",
      value: upper / marketCap.low,
    };
  else result.signal = { name: "ncav_to_market_cap", unit: "ratio", direction: "higher_is_better" };
  return result;
}

/** Classify a research candidate using the already validated price condition. */
function researchRanking(result: CompanyEvaluation, policy: CnPolicy): CompanyEvaluation["researchRanking"] {
  const financial = result.research !== "pass" && result.strategies?.financial_research?.state === "pass";
  if (result.research !== "pass" && !financial) return undefined;
  const conditions = financial ? result.strategies!.financial_value!.conditions : result.conditions;
  const leaves = (rows: ConditionResult[]): ConditionResult[] => rows.flatMap(r => [r, ...leaves(r.components ?? [])]);
  const all = leaves(conditions);
  const price = all.find(r => r.id === (financial ? "FV.P3" : "P3"));
  const returns = all.find(r => r.id === (financial ? "FR.roe5" : "P1.return")) ??
    (financial ? all.find(r => r.id === "FR.roe") : undefined);
  const normalYield = policy.priority.normalEarningsYield ?? 0.05;
  const lowPriceYield = policy.priority.earningsYield;
  const known = price && ["pass", "fail"].includes(price.state);
  const value = known && Number.isFinite(price.value) ? price.value : undefined;
  const lower = value ?? (known ? price.bounds?.lower : undefined);
  const upper = value ?? (known ? price.bounds?.upper : undefined);
  // Match decimal threshold boundaries despite machine rounding (e.g. 0.7/14).
  const atFloor = (n: number) => n >= normalYield ||
    Math.abs(n - normalYield) <= Number.EPSILON * 8 * Math.max(1, Math.abs(n), normalYield);
  const priceBand = !known ? "unknown" : price.state === "pass" ? "undervalued" :
    lower !== undefined && atFloor(lower) ? "normal" :
    upper !== undefined && !atFloor(upper) ? "expensive" : "unknown";
  return {
    priceBand, normalYield, lowPriceYield,
    priceCondition: price?.id ?? (financial ? "FV.P3" : "P3"),
    ...(value !== undefined ? { earningsYield: value } : {}),
    ...(returns?.state === "pass" && Number.isFinite(returns.value)
      ? { returnMedian: returns.value, returnCondition: returns.id } : {}),
  };
}

/** 只描述累计金额的同比变化；不推断经营原因，不改变年度资格、价格或排名。 */
export function recentFinancialChanges(c: CompanyFacts): NonNullable<CompanyEvaluation["recentFinancials"]> {
  const facts = c.facts.filter(f => f.field.startsWith("recent.") && f.entity === c.companyId &&
    Date.parse(f.publishedAt) <= Date.parse(c.asOf) && Date.parse(f.period.end) <= Date.parse(c.asOf));
  const periods = facts.filter(f => f.field === "recent.period").map(f => f.period.end).sort();
  const end = periods.at(-1);
  if (!end) return { state: "missing", reason: "recent_report_unavailable", metrics: [], hints: [] };
  const year = Number(end.slice(0, 4)), priorEnd = `${year - 1}${end.slice(4)}`;
  const yearNow = Number(c.asOf.slice(0, 4)), day = c.asOf.slice(5, 10);
  // 披露季内允许最近已公布报告；过常规披露窗口仍无当期，明确标旧而不回填。
  const expectedEnd = day >= "10-31" ? `${yearNow}-09-30` : day >= "08-31" ? `${yearNow}-06-30` :
    day >= "04-30" ? `${yearNow}-03-31` : `${yearNow - 1}-09-30`;
  const pick = (field: string, date: string) => {
    const all = facts.filter(f => f.field === `recent.${field}` && f.period.end === date);
    const latest = all.map(f => f.publishedAt).sort().at(-1);
    const rows = all.filter(f => f.publishedAt === latest);
    const conflicting = rows.some(f => f.state === "conflicting" || f.unit !== "CNY" ||
      f.basis !== c.basis || f.period.start !== `${date.slice(0, 4)}-01-01`) ||
      new Set(rows.filter(f => f.state === "observed").map(f => f.value)).size > 1;
    const complete = rows.length > 0 && rows.every(f => f.state === "observed" &&
      typeof f.value === "number" && Number.isFinite(f.value));
    return { rows, state: conflicting ? "conflicting" as const : complete ? "complete" as const : "missing" as const,
      value: !conflicting && complete ? rows[0].value as number : undefined };
  };
  const metrics: NonNullable<CompanyEvaluation["recentFinancials"]>["metrics"] = ["revenue", "parentProfit", "adjustedParentProfit", "operatingCashFlow"].map(field => {
    const current = pick(field, end), prior = pick(field, priorEnd);
    const state = current.state === "conflicting" || prior.state === "conflicting" ? "conflicting" as const :
      current.state === "complete" && prior.state === "complete" ? "complete" as const : "missing" as const;
    return { field, state, current: current.value, prior: prior.value,
      ...(state === "complete" ? { change: current.value! - prior.value!,
        ...(prior.value! > 0 ? { yoy: (current.value! - prior.value!) / prior.value! } :
          { yoyReason: "nonpositive_prior" as const }) } : {}),
      factIds: [...current.rows, ...prior.rows].map(f => f.id) };
  });
  const hints: string[] = [];
  for (const metric of metrics) if (metric.state === "complete") {
    if (metric.change! < 0) hints.push(`${metric.field}_decreased`);
    if (metric.current! < 0 && metric.prior! >= 0) hints.push(`${metric.field}_turned_negative`);
  }
  if (metrics[1].change !== undefined && metrics[1].change > 0 &&
    metrics[2].change !== undefined && metrics[2].change < 0)
    hints.push("parent_profit_up_adjusted_profit_down");
  return {
    state: metrics.some(m => m.state === "conflicting") ? "conflicting" :
      end < expectedEnd ? "stale" : metrics.some(m => m.state === "missing") ? "missing" : "complete",
    ...(end < expectedEnd ? { reason: "latest_expected_report_unavailable" } : {}),
    period: { start: `${year}-01-01`, end }, priorPeriod: { start: `${year - 1}-01-01`, end: priorEnd },
    publishedAt: facts.filter(f => f.period.end === end || f.period.end === priorEnd)
      .map(f => f.publishedAt).sort().at(-1), metrics, hints,
  };
}

/** Strategy projection keeps retained quality behavior independent of asset-price screening. */
// 单家公司入口：检查适用方法与历史窗口，执行必要条件，再分别形成研究与价格结论。
export function evaluateCompany(
  c: CompanyFacts,
  policy: CnPolicy,
  options: { evaluateAll?: boolean; strategy?: StrategySelector } = {},
): CompanyEvaluation {
  const result = evaluateQualityCompany(c, policy, {
    ...options,
    strategy: options.strategy === "all" ? "financial" : options.strategy,
  });
  if (
    (options.strategy === "financial" || options.strategy === "all") &&
    policy.strategies?.financialDiscount
  )
    result.strategies = {
      ...result.strategies,
      financial_discount: financialDiscountStrategy(c, policy),
    };
  if (options.strategy === "all" && policy.strategies?.earningsRepair)
    result.strategies = { ...result.strategies, earnings_repair: earningsRepairStrategy(c, policy) };
  if (options.strategy === "ncav" || options.strategy === "all") {
    result.strategies = { ...result.strategies, ncav: ncavStrategy(c, policy) };
    if (options.strategy === "all") {
      const notEvaluated =
        c.identity?.state === "not_yet_listed" ||
        (c.collection && ["pending", "interrupted"].includes(c.collection.state));
      for (const [id, state] of [
        ["quality_research", result.research],
        ["quality_value", result.priority],
      ] as const) {
        const conditions = result.conditions.filter((r) => id === "quality_value" || r.id !== "P3");
        result.strategies[id] = {
          id,
          applicability: notEvaluated
            ? "unknown"
            : c.method.state === "applies"
              ? "pass"
              : "unknown",
          state: notEvaluated ? "not_evaluated" : state,
          conditions,
        };
      }
    }
  }
  result.researchRanking = researchRanking(result, policy);
  if (result.research === "pass" && result.method.state === "applies" && result.method.value === "nonfinancial")
    result.recentFinancials = recentFinancialChanges(c);
  return result;
}
