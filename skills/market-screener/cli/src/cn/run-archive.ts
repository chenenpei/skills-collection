/**
 * 筛选运行归档：保存事实、政策、实现和结果，提供解释、诊断、比较与离线重放。
 * 重放使用归档时的实现与政策；重新筛选才使用当前规则。哈希校验失败时拒绝把归档当作可靠结果。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CLI_ROOT, hashFile, mapPool, readJsonLines, writeJsonLines } from "../shared/runtime.js";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import {
  type CompanyEvaluation,
  type ConditionResult,
  type ConditionState,
  type FinancialFact,
} from "../shared/financial-model.js";
import {
  openEvidenceInput,
  readEvidenceMetadata,
  readEvidenceCompanies,
  sha256,
  type EvidenceInput,
} from "./evidence.js";
import { loadCnPolicy, parseCnPolicy } from "../policy/loader.js";
import { evaluateCompanies, evaluateCompany, createEvaluationAccumulator } from "./screening.js";

type Summary = ReturnType<typeof evaluateCompanies>["summary"];
// Archive sources can include thousands of captures. Bound local I/O while
// retaining source order in metadata and error reporting.
const archiveIoConcurrency = 8;
interface Implementation {
  runtime: string;
  mode: string;
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  dependencyContents?: Record<string, string>;
}
interface Manifest {
  schemaVersion: 1 | 2;
  runId: string;
  createdAt: string;
  status: "complete" | "partial";
  policyVersion: string;
  hashes: Record<string, string>;
  displayLimit: number;
  backupLimit?: number;
  /** Historical archives used this field for shared financial-only seats. */
  financialLeadLimit?: number;
  evaluateAll?: boolean;
  strategy?: "all" | "quality" | "financial" | "ncav";
  modelCalls: 0;
  replayVerified?: boolean;
  collection?: Pick<
    NonNullable<EvidenceInput["collection"]>,
    "status" | "asOf" | "budget" | "requests"
  >;
  universe?: EvidenceInput["universe"];
  selection?: EvidenceInput["selection"];
}
function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
// 冻结实现：保存源码和依赖标识，结束前再次校验，防止一次运行混用两个版本。
async function implementationSnapshot(): Promise<Implementation> {
  const root = CLI_ROOT;
  const files: Record<string, string> = {};
  const collect = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const full = path.join(dir, entry.name),
        key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(full, key);
      else if (/\.(ts|js|json|yaml)$/.test(entry.name))
        files[key] = await fs.readFile(full, "utf8");
    }
  };
  await collect(path.join(root, "src"), "cli/src");
  for (const name of ["package.json", "package-lock.json", "tsconfig.json"])
    files[`cli/${name}`] = await fs.readFile(path.join(root, name), "utf8");
  const mode = import.meta.url.endsWith(".ts") ? "source" : "compiled";
  if (mode === "compiled") await collect(path.join(root, "dist"), "cli/dist");
  const lock = JSON.parse(files["cli/package-lock.json"]) as {
    packages: Record<string, { version?: string; optional?: boolean; dev?: boolean }>;
  };
  const dependencies: Record<string, string> = {};
  const dependencyContents: Record<string, string> = {};
  const hashPackage = async (dir: string): Promise<string> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const hashes = await Promise.all(
      entries
        .filter((e) => e.name !== "node_modules")
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map(async (entry) => {
          const file = path.join(dir, entry.name);
          return [
            entry.name,
            entry.isDirectory() ? await hashPackage(file) : sha256(await fs.readFile(file)),
          ];
        }),
    );
    return sha256(serialize(hashes));
  };
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name.startsWith("node_modules/")) continue;
    try {
      const content = await fs.readFile(path.join(root, name, "package.json"), "utf8");
      if (JSON.parse(content).version !== entry.version)
        throw new Error(`Installed dependency version mismatch: ${name}`);
      dependencies[name] = sha256(content);
      dependencyContents[name] = await hashPackage(path.join(root, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && (entry.optional || entry.dev))
        continue;
      throw error;
    }
  }
  return { runtime: process.version, mode, files, dependencies, dependencyContents };
}
export async function runEvidenceSnapshot(
  inputFile: string,
  outputDir: string,
  options: {
    policyFile: string;
    displayLimit?: number;
    backupLimit?: number;
    evaluateAll?: boolean;
    strategy?: "all" | "quality" | "financial" | "ncav";
  },
): Promise<void> {
  if (options.evaluateAll !== undefined && typeof options.evaluateAll !== "boolean")
    throw new Error("evaluateAll must be boolean");
  if (
    options.strategy !== undefined &&
    !["all", "quality", "financial", "ncav"].includes(options.strategy)
  )
    throw new Error("Unsupported strategy");
  const start = performance.now();
  const implementation = await implementationSnapshot();
  const opened = await openEvidenceInput(inputFile),
    { input, readSource } = opened;
  if (input.companies.some((c) => c.market !== "CN"))
    throw new Error("Evidence policy currently accepts CN only; use the existing US command");
  const policyText = await fs.readFile(options.policyFile, "utf8");
  const policy = parseCnPolicy(policyText);
  const strategy = options.strategy ?? "quality";
  const limit = options.displayLimit ?? policy.priority.displayLimit,
    backupLimit =
      options.backupLimit ?? policy.priority.backupLimit ?? policy.strategies?.financialDiscount?.displayLimit ?? 5,
    accumulator = createEvaluationAccumulator(limit, strategy, backupLimit);
  await fs.mkdir(path.dirname(path.resolve(outputDir)), { recursive: true });
  await fs.mkdir(outputDir); // Never overwrite a saved run.
  await fs.mkdir(path.join(outputDir, "sources"));
  const manifest: Manifest = {
    schemaVersion: 2,
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "partial",
    policyVersion: policy.version,
    displayLimit: limit,
    backupLimit,
    evaluateAll: options.evaluateAll ?? false,
    strategy,
    modelCalls: 0,
    hashes: {},
  };
  if (input.collection) {
    const { status, asOf, budget, requests } = input.collection;
    manifest.collection = { status, asOf, budget, requests };
  }
  if (input.universe) manifest.universe = input.universe;
  if (input.selection) manifest.selection = input.selection;
  await fs.writeFile(path.join(outputDir, "manifest.json"), serialize(manifest));
  // Save the whole identity catalogue before evaluating any company. Incomplete
  // record files never receive a verified manifest.
  await fs.writeFile(
    path.join(outputDir, "input.json"),
    serialize({ ...input, companies: input.companies.map((c) => ({ ...c, facts: [] })) }),
  );
  const headers: EvidenceInput["companies"] = [];
  const resultsFile = await fs.open(path.join(outputDir, "results.jsonl"), "wx");
  let companyHash: string;
  try {
    companyHash = await writeJsonLines(
      path.join(outputDir, "companies.jsonl"),
      (async function* () {
        for await (const c of opened.companies()) {
          const result = evaluateCompany(c, policy, { evaluateAll: options.evaluateAll, strategy });
          accumulator.accept(result);
          await resultsFile.writeFile(JSON.stringify(result) + "\n");
          headers.push({ ...c, facts: [] });
          yield { market: c.market, ticker: c.ticker, facts: c.facts };
        }
      })(),
    );
  } finally {
    await resultsFile.close();
  }
  input.companies = headers;
  const summary = accumulator.finish();
  if (serialize(implementation) !== serialize(await implementationSnapshot()))
    throw new Error("Implementation changed during run; retry from a stable worktree");
  const firstSourceAtPath = new Set<string>();
  const sourcePaths = input.sources.map(
    (source) =>
      `sources/${source.sha256}.${source.mediaType === "application/pdf" ? "pdf" : "json"}`,
  );
  const copySource = sourcePaths.map((sourcePath) => {
    if (firstSourceAtPath.has(sourcePath)) return false;
    firstSourceAtPath.add(sourcePath);
    return true;
  });
  const copies = await mapPool(input.sources, archiveIoConcurrency, async (source, index) => {
    try {
      const bytes = await readSource(source.id);
      if (copySource[index]) await fs.writeFile(path.join(outputDir, sourcePaths[index]), bytes);
      return {};
    } catch (error) {
      return { error };
    }
  });
  // Drain workers before surfacing an error so a failed run has no pending writes.
  for (const copy of copies) if ("error" in copy) throw copy.error;
  for (const [index, source] of input.sources.entries()) source.path = sourcePaths[index];
  const files: Record<string, string> = {
    "input.json": serialize({
      ...input,
      schemaVersion: 2,
      companyRecords: { path: "companies.jsonl", sha256: companyHash },
    }),
    "policy.yaml": policyText,
    "summary.json": serialize(summary),
    "implementation.json": serialize(implementation),
    "events.json": serialize([
      {
        stage: "snapshot_validation_and_evaluation",
        state: "complete",
        count: summary.inputCount,
        durationMs: performance.now() - start,
      },
    ]),
  };
  manifest.hashes["companies.jsonl"] = companyHash;
  manifest.hashes["results.jsonl"] = await hashFile(path.join(outputDir, "results.jsonl"));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(outputDir, name), content);
    manifest.hashes[name] = sha256(content);
  }
  await fs.writeFile(path.join(outputDir, "manifest.json"), serialize(manifest));
  await replayEvidenceRun(outputDir);
  manifest.status =
    input.universe?.status === "partial" ? "partial" : (input.collection?.status ?? "complete");
  manifest.replayVerified = true;
  await fs.writeFile(path.join(outputDir, "manifest.json"), serialize(manifest));
}
/** Open a saved run without retaining its entire fact/result payload. */
export async function openEvidenceRun(dir: string) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2)
    throw new Error("Unsupported run version");
  for (const name of [
    "input.json",
    "policy.yaml",
    "summary.json",
    "implementation.json",
    "events.json",
    ...(manifest.schemaVersion === 1 ? ["results.json"] : ["companies.jsonl", "results.jsonl"]),
  ]) {
    if ((await hashFile(path.join(dir, name))) !== manifest.hashes[name])
      throw new Error(`Run artifact hash mismatch: ${name}`);
  }
  const inputFile = path.join(dir, "input.json"),
    metadata = await readEvidenceMetadata(inputFile),
    { input } = metadata;
  if (!isDeepStrictEqual(manifest.selection, input.selection))
    throw new Error("Run selection does not match input");
  if (
    manifest.schemaVersion === 2 &&
    (!metadata.companyRecords ||
      metadata.companyRecords.path !== path.resolve(dir, "companies.jsonl") ||
      metadata.companyRecords.sha256 !== manifest.hashes["companies.jsonl"])
  )
    throw new Error("Run company records do not match manifest");
  if (manifest.schemaVersion === 1 && metadata.companyRecords)
    throw new Error("Legacy run cannot reference company records");
  const sourceHashes = await mapPool(input.sources, archiveIoConcurrency, async (source) => {
    const file = path.resolve(dir, source.path);
    if (!file.startsWith(path.resolve(dir) + path.sep))
      return { error: new Error("Saved source escapes run directory") };
    try {
      return { hash: await hashFile(file) };
    } catch (error) {
      return { error };
    }
  });
  for (const [index, source] of input.sources.entries()) {
    const result = sourceHashes[index];
    if ("error" in result) throw result.error;
    if (result.hash !== source.sha256) throw new Error(`Source hash mismatch: ${source.id}`);
  }
  const summary = JSON.parse(await fs.readFile(path.join(dir, "summary.json"), "utf8")) as Summary;
  const records = async function* (): AsyncGenerator<{
    company: EvidenceInput["companies"][number];
    result: CompanyEvaluation;
  }> {
    const results =
      manifest.schemaVersion === 2
        ? readJsonLines(path.join(dir, "results.jsonl"), manifest.hashes["results.jsonl"])
        : (async function* () {
            yield* JSON.parse(
              await fs.readFile(path.join(dir, "results.json"), "utf8"),
            ) as CompanyEvaluation[];
          })();
    try {
      for await (const company of readEvidenceCompanies(inputFile, metadata)) {
        const next = await results.next(),
          result = next.value as CompanyEvaluation;
        if (next.done || result.market !== company.market || result.ticker !== company.ticker)
          throw new Error("Saved company lacks matching result");
        yield { company, result };
      }
      if (!(await results.next()).done) throw new Error("Saved run contains extra results");
    } finally {
      await results.return(undefined);
    }
  };
  return { manifest, input, summary, records };
}

type StateCounts = Record<ConditionState, number>;
const conditionStates: ConditionState[] = [
  "pass",
  "fail",
  "unknown",
  "not_applicable",
  "not_evaluated",
];
const emptyStateCounts = (): StateCounts =>
  Object.fromEntries(conditionStates.map((state) => [state, 0])) as StateCounts;
const sortedCounts = (counts: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, "en")),
  );
const sortedRows = <T>(rows: Record<string, T>) =>
  Object.fromEntries(
    Object.entries(rows).sort(([left], [right]) => left.localeCompare(right, "en")),
  );
const walkConditionEntries = (
  conditions: ConditionResult[],
  blocked = false,
): Array<{ condition: ConditionResult; blocked: boolean }> =>
  conditions.flatMap((condition) => {
    const blockedHere =
      blocked || condition.state === "fail" || condition.state === "not_evaluated";
    return [
      { condition, blocked },
      ...walkConditionEntries(condition.components ?? [], blockedHere),
    ];
  });
const isNecessaryCondition = (condition: ConditionResult) => condition.layer === "quality";

/**
 * Derive saved-run coverage diagnostics without re-evaluation, source reads, or
 * collection. Missing-data classifications deliberately describe only archive
 * observations: an absent supported fact is not evidence that a disclosure is
 * unavailable or undisclosed.
 */
// 可观测性：分别统计筛选条件、缺失事实及采集失败，不把网络失败解释成公司质量差。
export async function diagnoseEvidenceRun(run: Awaited<ReturnType<typeof openEvidenceRun>>) {
  type MissingRow = {
    count: number;
    actionable: number;
    observedMissingOrNull: number;
    noSupportedMappingOrSourceFact: number;
  };
  type Qualification = "quality" | "research" | string;
  type NecessaryRow = {
    qualification: Qualification;
    states: StateCounts;
    factReferences: Record<string, number>;
    missing: Record<string, MissingRow>;
    machineReasons: Record<string, number>;
  };
  type GroupRow = {
    companies: number;
    strategies?: Record<string, StateCounts>;
    quality: StateCounts;
    research?: StateCounts;
    priority: StateCounts;
    collection: Record<string, number>;
    requests: number;
    eventDurationMs: number;
    sourceErrors: number;
    cacheHits: number;
    methodValidationPending: number;
    methodNotSupported: number;
    knownFailWithGaps: number;
  };
  const strategy = run.manifest.strategy ?? "quality";
  const selectedStrategyIds = (result: CompanyEvaluation) =>
    strategy === "quality"
      ? []
      : strategy === "financial"
        ? ["financial_research", "financial_value", "financial_discount"]
        : strategy === "ncav"
          ? ["ncav"]
          : Object.keys(result.strategies ?? {});
  const entries = (result: CompanyEvaluation) => {
    const base =
      strategy === "financial" || strategy === "ncav"
        ? []
        : walkConditionEntries(result.conditions)
            .filter(
              ({ condition }) =>
                isNecessaryCondition(condition) ||
                (result.research !== undefined && /^P[12](?:\.|$)/.test(condition.id)),
            )
            .map((entry) => ({
              ...entry,
              qualification: (isNecessaryCondition(entry.condition)
                ? "quality"
                : "research") as Qualification,
            }));
    // In an all-strategy archive, quality strategies are views of the retained
    // base conditions. Count their condition evidence once.
    const seen = new Set(base.map(({ condition }) => condition.id));
    const selected = selectedStrategyIds(result).flatMap((id) =>
      walkConditionEntries(
        result.strategies?.[id as keyof NonNullable<CompanyEvaluation["strategies"]>]?.conditions ??
          [],
      )
        .filter(({ condition }) => !seen.has(condition.id) && !!seen.add(condition.id))
        .map((entry) => ({ ...entry, qualification: id })),
    );
    return [...base, ...selected];
  };
  const state = (result: CompanyEvaluation, qualification: Qualification) =>
    qualification === "quality" || qualification === "research"
      ? result[qualification]
      : result.strategies?.[qualification as keyof NonNullable<CompanyEvaluation["strategies"]>]
          ?.state;
  const hasUnsupported = (result: CompanyEvaluation) =>
    entries(result).some(({ condition }) => condition.reason === "financial_method_not_supported");
  const hasPending = (result: CompanyEvaluation) =>
    entries(result).some(
      ({ condition }) =>
        condition.reason === "financial_method_pending" ||
        condition.reason === "method_pending" ||
        condition.reason === "ncav_method_pending",
    );
  const hasGaps = (result: CompanyEvaluation) =>
    entries(result).some(
      ({ condition, qualification }) =>
        state(result, qualification) === "fail" && condition.state === "unknown",
    );
  const necessaryConditions: Record<string, NecessaryRow> = {};
  const strategyConditions: Record<string, Record<string, NecessaryRow>> = {};
  const byMethod: Record<string, GroupRow> = {},
    byIndustry: Record<string, GroupRow> = {};
  const rawReasons: Record<string, number> = {},
    collectionStates: Record<string, number> = {},
    collectionErrors: Record<string, number> = {},
    eventStates: Record<string, number> = {},
    cycleStates: Record<string, number> = {},
    cycleReasons: Record<string, number> = {};
  const tickerGroups = new Map<string, { method: string; industries: string[] }>();
  const factFieldsByTickerSource = new Map<string, Map<string, Map<string, Set<number>>>>();
  const companyErrors: Array<{ ticker: string; error: string }> = [];
  const missingConditions: Array<{
    ticker: string;
    strategy: Qualification;
    conditionId: string;
    missing: string[];
    qualificationState: ConditionState | undefined;
    actionable: boolean;
  }> = [];
  let knownFailWithGaps = 0,
    methodValidationPending = 0,
    methodNotSupported = 0,
    companyRequests = 0,
    eventDurationMs = 0,
    cacheHits = 0,
    eventSourceErrors = 0;
  const group = (rows: Record<string, GroupRow>, label: string, result: CompanyEvaluation) => {
    const row = (rows[label] ??= {
      companies: 0,
      quality: emptyStateCounts(),
      ...(result.research !== undefined ? { research: emptyStateCounts() } : {}),
      priority: emptyStateCounts(),
      collection: {},
      requests: 0,
      eventDurationMs: 0,
      sourceErrors: 0,
      cacheHits: 0,
      methodValidationPending: 0,
      methodNotSupported: 0,
      knownFailWithGaps: 0,
    });
    row.companies++;
    row.quality[result.quality]++;
    row.priority[result.priority]++;
    if (row.research && result.research !== undefined) row.research[result.research]++;
    const state = result.collection?.state ?? "not_collected";
    row.collection[state] = (row.collection[state] ?? 0) + 1;
    row.requests += result.collection?.requests ?? 0;
    if (strategy !== "quality") {
      row.strategies ??= {};
      for (const id of selectedStrategyIds(result)) {
        const value = result.strategies?.[id as keyof NonNullable<CompanyEvaluation["strategies"]>];
        if (value) (row.strategies[id] ??= emptyStateCounts())[value.state]++;
      }
    }
    const pending = hasPending(result),
      gaps = hasGaps(result);
    if (pending) row.methodValidationPending++;
    if (hasUnsupported(result)) row.methodNotSupported++;
    if (gaps) row.knownFailWithGaps++;
  };
  for await (const { company, result } of run.records()) {
    const facts = new Map<string, FinancialFact>(
      [...company.facts, ...(result.derivedFacts ?? [])].map((fact) => [fact.id, fact]),
    );
    const sourceFields =
      factFieldsByTickerSource.get(company.ticker) ?? new Map<string, Map<string, Set<number>>>();
    factFieldsByTickerSource.set(company.ticker, sourceFields);
    for (const fact of facts.values())
      if (fact.state === "observed")
        for (const evidence of fact.evidence) {
          const fields =
            sourceFields.get(evidence.sourceId) ??
            sourceFields.set(evidence.sourceId, new Map()).get(evidence.sourceId)!;
          (fields.get(fact.field) ?? fields.set(fact.field, new Set()).get(fact.field)!).add(
            fact.year,
          );
        }
    const fields = new Map<string, FinancialFact[]>();
    for (const fact of facts.values()) {
      const key = `${fact.field}:${fact.year}`,
        rows = fields.get(key) ?? [];
      rows.push(fact);
      fields.set(key, rows);
    }
    const necessaryEntries = entries(result);
    if (hasGaps(result)) knownFailWithGaps++;
    if (hasPending(result)) methodValidationPending++;
    if (hasUnsupported(result)) methodNotSupported++;
    const method =
      company.method.state === "applies" ? (company.method.value ?? "unresolved") : "unresolved";
    const industries = [
      ...new Set(
        company.identity?.industryLabels.length ? company.identity.industryLabels : ["unlabeled"],
      ),
    ];
    tickerGroups.set(company.ticker, { method, industries });
    group(byMethod, method, result);
    for (const industry of industries) group(byIndustry, industry, result);
    const cycle = company.checks.cycle;
    const cycleState = cycle?.state ?? "unresolved",
      cycleReason = cycle?.reason ?? "no_recorded_cycle_reason";
    cycleStates[cycleState] = (cycleStates[cycleState] ?? 0) + 1;
    cycleReasons[cycleReason] = (cycleReasons[cycleReason] ?? 0) + 1;
    const collection = result.collection;
    const collectionState = collection?.state ?? "not_collected";
    collectionStates[collectionState] = (collectionStates[collectionState] ?? 0) + 1;
    companyRequests += collection?.requests ?? 0;
    for (const error of collection?.errors ?? []) {
      collectionErrors[error] = (collectionErrors[error] ?? 0) + 1;
      companyErrors.push({ ticker: company.ticker, error });
    }
    const reportedMissingConditions = new Set<string>();
    // The legacy global table deduplicates shared conditions. Per-strategy
    // tables retain each condition's ownership, including FR reused by FV.
    const diagnosticEntries = [
      ...necessaryEntries.map((entry) => ({ ...entry, table: necessaryConditions, global: true })),
      ...selectedStrategyIds(result).flatMap((id) =>
        walkConditionEntries(
          result.strategies?.[id as keyof NonNullable<CompanyEvaluation["strategies"]>]
            ?.conditions ?? [],
        ).map((entry) => ({
          ...entry,
          qualification: id,
          table: (strategyConditions[id] ??= {}),
          global: false,
        })),
      ),
    ];
    for (const { condition, blocked, qualification, table, global } of diagnosticEntries) {
      const row = (table[condition.id] ??= {
        qualification,
        states: emptyStateCounts(),
        factReferences: {},
        missing: {},
        machineReasons: {},
      });
      row.states[condition.state]++;
      if (condition.reason !== "all_required") {
        row.machineReasons[condition.reason] = (row.machineReasons[condition.reason] ?? 0) + 1;
        if (global) rawReasons[condition.reason] = (rawReasons[condition.reason] ?? 0) + 1;
      }
      for (const factId of new Set(condition.factIds)) {
        const field = facts.get(factId)?.field ?? `unresolved_fact_id:${factId}`;
        row.factReferences[field] = (row.factReferences[field] ?? 0) + 1;
      }
      // Keep concurrent gaps beside a known fail, but distinguish them from
      // fields that remain actionable for companies not already quality-failed.
      if (condition.state !== "unknown") continue;
      const qualificationState = state(result, qualification);
      missingConditions.push({
        ticker: company.ticker,
        strategy: qualification,
        conditionId: condition.id,
        missing: [...new Set(condition.missing)].sort((left, right) =>
          left.localeCompare(right, "en"),
        ),
        qualificationState,
        actionable:
          qualificationState !== "fail" &&
          !blocked &&
          condition.reason !== "financial_method_not_supported",
      });
      reportedMissingConditions.add(condition.id);
      for (const missing of new Set(condition.missing)) {
        const matching = fields.get(missing) ?? [];
        const observedMissingOrNull = matching.some(
          (fact) =>
            fact.state === "missing" || fact.evidence.some((reference) => reference.raw === null),
        );
        const missingRow = (row.missing[missing] ??= {
          count: 0,
          actionable: 0,
          observedMissingOrNull: 0,
          noSupportedMappingOrSourceFact: 0,
        });
        missingRow.count++;
        if (
          state(result, qualification) !== "fail" &&
          !blocked &&
          condition.reason !== "financial_method_not_supported"
        )
          missingRow.actionable++;
        if (observedMissingOrNull) missingRow.observedMissingOrNull++;
        else if (matching.length === 0) missingRow.noSupportedMappingOrSourceFact++;
        if (global) rawReasons[missing] = (rawReasons[missing] ?? 0) + 1;
      }
    }
    // Price and other non-necessary conditions are absent from the legacy
    // necessary-condition table, but remain a user-visible unresolved gap.
    for (const { condition, blocked } of walkConditionEntries(result.conditions)) {
      if (condition.state !== "unknown" || reportedMissingConditions.has(condition.id)) continue;
      const qualificationState = result.quality;
      missingConditions.push({
        ticker: company.ticker,
        strategy: "quality",
        conditionId: condition.id,
        missing: [...new Set(condition.missing)].sort((left, right) =>
          left.localeCompare(right, "en"),
        ),
        qualificationState,
        actionable:
          qualificationState !== "fail" &&
          !blocked &&
          condition.reason !== "financial_method_not_supported",
      });
    }
  }
  const events = run.input.collection?.events ?? [];
  const sourceById = new Map(run.input.sources.map((source) => [source.id, source]));
  type IssueCategory =
    | "parser_or_validation"
    | "empty_or_undetermined"
    | "transport"
    | "budget_or_interruption"
    | "endpoint_backoff"
    | "disclosure_gap"
    | "history_gap"
    | "share_scope"
    | "source_conflict"
    | "unknown";
  type CauseCertainty = "observed" | "undetermined";
  const classifyIssue = (
    reason: string | undefined,
    state: string,
  ): { category: IssueCategory; causeCertainty: CauseCertainty } => {
    if (reason?.startsWith("history_extension_deferred:"))
      return { category: "history_gap", causeCertainty: "observed" };
    if (reason === "ordinary_share_count_unresolved")
      return { category: "share_scope", causeCertainty: "observed" };
    if (reason?.startsWith("annual_report_"))
      return { category: "disclosure_gap", causeCertainty: "undetermined" };
    if (/conflict/i.test(reason ?? ""))
      return { category: "source_conflict", causeCertainty: "undetermined" };
    if (
      state === "interrupted" ||
      reason === "interrupted" ||
      reason?.startsWith("collection_limit:")
    )
      return { category: "budget_or_interruption", causeCertainty: "observed" };
    if (reason === "endpoint_temporarily_unavailable")
      return { category: "endpoint_backoff", causeCertainty: "observed" };
    if (/^http_\d{3}$/.test(reason ?? ""))
      return { category: "transport", causeCertainty: "observed" };
    if (reason === "source_no_records" || reason === "negative_cache_no_records")
      return { category: "empty_or_undetermined", causeCertainty: "observed" };
    if (/^no_supported_(?:annual_amounts|disclosure|quote)_at_cutoff$/.test(reason ?? ""))
      return { category: "empty_or_undetermined", causeCertainty: "undetermined" };
    // A cache/PDF identity validation is observed, but the underlying reason
    // for the mismatch remains unproven. Other invalid/empty payloads do not
    // establish a parser defect without a reproducible validation result.
    if (
      reason?.startsWith("annual_cache_invalid:") ||
      /PDF cover identity\/year mismatch|Statement entity mismatch|Statement missing publication date or currency/i.test(
        reason ?? "",
      ) ||
      /pdf[ _/-]*(?:cover[ _/-]*)?(?:issuer|identity|year|unit)[ _/-]*mismatch/i.test(reason ?? "")
    )
      return { category: "parser_or_validation", causeCertainty: "undetermined" };
    if (/(?:parse|parser|invalid|validation|schema|unexpected)/i.test(reason ?? ""))
      return { category: "empty_or_undetermined", causeCertainty: "undetermined" };
    // A generic fetch failure is an observed failure event, not evidence of a
    // network cause. Keep its cause deliberately unresolved.
    if (/(?:fetch|socket|timeout|network|ECONN|ETIMEDOUT)/i.test(reason ?? ""))
      return { category: "transport", causeCertainty: "undetermined" };
    return { category: "unknown", causeCertainty: "undetermined" };
  };
  const endpointLabel = (url: string) => {
    try {
      const parsed = new URL(url),
        reportName = parsed.searchParams.get("reportName");
      if (/\.pdf$/i.test(parsed.pathname)) return `${parsed.origin}/#annual-pdf`;
      return `${parsed.origin}${parsed.pathname}${reportName ? `#${reportName}` : ""}`;
    } catch {
      return url;
    }
  };
  const normaliseReason = (reason: string) =>
    reason.replace(/(?:collected|circuit):[A-Za-z0-9-]+:[^:\s]+:([A-Za-z0-9_-]+)(?::\d+)?/g, "$1");
  const suggestedAction = (category: IssueCategory) =>
    category === "budget_or_interruption"
      ? "record the stopped limit before scheduling any bounded retry"
      : category === "endpoint_backoff"
        ? "inspect the endpoint backoff evidence before retrying"
        : category === "parser_or_validation"
          ? "inspect the saved response and validation evidence"
          : category === "empty_or_undetermined"
            ? "retain the gap as undetermined unless an explicit no-record result is recorded"
            : category === "transport"
              ? "inspect the recorded request and response before attributing a transport cause"
              : "preserve the trace and investigate only with bounded evidence";
  const sourceKinds = new Set([
    "income",
    "balance",
    "cashflow",
    "indicators",
    "company-profile",
    "share-structure",
    "cninfo-stock-list",
    "cninfo-announcements",
    "cninfo-annual-pdf",
    "eastmoney-daily",
    "eastmoney-shares",
    "eastmoney-session",
    "tencent-daily",
    "tencent-session",
    "sse-list",
    "szse-list",
    "bse-list",
    "regulatory-reference-v1",
  ]);
  const sourceKind = (sourceId: string) =>
    sourceById.get(sourceId)?.mapping ??
    sourceId.match(/^(?:collected|circuit):[^:]+:[^:]+:([^:]+)(?::\d+)?$/)?.[1];
  const capability = (kind: string | undefined): string[] =>
    kind === "eastmoney-shares" || kind === "share-structure"
      ? ["ordinaryShares"]
      : kind === "eastmoney-daily" || kind === "tencent-daily"
        ? ["price"]
        : kind === "eastmoney-session" || kind === "tencent-session"
          ? ["scope.lastCompletedTradingDay"]
          : [];
  const seenSources = new Map<string, Set<string>>(),
    seenEndpoints = new Set<string>();
  const eventIssues: Array<{
    id: string;
    ticker: string;
    endpoint: string;
    url: string;
    sourceId: string;
    attempt: number;
    state: string;
    reason: string;
    category: IssueCategory;
    causeCertainty: CauseCertainty;
    suggestedAction: string;
    requestRecovery: "recovered" | "not_recovered";
    dataRecovery: "verified_later_source" | "unknown";
    verifiedFields: Array<{ sourceId: string; field: string; year: number }>;
    request?: unknown;
    source?: { id: string; path: string; url: string; fetchedAt: string };
  }> = [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.state === "source_error" || event.state === "interrupted") {
      const { category, causeCertainty } = classifyIssue(event.reason, event.state);
      const supportedFields = new Set(capability(sourceKind(event.sourceId)));
      const laterSources = seenSources.get(event.ticker) ?? new Set<string>();
      const verifiedFields = [...laterSources]
        .flatMap((sourceId) => {
          const fields =
            factFieldsByTickerSource.get(event.ticker)?.get(sourceId) ??
            new Map<string, Set<number>>();
          return [...fields]
            .filter(([field]) => supportedFields.has(field))
            .flatMap(([field, years]) => [...years].map((year) => ({ sourceId, field, year })));
        })
        .sort(
          (left, right) =>
            left.field.localeCompare(right.field, "en") ||
            left.sourceId.localeCompare(right.sourceId, "en") ||
            left.year - right.year,
        );
      const source = sourceById.get(event.sourceId);
      eventIssues.push({
        id: `event:${index}`,
        ticker: event.ticker,
        endpoint: endpointLabel(event.url),
        url: event.url,
        sourceId: event.sourceId,
        attempt: event.attempt,
        state: event.state,
        reason: normaliseReason(event.reason ?? "no_recorded_reason"),
        category,
        causeCertainty,
        suggestedAction: suggestedAction(category),
        requestRecovery: seenEndpoints.has(`${event.ticker}\u0000${event.url}`)
          ? "recovered"
          : "not_recovered",
        dataRecovery: verifiedFields.length ? "verified_later_source" : "unknown",
        verifiedFields,
        request: source?.request,
        source: source
          ? { id: source.id, path: source.path, url: source.url, fetchedAt: source.fetchedAt }
          : undefined,
      });
    }
    if (event.state === "success" || event.state === "cache_hit") {
      (
        seenSources.get(event.ticker) ?? seenSources.set(event.ticker, new Set()).get(event.ticker)!
      ).add(event.sourceId);
      seenEndpoints.add(`${event.ticker}\u0000${event.url}`);
    }
  }
  eventIssues.reverse();
  const companyErrorDetail = (error: string) => {
    const separator = error.indexOf(":"),
      prefix = separator < 0 ? undefined : error.slice(0, separator);
    return prefix && sourceKinds.has(prefix)
      ? { sourceHint: prefix, reason: error.slice(separator + 1) }
      : { reason: error };
  };
  const recordedErrorKeys = new Set(
    events
      .filter((event) => event.reason)
      .map((event) => `${event.ticker}:${normaliseReason(event.reason!)}`),
  );
  const coarseIssues = companyErrors
    .map(({ ticker, error }) => ({ ticker, ...companyErrorDetail(error) }))
    .filter(({ ticker, reason }) => !recordedErrorKeys.has(`${ticker}:${normaliseReason(reason)}`))
    .map(({ ticker, sourceHint, reason }, index) => {
      const { category, causeCertainty } = classifyIssue(reason, "company_error");
      return {
        id: `company:${index}`,
        ticker,
        sourceHint,
        reason: normaliseReason(reason),
        category,
        causeCertainty,
        suggestedAction: suggestedAction(category),
        recovery: "not_recorded" as const,
      };
    });
  const issues = [...eventIssues, ...coarseIssues];
  const issueIdsByTicker = new Map<string, string[]>();
  for (const issue of issues) {
    const ids = issueIdsByTicker.get(issue.ticker) ?? [];
    ids.push(issue.id);
    issueIdsByTicker.set(issue.ticker, ids);
  }
  const missingByStrategy = Object.fromEntries(
    [...missingConditions]
      .sort(
        (left, right) =>
          left.strategy.localeCompare(right.strategy, "en") ||
          left.conditionId.localeCompare(right.conditionId, "en") ||
          left.ticker.localeCompare(right.ticker, "en"),
      )
      .map((row) => {
        const associatedIssueIds = issueIdsByTicker.get(row.ticker) ?? [];
        return [
          `${row.strategy}:${row.conditionId}:${row.ticker}`,
          {
            ...row,
            associatedIssueIds,
            association: associatedIssueIds.length ? "same_company_collection_issue" : "none",
            causalCertainty: "undetermined" as const,
          },
        ];
      }),
  );
  const endpointReasonRows: Record<
    string,
    {
      endpoint: string;
      reason: string;
      events: number;
      companies: number;
      actualRequests: number;
      skips: number;
    }
  > = {};
  const endpointReasonCompanies = new Map<string, Set<string>>();
  for (const issue of eventIssues) {
    const key = `${issue.endpoint}\u0000${issue.reason}`,
      row = (endpointReasonRows[key] ??= {
        endpoint: issue.endpoint,
        reason: issue.reason,
        events: 0,
        companies: 0,
        actualRequests: 0,
        skips: 0,
      });
    row.events++;
    if (issue.attempt > 0) row.actualRequests++;
    else row.skips++;
    (endpointReasonCompanies.get(key) ?? endpointReasonCompanies.set(key, new Set()).get(key)!).add(
      issue.ticker,
    );
  }
  for (const [key, row] of Object.entries(endpointReasonRows))
    row.companies = endpointReasonCompanies.get(key)?.size ?? 0;
  for (const event of events) {
    eventStates[event.state] = (eventStates[event.state] ?? 0) + 1;
    eventDurationMs += event.durationMs;
    if (event.state === "cache_hit") cacheHits++;
    if (event.state === "source_error") eventSourceErrors++;
    if (event.reason) collectionErrors[event.reason] = (collectionErrors[event.reason] ?? 0) + 1;
    const groups = tickerGroups.get(event.ticker);
    const addEvent = (row: GroupRow) => {
      row.eventDurationMs += event.durationMs;
      if (event.state === "source_error") row.sourceErrors++;
      if (event.state === "cache_hit") row.cacheHits++;
    };
    if (groups) {
      const method = byMethod[groups.method];
      if (method) addEvent(method);
      for (const industry of groups.industries) {
        const row = byIndustry[industry];
        if (row) addEvent(row);
      }
    }
  }
  const orderedNecessary = Object.fromEntries(
    Object.entries(necessaryConditions)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([id, row]) => [
        id,
        {
          qualification: row.qualification,
          states: row.states,
          factReferences: sortedCounts(row.factReferences),
          missing: sortedRows(row.missing),
          machineReasons: sortedCounts(row.machineReasons),
        },
      ]),
  );
  const orderedGroups = (rows: Record<string, GroupRow>) =>
    sortedRows(
      Object.fromEntries(
        Object.entries(rows).map(([label, row]) => [
          label,
          { ...row, collection: sortedCounts(row.collection) },
        ]),
      ),
    );
  return {
    necessaryConditions: orderedNecessary,
    strategyConditions: sortedRows(
      Object.fromEntries(
        Object.entries(strategyConditions).map(([id, rows]) => [id, sortedRows(rows)]),
      ),
    ),
    diagnosis: {
      byMethod: orderedGroups(byMethod),
      byIndustry: orderedGroups(byIndustry),
      routing: {
        cycle: { states: sortedCounts(cycleStates), reasons: sortedCounts(cycleReasons) },
      },
      methodValidationPending,
      methodNotSupported,
      knownFailWithGaps,
      rawReasons: sortedCounts(rawReasons),
    },
    collection: {
      requests: { recorded: run.input.collection?.requests ?? 0, companyTotal: companyRequests },
      wallElapsedMs: run.input.collection?.finishedAt
        ? Math.max(
            0,
            Date.parse(run.input.collection.finishedAt) -
              Date.parse(run.input.collection.startedAt),
          )
        : null,
      eventDurationMs,
      eventStates: sortedCounts(eventStates),
      cacheHits,
      sourceErrors: eventSourceErrors,
      companyStates: sortedCounts(collectionStates),
      errors: sortedCounts(collectionErrors),
      issues: {
        items: issues,
        byEndpointAndReason: sortedRows(endpointReasonRows),
        missingConditions: missingByStrategy,
      },
    },
    modelCalls: run.manifest.modelCalls,
  };
}

/**
 * Return the collection observations and unresolved condition gaps for one
 * saved company. Associations mean only that both were recorded for the same
 * company; they deliberately do not assert that an issue caused a gap.
 */
export function explainCompanyCollectionDiagnostics(
  diagnostics: Awaited<ReturnType<typeof diagnoseEvidenceRun>>,
  ticker: string,
) {
  const issues = diagnostics.collection.issues;
  return {
    items: issues.items.filter((issue) => issue.ticker === ticker),
    missingConditions: Object.values(issues.missingConditions).filter(
      (row) => row.ticker === ticker,
    ),
  };
}
/** Compatibility adapter for callers explicitly requesting all records in memory. */
export async function readEvidenceRun(dir: string): Promise<{
  manifest: Manifest;
  input: EvidenceInput;
  results: CompanyEvaluation[];
  summary: Summary;
}> {
  const run = await openEvidenceRun(dir),
    companies: EvidenceInput["companies"] = [],
    results: CompanyEvaluation[] = [];
  for await (const record of run.records()) {
    companies.push(record.company);
    results.push(record.result);
  }
  return {
    manifest: run.manifest,
    input: { ...run.input, companies },
    summary: run.summary,
    results,
  };
}
/** npm records this package's executable path in the root lock entry. It does
 * not describe an installed dependency, so source-to-dist packaging changes
 * may differ there while the dependency lock remains identical. */
function differsOnlyByRootPackageBin(savedLock: string, currentLock: string): boolean {
  if (savedLock === currentLock) return true;
  try {
    const saved = JSON.parse(savedLock),
      current = JSON.parse(currentLock);
    const savedRoot = saved?.packages?.[""],
      currentRoot = current?.packages?.[""];
    if (!savedRoot || !currentRoot || isDeepStrictEqual(savedRoot.bin, currentRoot.bin))
      return false;
    delete savedRoot.bin;
    delete currentRoot.bin;
    return isDeepStrictEqual(saved, current);
  } catch {
    return false;
  }
}
async function replaySavedImplementation(
  dir: string,
  saved: Implementation,
  current: Implementation,
): Promise<{ matches: true; count: number }> {
  if (saved.runtime !== process.version)
    throw new Error(`Replay requires recorded runtime ${saved.runtime}`);
  if (
    !differsOnlyByRootPackageBin(
      saved.files["cli/package-lock.json"],
      current.files["cli/package-lock.json"],
    )
  )
    throw new Error(
      "Replay dependencies differ; restore the saved package lock and install dependencies first",
    );
  if (saved.dependencies && serialize(saved.dependencies) !== serialize(current.dependencies))
    throw new Error("Installed dependency metadata differs from saved runtime");
  if (
    saved.dependencyContents &&
    serialize(saved.dependencyContents) !== serialize(current.dependencyContents)
  )
    throw new Error("Installed dependency content differs from saved runtime");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "screener-replay-"));
  try {
    for (const [name, content] of Object.entries(saved.files)) {
      const target = path.resolve(temporary, name);
      if (!target.startsWith(temporary + path.sep) || !/^(cli|spec)\//.test(name))
        throw new Error("Invalid implementation snapshot path");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    await fs.symlink(
      path.join(CLI_ROOT, "node_modules"),
      path.join(temporary, "cli", "node_modules"),
      "dir",
    );
    const deny = path.join(temporary, "deny-network.mjs");
    await fs.writeFile(
      deny,
      `
import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const deny=()=>{throw new Error('Network disabled during replay');};
net.connect=deny; net.createConnection=deny; net.Socket.prototype.connect=deny; tls.connect=deny;
http.request=deny; http.get=deny; https.request=deny; https.get=deny; globalThis.fetch=deny; syncBuiltinESMExports();
Reflect.set(globalThis,Symbol.for('screener.offlineReplay'),true);
`,
    );
    const heapLimit = process.execArgv.find((arg) => /^--max-old-space-size=\d+$/.test(arg));
    // Resolve from the saved layout, including archives created before bin/ was retired.
    const entry =
      saved.mode === "source"
        ? saved.files["cli/bin/screener.ts"]
          ? "bin/screener.ts"
          : "src/cli.ts"
        : saved.files["cli/dist/bin/screener.js"]
          ? "dist/bin/screener.js"
          : "dist/cli.js";
    if (!saved.files[`cli/${entry}`]) throw new Error("Saved implementation has no CLI entry");
    const args = [
      ...(heapLimit ? [heapLimit] : []),
      "--import",
      deny,
      ...(saved.mode === "source" ? ["--import", "tsx"] : []),
      entry,
      "replay",
      path.resolve(dir),
    ];
    const result = await promisify(execFile)(process.execPath, args, {
      cwd: path.join(temporary, "cli"),
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        SCREENER_REPLAY_ISOLATED: "1",
      },
    });
    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.matches !== true || !Number.isInteger(parsed.count))
      throw new Error("Invalid saved replay response");
    return parsed;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
export async function replayEvidenceRun(dir: string): Promise<{ matches: true; count: number }> {
  const run = await openEvidenceRun(dir);
  const saved = await fs.readFile(path.join(dir, "implementation.json"), "utf8");
  const current = await implementationSnapshot();
  if (
    Reflect.get(globalThis, Symbol.for("screener.offlineReplay")) !== true ||
    sha256(serialize(current)) !== sha256(saved)
  )
    return replaySavedImplementation(dir, JSON.parse(saved), current);
  const policy = await loadCnPolicy(path.join(dir, "policy.yaml"));
  const opened = await openEvidenceInput(path.join(dir, "input.json"));
  const accumulator = createEvaluationAccumulator(
      run.manifest.displayLimit,
      run.manifest.strategy ?? "quality",
      run.manifest.backupLimit ?? run.manifest.financialLeadLimit ?? policy.priority.backupLimit ?? policy.strategies?.financialDiscount?.displayLimit,
    ),
    records = run.records();
  let count = 0;
  try {
    for await (const c of opened.companies()) {
      const evaluated = evaluateCompany(c, policy, {
          evaluateAll: run.manifest.evaluateAll ?? false,
          strategy: run.manifest.strategy ?? "quality",
        }),
        next = await records.next();
      if (
        next.done ||
        !isDeepStrictEqual(JSON.parse(serialize(c)), next.value.company) ||
        !isDeepStrictEqual(JSON.parse(serialize(evaluated)), next.value.result)
      )
        throw new Error(`Replay result mismatch: ${c.market}:${c.ticker}`);
      accumulator.accept(evaluated);
      count++;
    }
    if (!(await records.next()).done || !isDeepStrictEqual(accumulator.finish(), run.summary))
      throw new Error("Replay result mismatch");
  } finally {
    await records.return(undefined);
  }
  return { matches: true, count };
}

/** Compare saved observations and outcomes. Multiple changed dimensions are not causal attribution. */
// 运行比较：区分数据、政策、实现和容量变化，保留导致候选变化的可追溯原因。
export async function compareEvidenceRuns(leftDir: string, rightDir: string) {
  const [left, right] = await Promise.all([openEvidenceRun(leftDir), openEvidenceRun(rightDir)]);
  const canonical = (value: unknown): string => {
    const stable = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(stable)
        : v !== null && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b, "en"))
                .map(([k, item]) => [k, stable(item)]),
            )
          : v;
    return JSON.stringify(stable(value));
  };
  const unordered = (items: unknown[]) => items.map(canonical).sort();
  const scope = (c: EvidenceInput["companies"][number]) => ({
    method: { ...c.method, evidence: undefined },
    checks: Object.fromEntries(
      Object.entries(c.checks).map(([key, value]) => [key, { ...value, evidence: undefined }]),
    ),
  });
  type Fact = NonNullable<CompanyEvaluation["derivedFacts"]>[number];
  type Source = EvidenceInput["sources"][number];
  const sourceBase = (source: Source) => ({
    url: source.url,
    mapping: source.mapping,
    sha256: source.sha256,
    request: source.request,
    fetchedAt: source.fetchedAt,
    requestStartedAt: source.requestStartedAt,
  });
  const sourceSignatures = (run: typeof left) => {
    const byId = new Map(run.input.sources.map((source) => [source.id, source]));
    const dependencyReference = (id: string): unknown => {
      const source = byId.get(id);
      return source ? sourceBase(source) : { missingSourceId: id };
    };
    const signature = (source: Source) => ({
      ...sourceBase(source),
      ...(source.disclosure
        ? {
            disclosure: {
              source: dependencyReference(source.disclosure.sourceId),
              locator: source.disclosure.locator,
              ...(source.disclosure.issuer
                ? {
                    issuer: {
                      source: dependencyReference(source.disclosure.issuer.sourceId),
                      locator: source.disclosure.issuer.locator,
                    },
                  }
                : {}),
            },
          }
        : {}),
    });
    const reference = (id: string): unknown => {
      const source = byId.get(id);
      return source ? signature(source) : { missingSourceId: id };
    };
    return { reference, all: unordered(run.input.sources.map(signature)) };
  };
  const priceField = (field: string) =>
    [
      "price",
      "ordinaryShares",
      "quote.shareStructure",
      "scope.quote",
      "scope.lastCompletedTradingDay",
    ].includes(field);
  const routeField = (field: string) =>
    field.startsWith("scope.") || field.startsWith("classification.");
  const projection = (
    c: EvidenceInput["companies"][number],
    r: CompanyEvaluation,
    sourceReference: (id: string) => unknown,
  ) => {
    const cleanCondition = (condition: CompanyEvaluation["conditions"][number]): unknown => {
      const { factIds, components, calculations, ...rest } = condition;
      return {
        ...rest,
        components: components?.map(cleanCondition),
        calculations: calculations?.map(({ factIds, ...step }) => step),
      };
    };
    const rawFinancial = (f: Fact) => {
      const { id, evidence, derivation, ...value } = f;
      return value;
    };
    const factsById = new Map<string, Fact>(
      [...c.facts, ...(r.derivedFacts ?? [])].map((f) => [f.id, f]),
    );
    const contextFields = new Set([
      "earnings.returnContext",
      "earnings.restatementContext",
      "regulatory.context",
      "insurance.context",
      "business.segments",
      "business.breakdown",
      "quote.shareStructure",
    ]);
    const financial = (f: Fact, seen = new Set([f.id])): Record<string, unknown> => {
      const value = rawFinancial(f);
      if (!contextFields.has(f.field) || typeof value.value !== "string") return value;
      try {
        const context = JSON.parse(value.value);
        if (context === null || Array.isArray(context) || typeof context !== "object") return value;
        // Only documented reference-shaped keys in supported context fields are
        // resolved. Arbitrary text and original source content stay untouched.
        const resolve = (node: unknown, key = ""): unknown => {
          if (typeof node === "string" && (key === "factId" || key.endsWith("FactId")))
            return factReference(node, seen);
          if (Array.isArray(node))
            return node.map((item) =>
              resolve(item, key.endsWith("FactIds") ? key.slice(0, -1) : key),
            );
          if (node !== null && typeof node === "object")
            return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v, k)]));
          return node;
        };
        return { ...value, value: resolve(context) };
      } catch {
        return value;
      }
    };
    const evidence = (f: Fact, seen = new Set([f.id])) => ({
      fact: financial(f, seen),
      evidence: f.evidence.map((item) => ({
        source: sourceReference(item.sourceId),
        locator: item.locator,
        raw: item.raw,
      })),
    });
    const factReference = (id: string, seen: Set<string>): unknown => {
      const fact = factsById.get(id);
      if (!fact) return { missingFactId: id };
      if (seen.has(id)) return { cyclicFactReference: true };
      return evidence(fact, new Set([...seen, id]));
    };
    const factFingerprints = new Map(c.facts.map((f) => [f.id, sha256(canonical(evidence(f)))]));
    for (const f of r.derivedFacts ?? [])
      factFingerprints.set(f.id, sha256(canonical(evidence(f))));
    const derived = (f: Fact) => {
      const { derivation } = f,
        proof = evidence(f);
      return {
        ...proof.fact,
        evidence: proof.evidence,
        ...(derivation
          ? {
              derivation: {
                algorithm: derivation.algorithm,
                inputs: derivation.inputs.map(
                  (input) => factFingerprints.get(input) ?? `missing_fact:${input}`,
                ),
              },
            }
          : {}),
      };
    };
    return {
      identity: {
        name: c.companyName,
        companyId: c.companyId,
        exchange: c.identity?.exchange,
        board: c.identity?.board,
        listedAt: c.identity?.listedAt,
        state: c.identity?.state,
        industryLabels: c.identity?.industryLabels,
      },
      cutoff: { asOf: c.asOf, latestFiscalYear: c.latestFiscalYear, basis: c.basis },
      routing: {
        ...scope(c),
        facts: unordered(
          c.facts
            .filter((f) => routeField(f.field) && !priceField(f.field))
            .map((f) => financial(f)),
        ),
      },
      financialFacts: unordered(
        c.facts
          .filter((f) => !routeField(f.field) && !priceField(f.field))
          .map((f) => financial(f)),
      ),
      quote: {
        quoteDate: c.quoteDate,
        lastCompletedTradingDay: c.lastCompletedTradingDay,
        facts: unordered(c.facts.filter((f) => priceField(f.field)).map((f) => financial(f))),
      },
      evidence: unordered(c.facts.map((f) => evidence(f))),
      derivedFacts: unordered((r.derivedFacts ?? []).map(derived)),
      collection: c.collection,
      qualification: {
        quality: r.quality,
        ...(r.research !== undefined ? { research: r.research } : {}),
        priority: r.priority,
        ...(r.strategies
          ? {
              strategies: Object.fromEntries(
                Object.entries(r.strategies).map(([id, value]) => [
                  id,
                  { state: value!.state, applicability: value!.applicability },
                ]),
              ),
            }
          : {}),
      },
      conditions: r.conditions.map(cleanCondition),
      ...(r.researchRanking ? { researchRanking: r.researchRanking } : {}),
      ...(r.observations ? { observations: r.observations.map(cleanCondition) } : {}),
      ...(r.strategies
        ? {
            strategyConditions: Object.fromEntries(
              Object.entries(r.strategies).map(([id, value]) => [
                id,
                { conditions: value!.conditions.map(cleanCondition), signal: value!.signal },
              ]),
            ),
          }
        : {}),
    };
  };
  const index = async (run: typeof left) => {
    const sources = sourceSignatures(run);
    const values = new Map<
      string,
      {
        hashes: Record<string, string>;
        qualification: {
          quality: CompanyEvaluation["quality"];
          research?: CompanyEvaluation["research"];
          priority: CompanyEvaluation["priority"];
        };
      }
    >();
    for await (const { company, result } of run.records()) {
      const value = projection(company, result, sources.reference);
      values.set(`${company.market}:${company.ticker}`, {
        hashes: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, sha256(canonical(item) ?? "undefined")]),
        ),
        qualification: value.qualification,
      });
    }
    return { values, sources: sources.all };
  };
  const beforeIndex = await index(left),
    afterIndex = await index(right),
    before = beforeIndex.values,
    after = afterIndex.values,
    keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const companies = [];
  for (const security of keys) {
    const a = before.get(security),
      b = after.get(security);
    if (!a || !b) continue;
    const changed = [...new Set([...Object.keys(a.hashes), ...Object.keys(b.hashes)])].filter(
      (k) => a.hashes[k] !== b.hashes[k],
    );
    const displayedBefore = left.summary.displayed.includes(security),
      displayedAfter = right.summary.displayed.includes(security);
    // Older archives have no research output; do not infer it with today's policy.
    const researchBefore = left.summary.researchDisplayed?.includes(security),
      researchAfter = right.summary.researchDisplayed?.includes(security);
    const positionBefore = left.summary.displayed.indexOf(security), positionAfter = right.summary.displayed.indexOf(security);
    if (changed.length || displayedBefore !== displayedAfter || researchBefore !== researchAfter || positionBefore !== positionAfter)
      companies.push({
        security,
        changed: [
          ...changed,
          ...(displayedBefore !== displayedAfter ? ["display"] : []),
          ...(researchBefore !== researchAfter ? ["researchDisplay"] : []),
          ...(positionBefore !== positionAfter ? ["displayOrder"] : []),
        ],
        before: {
          ...a.qualification,
          displayed: displayedBefore,
          position: positionBefore < 0 ? null : positionBefore + 1,
          ...(researchBefore !== undefined ? { researchDisplayed: researchBefore } : {}),
        },
        after: {
          ...b.qualification,
          displayed: displayedAfter,
          position: positionAfter < 0 ? null : positionAfter + 1,
          ...(researchAfter !== undefined ? { researchDisplayed: researchAfter } : {}),
        },
      });
  }
  return {
    left: { runId: left.manifest.runId, status: left.manifest.status },
    right: { runId: right.manifest.runId, status: right.manifest.status },
    changed: {
      strategy: (left.manifest.strategy ?? "quality") !== (right.manifest.strategy ?? "quality"),
      implementation:
        left.manifest.hashes["implementation.json"] !==
        right.manifest.hashes["implementation.json"],
      policy: left.manifest.hashes["policy.yaml"] !== right.manifest.hashes["policy.yaml"],
      displayLimit: left.manifest.displayLimit !== right.manifest.displayLimit,
      backupLimit: left.manifest.backupLimit !== right.manifest.backupLimit,
      displayOrder: canonical(left.summary.displayed) !== canonical(right.summary.displayed),
      evaluateAll: (left.manifest.evaluateAll ?? false) !== (right.manifest.evaluateAll ?? false),
      universe: canonical(left.input.universe) !== canonical(right.input.universe),
      selection: canonical(left.input.selection) !== canonical(right.input.selection),
      sources: canonical(beforeIndex.sources) !== canonical(afterIndex.sources),
    },
    added: keys.filter((k) => !before.has(k)),
    removed: keys.filter((k) => !after.has(k)),
    companies,
  };
}
