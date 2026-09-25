/**
 * CN 取证采集：把可复核的原始观察写入一次性 collection，再交给筛选器作资格判断。
 * 请求、公司和全局预算均为有限边界；年报 PDF 只是在结构化来源不足时的受控补充。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { httpFetch, mapPool, writeJsonLines, DEFAULT_POLICY_DIR } from "../shared/runtime.js";
import {
  openEvidenceInput,
  readEvidenceMetadata,
  readEvidenceCompanies,
  readEvidenceSource,
  collectionBudgetSchema,
  sha256,
  cnAnnualReportYear,
  jsonPointer,
  readDisclosurePdf,
  parseCnProfileFacts,
  type EvidenceInput,
} from "./evidence.js";
import {
  parseCnStatementFacts,
  parseCnRecentFinancialFacts,
  cnRecentFinancialsUrl,
  EASTMONEY_F10_HEADERS,
  parseCnPriceFacts,
  parseCnShareStructureFacts,
  parseTencentDailyFacts,
} from "./sources/market-data.js";
import { decodeCnListingDocument } from "./sources/listings.js";
import { evaluateCompany, recentFinancialChanges } from "./screening.js";
import { loadCnPolicy } from "../policy/loader.js";
import { type CompanyFacts } from "../shared/financial-model.js";

export type CollectionBudget = NonNullable<EvidenceInput["collection"]>["budget"];
/** Bounded defaults; optional history must not crowd out independent strategies. */
export const defaultCnCollectionBudget: CollectionBudget = {
  attempts: 1,
  requestMs: 10_000,
  companyRequests: 10,
  companyMs: 90_000,
  globalRequests: 180,
  globalMs: 300_000,
  pdfReports: 1,
};
/** A full identity snapshot scales from the same bound, with explicit caps. */
export function defaultCnCollectionBudgetFor(
  companyCount: number,
  concurrency = 4,
): CollectionBudget {
  if (!Number.isSafeInteger(companyCount) || companyCount < 1)
    throw new Error("Collection requires at least one company");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12)
    throw new Error("Collection concurrency must be between 1 and 12");
  return {
    ...defaultCnCollectionBudget,
    globalRequests: Math.min(
      60_000,
      Math.max(
        defaultCnCollectionBudget.globalRequests,
        companyCount * defaultCnCollectionBudget.companyRequests,
      ),
    ),
    globalMs: Math.min(
      12 * 60 * 60 * 1000,
      Math.max(
        defaultCnCollectionBudget.globalMs,
        Math.ceil(companyCount / concurrency) * defaultCnCollectionBudget.companyMs,
      ),
    ),
  };
}
type Fetch = typeof httpFetch;
type SourceKind =
  | "income"
  | "balance"
  | "cashflow"
  | "indicators"
  | "recent-financials"
  | "company-profile"
  | "share-structure"
  | "eastmoney-daily"
  | "eastmoney-shares"
  | "eastmoney-session"
  | "tencent-daily"
  | "tencent-session"
  | "cninfo-stock-list"
  | "cninfo-announcements"
  | "cninfo-annual-pdf";
type Source = EvidenceInput["sources"][number];
type SourceOptions = Pick<Source, "request" | "disclosure">;
const sourceKinds: SourceKind[] = [
  "income",
  "balance",
  "cashflow",
  "indicators",
  "recent-financials",
  "company-profile",
  "share-structure",
  "eastmoney-daily",
  "eastmoney-shares",
  "eastmoney-session",
  "tencent-daily",
  "tencent-session",
  "cninfo-stock-list",
  "cninfo-announcements",
  "cninfo-annual-pdf",
];
const cacheKey = (url: string, request?: Source["request"]) =>
  JSON.stringify([url, request?.method ?? "GET", request?.contentType ?? "", request?.body ?? ""]);
/** Collect sources for a frozen identity input. Evaluation and archive/replay use the common engine. */
export async function collectCnEvidence(
  identityFile: string,
  directory: string,
  options: {
    asOf?: string;
    cacheFile?: string;
    annualCacheDays?: number;
    budget?: CollectionBudget;
    concurrency?: number;
    signal?: AbortSignal;
    policyFile?: string;
    evaluateAll?: boolean;
    strategy?: "all" | "quality" | "financial" | "ncav";
    pdfFallback?: boolean;
    /** Supplement a frozen snapshot without annual/price refresh; cutoff must be explicit. */
    recentOnly?: boolean;
  },
  dependencies: { fetch?: Fetch; now?: () => number } = {},
): Promise<{ inputFile: string; status: "complete" | "partial" }> {
  const requestedBudget =
      options.budget === undefined ? undefined : collectionBudgetSchema.parse(options.budget),
    fetch = dependencies.fetch ?? httpFetch,
    now = dependencies.now ?? Date.now;
  const annualCacheDays = options.annualCacheDays ?? 30;
  if (!Number.isFinite(annualCacheDays) || annualCacheDays < 0 || annualCacheDays > 365)
    throw new Error("Annual cache days must be between 0 and 365");
  if (options.recentOnly && options.asOf === undefined)
    throw new Error("Recent-only collection requires a fixed cutoff");
  const live = options.asOf === undefined;
  let asOf = options.asOf ?? new Date(now()).toISOString();
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("Invalid collection as-of");
  if (Date.parse(asOf) > now()) throw new Error("Cannot collect evidence for a future cutoff");
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12)
    throw new Error("Collection concurrency must be between 1 and 12");
  const policy = await loadCnPolicy(
    options.policyFile ?? path.join(DEFAULT_POLICY_DIR, "cn-screening.yaml"),
  );
  const opened = await openEvidenceInput(identityFile);
  const input = opened.input;
  if (options.recentOnly && input.companies.some(c => Date.parse(c.asOf) !== Date.parse(asOf)))
    throw new Error("Recent-only collection must preserve the frozen cutoff");
  const budget =
    requestedBudget ?? defaultCnCollectionBudgetFor(input.companies.length, concurrency);
  // Sources loaded with the identity input are verified by its reader. Sources
  // acquired during this run live under the new collection directory instead.
  const inputSourceIds = new Set(input.sources.map((source) => source.id));
  const cache = new Map<string, EvidenceInput["sources"][number] | null>();
  // Live refreshes may reuse recent annual statements, never old price/share
  // observations. Fresh indicators below invalidate reports after an update.
  const annualCache = new Map<string, Source>();
  const negativeCache = new Map<string, Source>();
  if (live) {
    const retained = options.cacheFile
      ? (await readEvidenceMetadata(options.cacheFile)).input
      : input;
    const base = path.dirname(options.cacheFile ?? identityFile);
    for (const source of retained.sources)
      if (
        ["income", "balance", "cashflow", "recent-financials"].includes(source.mapping ?? "") &&
        now() - Date.parse(source.fetchedAt) >= 0 &&
        now() - Date.parse(source.fetchedAt) <= annualCacheDays * 24 * 60 * 60 * 1000 &&
        annualCacheDays > 0
      ) {
        const key = cacheKey(source.url, source.request),
          previous = annualCache.get(key);
        if (!previous || Date.parse(source.fetchedAt) > Date.parse(previous.fetchedAt))
          annualCache.set(key, { ...source, path: path.resolve(base, source.path) });
      }
    const emptyIds = new Set(
      retained.collection?.events
        .filter((e) => e.reason === "source_no_records" || e.reason === "negative_cache_no_records")
        .map((e) => e.sourceId),
    );
    for (const source of retained.sources)
      if (
        emptyIds.has(source.id) &&
        !source.mapping &&
        now() - Date.parse(source.fetchedAt) >= 0 &&
        now() - Date.parse(source.fetchedAt) <= 24 * 60 * 60 * 1000
      ) {
        const key = cacheKey(source.url, source.request),
          previous = negativeCache.get(key);
        if (!previous || Date.parse(source.fetchedAt) > Date.parse(previous.fetchedAt))
          negativeCache.set(key, { ...source, path: path.resolve(base, source.path) });
      }
  }

  // Previously verified PDFs can be reused after a fresh CNInfo index selects
  // the same disclosure and the saved bytes pass their hash check.
  const historicalPdfCache = new Map<string, EvidenceInput["sources"][number] | null>();
  if (!live && input.collection?.asOf === asOf)
    for (const source of input.sources.filter((s) =>
      sourceKinds.includes(s.mapping as SourceKind),
    )) {
      const key = cacheKey(source.url, source.request),
        previous = cache.get(key);
      cache.set(
        key,
        previous === null ||
          (previous && (previous.sha256 !== source.sha256 || previous.mapping !== source.mapping))
          ? null
          : source,
      );
    }
  for (const source of input.sources.filter((source) => source.mapping === "cninfo-annual-pdf")) {
    const previous = historicalPdfCache.get(source.url);
    historicalPdfCache.set(
      source.url,
      previous === null || (previous && previous.sha256 !== source.sha256) ? null : source,
    );
  }
  if (input.universe && Date.parse(asOf) < Date.parse(input.universe.asOf))
    throw new Error("Collection cutoff precedes frozen universe");
  if (input.companies.some((c) => c.market !== "CN" || !/^\d{6}$/.test(c.ticker)))
    throw new Error("CN collection requires six-digit CN securities");
  await fs.mkdir(path.dirname(path.resolve(directory)), { recursive: true });
  await fs.mkdir(directory); // A new collection never overwrites the identity input or an earlier run.
  await fs.mkdir(path.join(directory, "sources"));
  const inputFile = path.join(directory, "input.json");
  const recordsFile = path.join(directory, "companies.jsonl");
  // Validate every original exactly once while moving normalized facts out of
  // the catalogue. Later checkpoints only update metadata and sources.
  const companyRecordsSha256 = await writeJsonLines(
    recordsFile,
    (async function* () {
      let index = 0;
      for await (const company of opened.companies()) {
        input.companies[index++] = structuredClone({ ...company, facts: [] });
        yield { market: company.market, ticker: company.ticker, facts: company.facts };
      }
    })(),
  );
  // Original evidence remains anchored to its input directory. Newly captured
  // sources retain their paths relative to this collection directory.
  for (const source of input.sources)
    source.path = path.resolve(path.dirname(identityFile), source.path);
  const started = now();
  input.collection = {
    status: "partial",
    asOf,
    cutoffMode: live ? "live" : "explicit",
    ...(live ? { cachePolicy: { annualDays: annualCacheDays, emptyHours: 24 as const } } : {}),
    startedAt: new Date(started).toISOString(),
    budget,
    concurrency,
    requests: 0,
    events: [],
  };
  for (const company of input.companies) {
    company.asOf = asOf;
    company.collection = {
      state: options.recentOnly ? company.collection?.state ?? "complete" : "pending", requests: 0,
      errors: options.recentOnly ? [...(company.collection?.errors ?? [])] : [],
    };
  }
  const timing = (input.collection.timing = {
    checkpointMs: 0,
    checkpointWrites: 0,
    checkpointBytes: 0,
    journalMs: 0,
    journalWrites: 0,
    journalBytes: 0,
    assessmentMs: 0,
  });
  const journalFile = path.join(directory, "collection-journal.jsonl");
  await fs.writeFile(journalFile, "");
  let sequence = 0,
    savedSources = input.sources.length,
    savedEvents = 0;
  let writes = Promise.resolve();
  // Each delta is persisted before collection continues. Full checkpoints only
  // bound recovery work: frequent rewrites of the growing catalogue are costly.
  let journalEntries = 0,
    journalBytes = 0;
  const checkpoint = async (final = false) => {
    const began = performance.now();
    const content =
      JSON.stringify({
        ...input,
        schemaVersion: 2,
        companyRecords: { path: "companies.jsonl", sha256: companyRecordsSha256 },
        ...(!final ? { collectionJournal: { path: "collection-journal.jsonl", sequence } } : {}),
      }) + "\n";
    const temp = inputFile + ".tmp";
    await fs.writeFile(temp, content);
    await fs.rename(temp, inputFile);
    timing.checkpointMs += performance.now() - began;
    timing.checkpointWrites++;
    timing.checkpointBytes += Buffer.byteLength(content);
    await fs.writeFile(journalFile, "");
    journalEntries = 0;
    journalBytes = 0;
  };
  const save = (company?: CompanyFacts): Promise<void> => {
    const { events, ...collection } = input.collection!;
    const content =
      JSON.stringify({
        sequence: ++sequence,
        companies: company ? [{ ...company, facts: [] }] : [],
        sources: input.sources.slice(savedSources),
        events: events.slice(savedEvents),
        collection,
      }) + "\n";
    savedSources = input.sources.length;
    savedEvents = events.length;
    writes = writes.then(async () => {
      const began = performance.now();
      await fs.appendFile(journalFile, content);
      const bytes = Buffer.byteLength(content);
      timing.journalMs += performance.now() - began;
      timing.journalWrites++;
      timing.journalBytes += bytes;
      journalEntries++;
      journalBytes += bytes;
      if (journalEntries >= 1_000 || journalBytes >= 8 * 1024 * 1024) await checkpoint();
    });
    return writes;
  };
  await checkpoint(); // Identity catalogue survives even before the first request.
  const readSourceBytes = (source: Source) =>
    inputSourceIds.has(source.id)
      ? opened.readSource(source.id)
      : readEvidenceSource(source, directory);
  const readJsonSource = async (source: Source): Promise<unknown> =>
    decodeCnListingDocument((await readSourceBytes(source)).toString("utf8"), source.mapping);
  const hydrateDisclosureDependencies = async (source: Source, documents: Map<string, unknown>) => {
    const ids = [source.disclosure?.sourceId, source.disclosure?.issuer?.sourceId].filter(
      (id): id is string => id !== undefined,
    );
    for (const id of ids) {
      if (documents.has(id)) continue;
      const dependency = input.sources.find((candidate) => candidate.id === id);
      if (!dependency) throw new Error(`Missing source: ${id}`);
      if (dependency.mediaType !== "application/json")
        throw new Error(`Disclosure dependency is not JSON: ${id}`);
      documents.set(id, await readJsonSource(dependency));
    }
  };
  const sameDisclosureContract = async (
    cached: Source,
    current: SourceOptions,
    documents: Map<string, unknown>,
  ): Promise<boolean> => {
    if (!cached.disclosure || !current.disclosure) return false;
    await hydrateDisclosureDependencies(cached, documents);
    const currentIndex = input.sources.find((source) => source.id === current.disclosure!.sourceId);
    const cachedIndex = input.sources.find((source) => source.id === cached.disclosure!.sourceId);
    if (
      !currentIndex ||
      !cachedIndex ||
      currentIndex.mapping !== "cninfo-announcements" ||
      cachedIndex.mapping !== "cninfo-announcements"
    )
      return false;
    const currentEntry = jsonPointer(documents.get(currentIndex.id), current.disclosure.locator);
    const cachedEntry = jsonPointer(documents.get(cachedIndex.id), cached.disclosure.locator);
    if (!isDeepStrictEqual(currentEntry, cachedEntry)) return false;
    const currentIssuer = current.disclosure.issuer,
      cachedIssuer = cached.disclosure.issuer;
    if (Boolean(currentIssuer) !== Boolean(cachedIssuer)) return false;
    if (!currentIssuer || !cachedIssuer) return true;
    const currentIssuerSource = input.sources.find(
      (source) => source.id === currentIssuer.sourceId,
    );
    const cachedIssuerSource = input.sources.find((source) => source.id === cachedIssuer.sourceId);
    return (
      currentIssuerSource?.mapping === "cninfo-stock-list" &&
      cachedIssuerSource?.mapping === "cninfo-stock-list" &&
      isDeepStrictEqual(
        jsonPointer(documents.get(currentIssuer.sourceId), currentIssuer.locator),
        jsonPointer(documents.get(cachedIssuer.sourceId), cachedIssuer.locator),
      )
    );
  };
  const advanceCutoff = () => {
    if (!live) return;
    asOf = new Date(now()).toISOString();
    input.collection!.asOf = asOf;
  };
  const stopReason = () =>
    options.signal?.aborted
      ? "interrupted"
      : input.collection!.requests >= budget.globalRequests
        ? "global_requests"
        : now() - started >= budget.globalMs
          ? "global_ms"
          : undefined;
  const globalStopped = () => stopReason() !== undefined;
  const stopCompany = (company: CompanyFacts, reason: string) => {
    if (!company.collection!.errors.includes(`collection_limit:${reason}`))
      company.collection!.errors.push(`collection_limit:${reason}`);
    company.collection!.state = reason === "interrupted" ? "interrupted" : "budget_exhausted";
  };
  const organizationTypes = new Map<string, string>();
  const financialPublication = new Map<string, number>();
  const statementYears = new Map<string, Set<number>>();
  const collectionId = randomUUID();

  // 这里验证来源是否构成可靠观察，不把“有数据”误当作“满足策略资格”。
  const inspect = async (
    bytes: Buffer,
    id: string,
    company: CompanyFacts,
    kind: SourceKind,
    url: string,
    observedAt: string,
    metadata: SourceOptions = {},
    documents?: Map<string, unknown>,
  ): Promise<boolean> => {
    advanceCutoff();
    company.asOf = asOf; // A live observation may arrive after the run started; explicit cutoffs never move.
    if (kind === "cninfo-annual-pdf") {
      const disclosureDocuments = documents ?? new Map<string, unknown>();
      const source = {
        id,
        path: "",
        url,
        mediaType: "application/pdf" as const,
        mapping: kind,
        fetchedAt: new Date(now()).toISOString(),
        sha256: sha256(bytes),
        ...metadata,
      };
      // A cached PDF may point to an earlier announcement revision than the
      // page selected in this collection. Hydrate that source's own proof chain.
      await hydrateDisclosureDependencies(source, disclosureDocuments);
      const report = await readDisclosurePdf(source, bytes, disclosureDocuments, input.sources);
      return (
        report.entity === company.companyId &&
        Date.parse(report.publishedAt) <= Date.parse(asOf) &&
        Date.parse(report.periodEnd) <= Date.parse(asOf)
      );
    }
    const body = JSON.parse(bytes.toString("utf8"));
    if (kind === "share-structure")
      return (
        parseCnShareStructureFacts(body, url, {
          sourceId: id,
          entity: company.companyId,
          basis: company.basis,
          asOf,
          observedAt,
        }).length > 0
      );
    if (kind === "company-profile")
      return (
        parseCnProfileFacts(
          body,
          {
            id,
            path: "",
            url,
            mediaType: "application/json",
            mapping: kind,
            fetchedAt: observedAt,
            sha256: sha256(bytes),
          },
          company,
        ).length > 0
      );
    if (kind === "cninfo-stock-list")
      return (
        Array.isArray(body.stockList) &&
        body.stockList.every(
          (row: Record<string, unknown>) =>
            typeof row.code === "string" && typeof row.orgId === "string",
        )
      );
    if (kind === "cninfo-announcements")
      return (
        (Array.isArray(body.announcements) ||
          (body.announcements === null && body.totalAnnouncement === 0)) &&
        typeof body.hasMore === "boolean" &&
        Number.isInteger(body.totalAnnouncement) &&
        body.totalAnnouncement >= 0
      );
    if (kind === "tencent-daily" || kind === "tencent-session")
      return (
        parseTencentDailyFacts(body, url, {
          sourceId: id,
          entity: company.companyId,
          basis: company.basis,
          asOf,
          observedAt,
          kind: kind === "tencent-daily" ? "daily" : "session",
        }).length > 0
      );
    if (kind === "eastmoney-daily" || kind === "eastmoney-shares" || kind === "eastmoney-session")
      return (
        parseCnPriceFacts(body, {
          sourceId: id,
          entity: company.companyId,
          basis: company.basis,
          asOf,
          observedAt,
          kind:
            kind === "eastmoney-daily"
              ? "daily"
              : kind === "eastmoney-shares"
                ? "shares"
                : "session",
        }).length > 0
      );
    const rows = body.data ?? body.result?.data;
    if (
      Array.isArray(rows) &&
      rows.length === 0 &&
      body.success !== false &&
      (body.code == null || body.code === 0)
    )
      throw new Error("source_no_records");
    if (kind === "recent-financials") {
      const facts = parseCnRecentFinancialFacts(body, { sourceId: id, entity: company.companyId, basis: company.basis });
      return facts.some(f => f.field === "recent.period" && Date.parse(f.publishedAt) <= Date.parse(asOf));
    }
    const facts = parseCnStatementFacts(body, {
      sourceId: id,
      entity: company.companyId,
      basis: company.basis,
      kind,
    });
    if (
      !facts.some(
        (f) =>
          f.state === "observed" &&
          f.unit === "CNY" &&
          Date.parse(f.publishedAt) <= Date.parse(asOf) &&
          Date.parse(f.period.end) <= Date.parse(asOf),
      )
    )
      return false;
    if (kind !== "indicators") {
      const key = `${company.ticker}:${kind}`,
        years = statementYears.get(key) ?? new Set<number>();
      for (const fact of facts)
        if (
          fact.state === "observed" &&
          fact.field === "annualReportYear" &&
          Date.parse(fact.publishedAt) <= Date.parse(asOf) &&
          Date.parse(fact.period.end) <= Date.parse(asOf)
        )
          years.add(fact.year);
      statementYears.set(key, years);
    }
    if (kind === "indicators") {
      const rows = (body.data ?? body.result?.data ?? []) as Array<Record<string, unknown>>;
      const eligible = rows
        .filter(
          (r) =>
            r.SECURITY_CODE === company.companyId &&
            r.CURRENCY === "CNY" &&
            r.REPORT_TYPE === "年报" &&
            typeof r.REPORT_DATE === "string" &&
            /^\d{4}-12-31/.test(r.REPORT_DATE) &&
            Date.parse(r.REPORT_DATE) <= Date.parse(asOf) &&
            typeof r.NOTICE_DATE === "string" &&
            Date.parse(r.NOTICE_DATE) <= Date.parse(asOf) &&
            (r.UPDATE_DATE == null ||
              (typeof r.UPDATE_DATE === "string" && Date.parse(r.UPDATE_DATE) <= Date.parse(asOf))),
        )
        .sort((a, b) => String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)));
      if (eligible.length)
        financialPublication.set(
          company.ticker,
          Math.max(
            ...eligible.flatMap((row) => [
              Date.parse(String(row.NOTICE_DATE)),
              ...(row.UPDATE_DATE ? [Date.parse(String(row.UPDATE_DATE))] : []),
            ]),
          ),
        );
      if (typeof eligible[0]?.ORG_TYPE === "string")
        organizationTypes.set(company.ticker, eligible[0].ORG_TYPE);
    }
    return true;
  };
  // 缓存复用仍要重新核验；每次网络获取受公司、全局和单请求三层预算限制。
  const captureSource = async (
    company: CompanyFacts,
    kind: SourceKind,
    url: string,
    companyStarted: number,
    metadata: SourceOptions = {},
    documents?: Map<string, unknown>,
  ): Promise<boolean> => {
    const key = cacheKey(url, metadata.request);
    const retained = annualCache.get(key),
      publication = financialPublication.get(company.ticker);
    const retainSource = async (source: Source, bytes: Buffer) => {
      let stored = input.sources.find((s) => s.id === source.id);
      if (!stored) {
        const relative = `sources/${source.sha256}.json`;
        await fs.writeFile(path.join(directory, relative), bytes);
        stored = { ...source, path: relative };
        input.sources.push(stored);
        await opened.registerSource({ ...stored, path: path.resolve(directory, relative) });
      }
      return stored;
    };
    if (
      !cache.has(key) &&
      retained &&
      publication !== undefined &&
      Date.parse(retained.fetchedAt) >= publication &&
      !options.signal?.aborted &&
      now() - started < budget.globalMs &&
      now() - companyStarted < budget.companyMs
    ) {
      const began = now();
      let bytes: Buffer | undefined;
      try {
        bytes = await readEvidenceSource(retained, path.dirname(identityFile));
        if (kind === "recent-financials") {
          const recent = recentFinancialChanges({ ...company, asOf,
            facts: parseCnRecentFinancialFacts(JSON.parse(bytes.toString("utf8")), {
              sourceId: retained.id, entity: company.companyId, basis: company.basis,
            }) });
          const target = new URL(url).searchParams.get("filter")?.match(/REPORT_DATE<='([^']+)'/)?.[1];
          if (recent.state !== "complete" || recent.period?.end !== target) bytes = undefined;
        }
        if (
          bytes && !(await inspect(
            bytes,
            retained.id,
            company,
            kind,
            url,
            retained.requestStartedAt ?? retained.fetchedAt,
            retained,
            documents,
          ))
        )
          bytes = undefined;
      } catch (error) {
        input.collection!.events.push({
          ticker: company.ticker,
          sourceId: `cache:${retained.id}`,
          url,
          attempt: 0,
          state: "source_error",
          durationMs: Math.max(0, now() - began),
          bytes: 0,
          reason: `annual_cache_invalid:${(error as Error).message}`,
        });
      }
      if (bytes) {
        cache.set(key, await retainSource(retained, bytes));
        input.collection!.events.push({
          ticker: company.ticker,
          sourceId: retained.id,
          url,
          attempt: 0,
          state: "cache_hit",
          durationMs: Math.max(0, now() - began),
          bytes: bytes.length,
          reason: kind === "recent-financials" ? "recent_financials_within_cache_window" :
            "annual_statement_within_cache_window_and_fresh_indicator_publication",
        });
        await save(company);
        return true;
      }
    }
    const empty = negativeCache.get(key);
    if (!cache.has(key) && empty && publication !== undefined && !options.signal?.aborted) {
      try {
        const bytes = await readEvidenceSource(empty, path.dirname(identityFile)),
          diagnostic = JSON.parse(bytes.toString("utf8"));
        const original = Buffer.from(diagnostic.rawBase64, "base64"),
          body = JSON.parse(original.toString("utf8"));
        const rows = body.data ?? body.result?.data;
        if (
          diagnostic.url === url &&
          diagnostic.reason === "source_no_records" &&
          diagnostic.financialPublication === publication &&
          sha256(original) === diagnostic.rawSha256 &&
          Array.isArray(rows) &&
          rows.length === 0 &&
          body.success !== false &&
          (body.code == null || body.code === 0)
        ) {
          await retainSource(empty, bytes);
          input.collection!.events.push({
            ticker: company.ticker,
            sourceId: empty.id,
            url,
            attempt: 0,
            state: "source_error",
            durationMs: 0,
            bytes: bytes.length,
            reason: "negative_cache_no_records",
          });
          company.collection!.errors.push(`${kind}:negative_cache_no_records`);
          await save(company);
          return false;
        }
      } catch {
        /* An unusable negative cache must never suppress a bounded request. */
      }
    }
    const cached = cache.get(key);
    if (
      cached?.mapping === kind &&
      !options.signal?.aborted &&
      now() - started < budget.globalMs &&
      now() - companyStarted < budget.companyMs
    ) {
      const cacheStarted = now(),
        bytes = await readSourceBytes(cached);
      if (
        await inspect(
          bytes,
          cached.id,
          company,
          kind,
          url,
          kind === "eastmoney-shares" || kind === "share-structure"
            ? cached.fetchedAt
            : (cached.requestStartedAt ?? cached.fetchedAt),
          cached,
          documents,
        )
      ) {
        input.collection!.events.push({
          ticker: company.ticker,
          sourceId: cached.id,
          url,
          attempt: 0,
          state: "cache_hit",
          durationMs: Math.max(0, now() - cacheStarted),
          bytes: bytes.length,
        });
        await save(company);
        return true;
      }
    }
    const historical = kind === "cninfo-annual-pdf" ? historicalPdfCache.get(url) : undefined;
    if (
      historical?.mapping === kind &&
      !options.signal?.aborted &&
      now() - started < budget.globalMs &&
      now() - companyStarted < budget.companyMs &&
      (await sameDisclosureContract(historical, metadata, documents ?? new Map<string, unknown>()))
    ) {
      const cacheStarted = now(),
        bytes = await readSourceBytes(historical);
      if (
        await inspect(
          bytes,
          historical.id,
          company,
          kind,
          url,
          historical.fetchedAt,
          historical,
          documents,
        )
      ) {
        cache.set(key, historical);
        input.collection!.events.push({
          ticker: company.ticker,
          sourceId: historical.id,
          url,
          attempt: 0,
          state: "cache_hit",
          durationMs: Math.max(0, now() - cacheStarted),
          bytes: bytes.length,
        });
        await save(company);
        return true;
      }
    }
    for (let attempt = 1; attempt <= budget.attempts; attempt++) {
      const limit =
        stopReason() ??
        (company.collection!.requests >= budget.companyRequests
          ? "company_requests"
          : now() - companyStarted >= budget.companyMs
            ? "company_ms"
            : undefined);
      if (limit) {
        stopCompany(company, limit);
        return false;
      }
      const requestStarted = now(),
        number = ++input.collection!.requests;
      company.collection!.requests++;
      const id = `collected:${collectionId}:${company.ticker}:${kind}:${number}`;
      const timeout = Math.max(
        1,
        Math.min(
          budget.requestMs,
          budget.companyMs - (requestStarted - companyStarted),
          budget.globalMs - (requestStarted - started),
        ),
      );
      let fetchedAt = new Date(requestStarted).toISOString();
      let bytes = Buffer.alloc(0),
        reason: string | undefined,
        retryable = true,
        success = false;
      try {
        const signal = AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(options.signal ? [options.signal] : []),
        ]);
        const headers = kind.startsWith("cninfo-")
          ? {
              "User-Agent": "Mozilla/5.0",
              Referer: "https://www.cninfo.com.cn/",
              ...(metadata.request ? { "Content-Type": metadata.request.contentType } : {}),
            }
          : kind.startsWith("tencent-")
            ? { "User-Agent": "Mozilla/5.0", Referer: "https://gu.qq.com/" }
            : EASTMONEY_F10_HEADERS;
        const response = await fetch(url, {
          headers,
          signal,
          ...(metadata.request
            ? { method: metadata.request.method, body: metadata.request.body }
            : {}),
        });
        bytes = Buffer.from(await response.arrayBuffer());
        fetchedAt = new Date(now()).toISOString();
        if (!response.ok) {
          reason = `http_${response.status}`;
          retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        } else {
          success = await inspect(
            bytes,
            id,
            company,
            kind,
            url,
            kind === "eastmoney-shares" || kind === "share-structure"
              ? fetchedAt
              : new Date(requestStarted).toISOString(),
            metadata,
            documents,
          );
          if (!success) {
            reason = kind.startsWith("cninfo-")
              ? "no_supported_disclosure_at_cutoff"
              : kind === "share-structure" ||
                  kind.startsWith("eastmoney-") ||
                  kind.startsWith("tencent-")
                ? "no_supported_quote_at_cutoff"
                : kind === "recent-financials" ? "no_supported_recent_report_at_cutoff"
                : "no_supported_annual_amounts";
            retryable = false;
          }
        }
      } catch (error) {
        const failure = error as Error & { cause?: { code?: string } };
        reason = options.signal?.aborted
          ? "interrupted"
          : [failure.message, failure.cause?.code].filter(Boolean).join(":");
        if (
          reason === "source_no_records" ||
          reason?.startsWith("Invalid/empty financial response:") ||
          /^PDF (?:cover identity\/year mismatch|identity\/year unverified):/.test(reason ?? "") ||
          reason?.startsWith("Statement ") ||
          reason?.startsWith("recent_financials_")
        )
          retryable = false;
      }
      const event = {
        ticker: company.ticker,
        sourceId: id,
        url,
        attempt,
        state: success
          ? ("success" as const)
          : options.signal?.aborted
            ? ("interrupted" as const)
            : ("source_error" as const),
        durationMs: Math.max(0, now() - requestStarted),
        bytes: bytes.length,
        ...(reason ? { reason } : {}),
      };
      input.collection!.events.push(event);
      // Invalid/HTML responses are archived losslessly as diagnostics, never parsed as financial evidence.
      const stored = success
        ? bytes
        : Buffer.from(
            JSON.stringify({
              url,
              reason,
              rawSha256: sha256(bytes),
              rawBase64: bytes.toString("base64"),
              ...(reason === "source_no_records"
                ? { financialPublication: financialPublication.get(company.ticker) }
                : {}),
            }),
          );
      const pdf = success && kind === "cninfo-annual-pdf",
        hash = sha256(stored),
        relative = `sources/${hash}.${pdf ? "pdf" : "json"}`;
      await fs.writeFile(path.join(directory, relative), stored);
      const source: Source = {
        id,
        path: relative,
        url,
        mediaType: pdf ? "application/pdf" : "application/json",
        fetchedAt,
        requestStartedAt: new Date(requestStarted).toISOString(),
        sha256: hash,
        ...metadata,
        ...(success ? { mapping: kind } : {}),
      };
      input.sources.push(source);
      await opened.registerSource({ ...source, path: path.resolve(directory, source.path) });
      if (success) cache.set(key, source);
      else if (reason === "source_no_records")
        negativeCache.set(key, { ...source, path: path.resolve(directory, relative) });
      await save(company);
      if (success) return true;
      if (reason) company.collection!.errors.push(`${kind}:${reason}`);
      if (options.signal?.aborted) {
        company.collection!.state = "interrupted";
        return false;
      }
      if (!retryable) break;
    }
    return false;
  };
  const sharedRequests = new Map<string, Promise<boolean>>();
  const capture = async (
    company: CompanyFacts,
    kind: SourceKind,
    url: string,
    companyStarted: number,
  ): Promise<boolean> => {
    if (kind !== "eastmoney-session" && kind !== "tencent-session" && kind !== "cninfo-stock-list")
      return captureSource(company, kind, url, companyStarted);
    const existing = sharedRequests.get(url);
    if (existing) {
      if (await existing) return captureSource(company, kind, url, companyStarted); // Verified response is now in the cache.
      if (!sharedRequests.has(url)) return capture(company, kind, url, companyStarted);
      company.collection!.errors.push(`${kind}:shared_source_unavailable`);
      return false;
    }
    const beforeRequests = company.collection!.requests;
    const request = captureSource(company, kind, url, companyStarted).then((success) => {
      // A local budget can prevent an attempt; it says nothing about the shared upstream source.
      if (!success && company.collection!.requests === beforeRequests) sharedRequests.delete(url);
      return success;
    });
    sharedRequests.set(url, request);
    return request;
  };
  // 先用有限的公告索引锁定截至日可用年报；PDF 解析是回退路径，不扫描不受限的报告集合。
  const collectReports = async (
    company: CompanyFacts,
    companyStarted: number,
    assess: () => Promise<ReturnType<typeof evaluateCompany>>,
  ) => {
    const fail = (reason: string) => {
      company.collection!.errors.push(reason);
      if (company.collection!.state === "complete") company.collection!.state = "source_error";
    };
    let evaluation = await assess();
    const activeMissing = (conditions: typeof evaluation.conditions): string[] =>
      conditions.flatMap((condition) =>
        condition.state === "not_evaluated"
          ? []
          : [...condition.missing, ...activeMissing(condition.components ?? [])],
      );
    const financialSelected = () => ["financial", "all"].includes(options.strategy ?? "");
    const enabledFinancialMethod = (method: string | undefined) =>
      !!method && (policy.strategies?.financial?.methods ?? []).includes(method as never);
    const financialInsurance = () =>
      financialSelected() &&
      ["pc_insurance", "life_insurance", "insurance_group"].includes(evaluation.method.value ?? "");
    const independentReportConditions = () =>
      financialInsurance() ||
      (financialSelected() && ["trust", "futures"].includes(evaluation.method.value ?? ""));
    const selectedConditions = () =>
      independentReportConditions()
        ? (evaluation.strategies?.financial_research?.conditions ?? [])
        : evaluation.conditions;
    const canUseReport = () => {
      // NCAV has a structured balance/quote contract; it never opens a PDF to
      // repair a quality-only gap.
      if (options.strategy === "ncav") return false;
      const financialPending =
        financialSelected() && evaluation.strategies?.financial_research?.state === "unknown";
      if (
        budget.pdfReports === 0 ||
        (!financialPending && evaluation.quality !== "unknown") ||
        evaluation.method.state !== "applies"
      )
        return false;
      // A routed method outside the frozen strategy policy is a coverage result,
      // not a reason to attempt a method-specific disclosure supplement.
      const supportedRegulatory = enabledFinancialMethod(evaluation.method.value);
      const insuranceMissing = activeMissing(
        financialInsurance()
          ? selectedConditions()
          : evaluation.conditions.filter((condition) => condition.layer === "quality"),
      );
      // Match only gaps served by the existing life statement parser. Its
      // restatement declaration currently covers 2023–2025. The direct capital
      // adapter binds the issuer itself; it never borrows group/child ratios.
      const supportedInsurance = insuranceMissing.some(
        (reason) =>
          evaluation.method.value === "life_insurance" &&
          (/^insurance_service_statement_unresolved:\d{4}$/.test(reason) ||
            /^insurance_solvency_context_unresolved:/.test(reason) ||
            (company.latestFiscalYear === 2025 &&
              /^(insurance_service_statement_basis_unresolved|insurance_three_year_return_evidence_unresolved)$/.test(
                reason,
              ))),
      );
      const supportedFinancialGroup =
        financialInsurance() &&
        evaluation.method.value === "insurance_group" &&
        insuranceMissing.some(
          (reason) =>
            /^insurance_solvency_context_unresolved:/.test(reason) ||
            (company.latestFiscalYear === 2025 &&
              /insurance_.*(?:basis|return).*unresolved/.test(reason)),
        );
      if (supportedInsurance || supportedFinancialGroup) return true;
      const active = independentReportConditions()
        ? selectedConditions()
        : [
            ...evaluation.conditions,
            ...(financialPending
              ? (evaluation.strategies?.financial_research?.conditions ?? [])
              : []),
          ];
      return activeMissing(active).some(
        (reason) =>
          /^reported_return_basis_unresolved:|^(shortBorrowings|longBorrowings|shortBondsPayable|bondsPayable|leaseLiabilities|currentNoncurrentLiabilities):\d{4}/.test(
            reason,
          ) ||
          (supportedRegulatory &&
            /^(regulatory_context_missing:|regulatory_actual_unresolved:|regulatory_requirement_unresolved:|liquidity_regime_unresolved$)/.test(
              reason,
            )),
      );
    };
    // Existing generic parsing can bind annual return bases, debt components,
    // disclosed regulatory actuals, and the supported insurance gaps above.
    // It cannot settle an undetermined
    // method, F.methodValidation alone, quotes, or an API-sufficient result.
    if (!canUseReport()) return;
    const stockUrl = "https://www.cninfo.com.cn/new/data/szse_stock.json";
    if (!(await capture(company, "cninfo-stock-list", stockUrl, companyStarted))) {
      fail("annual_report_index_unavailable");
      return;
    }
    // This directory supplies an announcement-query key, never proof of current listing status.
    const stockSource = cache.get(cacheKey(stockUrl))!;
    const documents = new Map<string, unknown>();
    const stockDocument = (await readJsonSource(stockSource)) as {
      stockList: Array<{ code: string; orgId: string }>;
    };
    documents.set(stockSource.id, stockDocument);
    const stocks = stockDocument.stockList;
    const organizations = [
      ...new Set(
        stocks
          .filter((row) => row.code === company.ticker)
          .map((row) => row.orgId)
          .filter(Boolean),
      ),
    ];
    if (organizations.length !== 1) {
      fail("annual_report_issuer_unresolved");
      return;
    }
    const issuer = {
      sourceId: stockSource.id,
      locator: `/stockList/${stocks.findIndex((row) => row.code === company.ticker && row.orgId === organizations[0])}`,
    };
    const lastYear = Number(asOf.slice(0, 4)) - 1,
      firstYear = lastYear - 6;
    const reports = new Map<
      number,
      { url: string; time: number; disclosure: NonNullable<Source["disclosure"]> }
    >();
    const seenPages = new Set<string>();
    for (let page = 1; ; page++) {
      const url = "https://www.cninfo.com.cn/new/hisAnnouncement/query";
      const request: NonNullable<Source["request"]> = {
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: new URLSearchParams({
          stock: `${company.ticker},${organizations[0]}`,
          searchkey: "",
          category: "category_ndbg_szsh;",
          seDate: `${firstYear}-01-01~${asOf.slice(0, 10)}`,
          pageNum: String(page),
          pageSize: "30",
          column: "szse",
          tabName: "fulltext",
          plate: "",
          trade: "",
          sortName: "time",
          sortType: "desc",
          isHLtitle: "false",
        }).toString(),
      };
      if (
        !(await captureSource(
          company,
          "cninfo-announcements",
          url,
          companyStarted,
          { request },
          documents,
        ))
      ) {
        fail("annual_report_query_unavailable");
        return;
      }
      const index = cache.get(cacheKey(url, request))!;
      const body = (await readJsonSource(index)) as {
        announcements: Array<Record<string, unknown>> | null;
        hasMore: boolean;
      };
      documents.set(index.id, body);
      const entries = body.announcements ?? [],
        fingerprint = sha256(JSON.stringify(entries));
      if (seenPages.has(fingerprint) || (body.hasMore && !entries.length)) {
        fail("annual_report_pagination_inconsistent");
        return;
      }
      seenPages.add(fingerprint);
      entries.forEach((entry, i) => {
        if (
          !entry ||
          typeof entry.secCode !== "string" ||
          !/^\d{6}$/.test(entry.secCode) ||
          typeof entry.announcementTitle !== "string" ||
          typeof entry.announcementTime !== "number" ||
          !Number.isFinite(entry.announcementTime) ||
          entry.announcementTime > Date.parse(asOf) ||
          typeof entry.adjunctUrl !== "string"
        )
          return;
        const formerCode = entry.secCode !== company.ticker;
        if (formerCode) {
          const ids = [
            ...new Set(stocks.filter((row) => row.code === entry.secCode).map((row) => row.orgId)),
          ];
          if (entry.orgId !== organizations[0] || ids.length !== 1 || ids[0] !== organizations[0])
            return;
        }
        const year = Number(
          cnAnnualReportYear(
            entry.announcementTitle,
            typeof entry.secName === "string" ? entry.secName : undefined,
          ),
        );
        if (!Number.isInteger(year) || year < firstYear || year > lastYear) return;
        let pdfUrl: URL;
        try {
          pdfUrl = new URL(entry.adjunctUrl, "https://static.cninfo.com.cn/");
        } catch {
          return;
        }
        if (
          pdfUrl.protocol !== "https:" ||
          pdfUrl.hostname !== "static.cninfo.com.cn" ||
          !/\.pdf$/i.test(pdfUrl.pathname)
        )
          return;
        if ((reports.get(year)?.time ?? -Infinity) < entry.announcementTime)
          reports.set(year, {
            url: pdfUrl.href,
            time: entry.announcementTime,
            disclosure: {
              sourceId: index.id,
              locator: `/announcements/${i}`,
              ...(formerCode ? { issuer } : {}),
            },
          });
      });
      if (!body.hasMore) break;
    }
    if (!reports.size) {
      fail("annual_report_not_found");
      return;
    }
    const latestReport = Math.max(...reports.keys());
    const neededYears = () => {
      const years = new Set<number>();
      const visit = (conditions: typeof evaluation.conditions) => {
        for (const condition of conditions) {
          if (condition.state === "not_evaluated") continue;
          if (condition.state === "unknown") {
            years.add(latestReport); // Current notes can clarify scope and revised comparisons.
            for (const reason of condition.missing)
              for (const match of reason.matchAll(/(?:^|:)(20\d{2})(?=:|$)/g))
                years.add(Number(match[1]));
            // The supported consolidated insurance statement also reports its
            // prior year. Prefer that newer comparison before the original
            // annual report, which may precede the applicable accounting basis.
            if (evaluation.method.value === "life_insurance")
              for (const reason of condition.missing) {
                const prior = reason.match(/^insurance_service_statement_unresolved:(20\d{2})$/);
                if (prior) years.add(Number(prior[1]) + 1);
              }
          }
          visit(condition.components ?? []);
        }
      };
      visit(selectedConditions());
      return years;
    };
    let attempted = false;
    for (const [year, report] of [...reports]
      .sort(([a], [b]) => b - a)
      .slice(0, budget.pdfReports)) {
      if (!canUseReport()) break;
      const financialPending =
        financialSelected() && evaluation.strategies?.financial_research?.state === "unknown";
      if (
        !neededYears().has(year) ||
        (!options.evaluateAll && evaluation.quality === "fail" && !financialPending)
      )
        continue;
      attempted = true;
      if (
        !(await captureSource(
          company,
          "cninfo-annual-pdf",
          report.url,
          companyStarted,
          { disclosure: report.disclosure },
          documents,
        ))
      )
        fail("annual_report_pdf_unavailable");
      if (["budget_exhausted", "interrupted"].includes(company.collection!.state)) break;
      evaluation = await assess();
    }
    if (
      attempted &&
      evaluation.quality !== "fail" &&
      (evaluation.quality === "unknown" || evaluation.priority === "unknown")
    )
      company.collection!.errors.push("annual_report_supplement_unresolved");
  };
  // The async generator serializes next() calls in catalogue order while each
  // worker retains only its own seed facts and decoded source documents.
  const seeds = readEvidenceCompanies(inputFile, {
    input,
    companyRecords: { path: recordsFile, sha256: companyRecordsSha256 },
  });
  // 每家公司独立采集并持续重评；事实增量可能解除某个策略的资料缺口。
  await mapPool(input.companies, concurrency, async (company) => {
    const seed = await seeds.next();
    if (seed.done || seed.value.ticker !== company.ticker)
      throw new Error("Collection seed differs from catalogue");
    if (globalStopped()) return;
    if (company.identity?.state === "not_yet_listed") {
      company.collection!.state = "complete";
      await save(company);
      return;
    }
    const documents = new Map<string, unknown>();
    let latestNormalized: CompanyFacts | undefined;
    let latestEvaluation: ReturnType<typeof evaluateCompany> | undefined;
    const terminalForEnabledStrategy = (result: ReturnType<typeof evaluateCompany>) => {
      const hasReason = (conditions: typeof result.conditions | undefined, id: string) =>
        conditions?.some(
          (condition) =>
            condition.id === id && condition.reason === "financial_method_not_supported",
        ) ?? false;
      const financialUnsupported = hasReason(
        result.strategies?.financial_research?.conditions,
        "FR.method",
      );
      const qualityUnsupported = hasReason(result.conditions, "F.methodValidation");
      // A quality research pool remains live until its base itself fails. Once
      // it passes, both downstream views must be settled before collection can
      // stop; a routed, explicitly unsupported lease is already settled.
      const qualityTerminal =
        qualityUnsupported ||
        result.quality === "fail" ||
        (result.quality === "pass" &&
          ["pass", "fail"].includes(result.research) &&
          ["pass", "fail"].includes(result.priority));
      const financialTerminal =
        financialUnsupported ||
        result.strategies?.financial_research?.state === "fail" ||
        result.strategies?.financial_research?.state === "not_applicable" ||
        (result.strategies?.financial_research?.state === "pass" &&
          result.strategies.financial_value?.state !== "unknown");
      const ncavTerminal = ["pass", "fail", "not_applicable"].includes(
        result.strategies?.ncav?.state ?? "",
      );
      const lead = result.strategies?.financial_discount;
      // An exhausted lead path is retained as unknown, not a reason to extend
      // specialist enrichment. Its source set is annual indicators + quotes.
      const leadTerminal =
        !lead ||
        ["pass", "fail", "not_applicable"].includes(lead.state) ||
        (lead.state === "unknown" &&
          (quotesAttempted ||
            (!lead.conditions.some((c) => c.id === "FD.quote") &&
              !lead.conditions.some((c) => c.reason === "financial_identity_unresolved"))));
      return options.strategy === "financial"
        ? financialTerminal && leadTerminal
        : options.strategy === "ncav"
          ? ncavTerminal
          : options.strategy === "all"
            ? qualityTerminal && financialTerminal && ncavTerminal && leadTerminal &&
              (!result.strategies?.earnings_repair || ["pass", "fail", "not_applicable"].includes(result.strategies.earnings_repair.state))
            : qualityTerminal;
    };
    const assess = async () => {
      const assessmentStarted = performance.now();
      company.asOf = asOf;
      const normalized = await opened.normalizeCompany(
        { ...company, facts: seed.value!.facts },
        documents,
      );
      latestNormalized = normalized;
      company.latestFiscalYear = normalized.latestFiscalYear;
      const result = evaluateCompany(normalized, policy, {
        evaluateAll: options.evaluateAll,
        strategy: options.strategy,
      });
      latestEvaluation = result;
      const terminal = terminalForEnabledStrategy(result);
      if (terminal && !options.evaluateAll) {
        const selected =
          options.strategy === "ncav"
            ? (result.strategies?.ncav?.conditions ?? [])
            : options.strategy === "financial"
              ? (result.strategies?.financial_research?.conditions ?? [])
              : options.strategy === "all"
                ? Object.values(result.strategies ?? {}).flatMap((strategy) => strategy.conditions)
                : result.conditions.filter((c) => c.layer === "quality");
        const failedIds = [...new Set(selected.filter((c) => c.state === "fail").map((c) => c.id))];
        if (failedIds.length)
          company.collection!.stoppedAfterFailure = {
            policyVersion: policy.version,
            conditionIds: failedIds,
          };
      }
      timing.assessmentMs += performance.now() - assessmentStarted;
      return result;
    };
    const companyStarted = now();
    if (!options.recentOnly) company.collection!.state = "complete";
    const prefix = company.identity
      ? ({ SSE: "SH", SZSE: "SZ", BSE: "BJ" } as const)[company.identity.exchange]
      : company.ticker.startsWith("6")
        ? "SH"
        : /^[489]/.test(company.ticker)
          ? "BJ"
          : "SZ";
    let quotesAttempted = false;
    const repairNeedsQuote = (evaluation: ReturnType<typeof evaluateCompany>) => {
      const repair = evaluation.strategies?.earnings_repair;
      return repair?.state === "unknown" &&
        repair.conditions.some(c => c.id === "ER.price" && c.state === "unknown") &&
        repair.conditions.filter(c => c.id !== "ER.price").every(c => c.state === "pass");
    };
    const collectQuotes = async (evaluation: ReturnType<typeof evaluateCompany>) => {
      const priorityFailure = evaluation.conditions.some(
        (condition) => ["P1", "P2", "P3"].includes(condition.id) && condition.state === "fail",
      );
      const financialNeedsQuote =
        (options.strategy === "financial" || options.strategy === "all") &&
        evaluation.strategies?.financial_research?.state === "pass" &&
        evaluation.strategies.financial_value?.state === "unknown";
      const leadNeedsQuote =
        evaluation.strategies?.financial_discount?.state === "unknown" &&
        evaluation.strategies.financial_discount.conditions.some((c) => c.id === "FD.quote");
      const ncavNeedsQuote =
        (options.strategy === "ncav" || options.strategy === "all") &&
        evaluation.strategies?.ncav?.state === "unknown" &&
        evaluation.strategies.ncav.conditions.some(
          (c) => c.id === "NCAV.discount" && c.state === "unknown",
        );
      if (
        quotesAttempted ||
        !(
          (evaluation.quality === "pass" && !priorityFailure) ||
          financialNeedsQuote ||
          leadNeedsQuote ||
          repairNeedsQuote(evaluation) ||
          ncavNeedsQuote
        ) ||
        ["budget_exhausted", "interrupted"].includes(company.collection!.state)
      )
        return evaluation;
      quotesAttempted = true;
      const tencent = (symbol: string) =>
        "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?" +
        new URLSearchParams({
          param: `${symbol},day,${asOf.slice(0, 7)}-01,${asOf.slice(0, 10)},10,`,
        });
      const structure =
        "https://datacenter.eastmoney.com/securities/api/data/v1/get?" +
        new URLSearchParams({
          reportName: "RPT_F10_EH_EQUITY",
          columns: "ALL",
          filter: `(SECUCODE="${company.ticker}.${prefix}")`,
          pageNumber: "1",
          pageSize: "20",
          sortTypes: "-1",
          sortColumns: "END_DATE",
          source: "HSF10",
          client: "PC",
        });
      const jobs: Array<[SourceKind, string]> = [
        ["tencent-daily", tencent(prefix.toLowerCase() + company.ticker)],
      ];
      if (live || now() <= Date.parse(asOf)) jobs.push(["share-structure", structure]);
      // Daily price and shares are independent operands for the next
      // assessment. Keep the per-company fan-out at two: it retains their
      // priority over the market-session request and caps four company workers
      // at eight quote fetches. allSettled drains the paired work before an
      // unexpected storage error can leave it writing after this company exits.
      const primaryQuotes = await Promise.allSettled(
        jobs.map(([kind, url]) => capture(company, kind, url, companyStarted)),
      );
      const quoteError = primaryQuotes.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (quoteError) throw quoteError.reason;
      if (
        primaryQuotes.some((result) => result.status === "fulfilled" && !result.value) &&
        company.collection!.state === "complete"
      )
        company.collection!.state = "source_error";
      if (
        !["budget_exhausted", "interrupted"].includes(company.collection!.state) &&
        !(await capture(company, "tencent-session", tencent("sh000001"), companyStarted)) &&
        company.collection!.state === "complete"
      )
        company.collection!.state = "source_error";
      const result = await assess();
      if (
        !["budget_exhausted", "interrupted"].includes(company.collection!.state) &&
        !latestNormalized?.facts.some((f) => f.field === "ordinaryShares" && f.state === "observed")
      ) {
        company.collection!.errors.push("share-structure:ordinary_share_count_unresolved");
        company.collection!.state = "source_error";
      }
      return result;
    };
    const collectAnnual = async () => {
      const lastYear = Number(asOf.slice(0, 4)) - 1;
      const fiveYearDates = Array.from({ length: 5 }, (_, i) => `${lastYear - i}-12-31`).join(",");
      const ncavOnly = options.strategy === "ncav";
      // A seeded financial route can already prove NCAV is inapplicable. Avoid
      // another request in that case, but otherwise obtain the provider's own
      // latest report family rather than guessing a universal statement API.
      if (ncavOnly && terminalForEnabledStrategy(await assess())) {
        return;
      }
      // Independent repair needs seven years even when the quality funnel fails.
      // Extend the same structured request, not a company-specific enrichment loop.
      const repairSelected = options.strategy === "all" && !!policy.strategies?.earningsRepair;
      const indicatorStart = ncavOnly ? `${lastYear}-12-31` : `${lastYear - (repairSelected ? 6 : 4)}-12-31`;
      const indicatorsUrl =
        "https://datacenter-web.eastmoney.com/api/data/v1/get?" +
        new URLSearchParams({
          reportName: "RPT_F10_FINANCE_MAINFINADATA",
          columns: "ALL",
          filter: `(SECUCODE="${company.ticker}.${prefix}")(REPORT_TYPE="年报")(REPORT_DATE>='${indicatorStart}')(REPORT_DATE<='${lastYear}-12-31')`,
          pageSize: "50",
          pageNumber: "1",
          sortTypes: "-1",
          sortColumns: "REPORT_DATE",
        });
      const indicatorSuccess = await capture(company, "indicators", indicatorsUrl, companyStarted);
      let assessment = indicatorSuccess ? await assess() : undefined;
      if (assessment && terminalForEnabledStrategy(assessment)) {
        return;
      }
      const initial = assessment;
      const needsBusinessProfile =
        !!initial &&
        (ncavOnly
          ? initial.method.state === "unresolved"
          : (["银行", "证券", "保险"].includes(organizationTypes.get(company.ticker) ?? "") &&
              initial.method.state === "unresolved") ||
            (company.identity &&
              (initial.method.state === "unresolved" ||
                (initial.method.value === "nonfinancial" &&
                  initial.conditions.some(
                    (c) => c.id === "cycle" && c.reason === "cycle_scope_unresolved",
                  )))));
      if (needsBusinessProfile) {
        const profileUrl =
          "https://datacenter-web.eastmoney.com/api/data/v1/get?" +
          new URLSearchParams({
            reportName: "RPT_F10_BASIC_ORGINFO",
            columns: "ALL",
            filter: `(SECUCODE="${company.ticker}.${prefix}")`,
            pageSize: "1",
            pageNumber: "1",
          });
        await capture(company, "company-profile", profileUrl, companyStarted);
        assessment = await assess();
        if (terminalForEnabledStrategy(assessment)) {
          return;
        }
      }
      // Independent leads reserve their price operands before specialist statement
      // enrichment can spend the company's remaining request budget.
      const afterProfile = assessment ?? (await assess());
      if (afterProfile.strategies?.financial_discount?.conditions.some((c) => c.id === "FD.quote") ||
        repairNeedsQuote(afterProfile)) {
        const afterLeadQuotes = await collectQuotes(afterProfile);
        if (terminalForEnabledStrategy(afterLeadQuotes)) {
          return;
        }
      }
      const companyType = ({ 通用: "4", 银行: "3", 保险: "2", 证券: "1" } as Record<string, string>)[
        organizationTypes.get(company.ticker) ?? ""
      ];
      const missingJobs: Array<{
        kind: "income" | "balance" | "cashflow";
        endpoint: string;
        dates: string;
      }> = [];
      if (!indicatorSuccess || !companyType) {
        if (!["budget_exhausted", "interrupted"].includes(company.collection!.state))
          company.collection!.state = "source_error";
        company.collection!.errors.push("statement_family_unresolved");
      } else {
        const jobs: Array<{
          kind: "income" | "balance" | "cashflow";
          endpoint: string;
          dates: string;
        }> = (
          ncavOnly
            ? [["balance", "zcfzbAjaxNew", `${lastYear}-12-31`]]
            : [
                ["income", "lrbAjaxNew", fiveYearDates],
                ["balance", "zcfzbAjaxNew", fiveYearDates],
                ["cashflow", "xjllbAjaxNew", fiveYearDates],
              ]
        ).map(([kind, endpoint, dates]) => ({
          kind: kind as "income" | "balance" | "cashflow",
          endpoint,
          dates,
        }));
        for (const job of jobs) {
          const url =
            "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/" +
            job.endpoint +
            "?" +
            new URLSearchParams({
              companyType,
              reportDateType: "0",
              reportType: "1",
              dates: job.dates,
              code: prefix + company.ticker,
            });
          const success = await capture(company, job.kind, url, companyStarted);
          if (!success && company.collection!.state === "complete")
            company.collection!.state = "source_error";
          if (["budget_exhausted", "interrupted"].includes(company.collection!.state)) break;
          const requested = job.dates.split(","),
            returned = statementYears.get(`${company.ticker}:${job.kind}`) ?? new Set<number>();
          // A provider may truncate the five-year request; retry only its missing
          // dates before considering the separate, condition-driven seven-year tail.
          const missing = requested.filter((date) => !returned.has(Number(date.slice(0, 4))));
          if (success && job.dates === fiveYearDates && missing.length)
            missingJobs.push({ ...job, dates: missing.join(",") });
        }
      }
      let postStatements = await assess();
      if (terminalForEnabledStrategy(postStatements)) {
        return;
      }
      postStatements = await collectQuotes(postStatements);
      if (terminalForEnabledStrategy(postStatements)) {
        return;
      }
      for (const job of missingJobs) {
        if (["budget_exhausted", "interrupted"].includes(company.collection!.state)) break;
        const url =
          "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/" +
          job.endpoint +
          "?" +
          new URLSearchParams({
            companyType: companyType!,
            reportDateType: "0",
            reportType: "1",
            dates: job.dates,
            code: prefix + company.ticker,
          });
        if (
          !(await capture(company, job.kind, url, companyStarted)) &&
          company.collection!.state === "complete"
        )
          company.collection!.state = "source_error";
      }
      if (missingJobs.length) postStatements = await assess();
      if (terminalForEnabledStrategy(postStatements)) {
        return;
      }
      const cycleApplies = latestNormalized?.checks.cycle?.state === "applies";
      const needsSevenYearHistory =
        postStatements.method.state === "applies" &&
        postStatements.method.value === "nonfinancial" &&
        cycleApplies &&
        postStatements.conditions.some(
          (condition) => condition.id === "cycle" && condition.state === "unknown",
        );
      const currentHistoryComplete = ["income", "cashflow"].every((kind) =>
        fiveYearDates
          .split(",")
          .every((date) =>
            statementYears.get(`${company.ticker}:${kind}`)?.has(Number(date.slice(0, 4))),
          ),
      );
      if (needsSevenYearHistory && !currentHistoryComplete)
        company.collection!.errors.push(
          "history_extension_deferred:recent_annual_history_incomplete",
        );
      if (
        !ncavOnly &&
        postStatements.quality !== "fail" &&
        needsSevenYearHistory &&
        currentHistoryComplete &&
        !["budget_exhausted", "interrupted"].includes(company.collection!.state)
      ) {
        const olderDates = [`${lastYear - 5}-12-31`, `${lastYear - 6}-12-31`].join(",");
        const olderIndicators =
          "https://datacenter-web.eastmoney.com/api/data/v1/get?" +
          new URLSearchParams({
            reportName: "RPT_F10_FINANCE_MAINFINADATA",
            columns: "ALL",
            filter: `(SECUCODE="${company.ticker}.${prefix}")(REPORT_TYPE="年报")(REPORT_DATE>='${lastYear - 6}-12-31')(REPORT_DATE<='${lastYear - 5}-12-31')`,
            pageSize: "20",
            pageNumber: "1",
            sortTypes: "-1",
            sortColumns: "REPORT_DATE",
          });
        if (!repairSelected) await capture(company, "indicators", olderIndicators, companyStarted);
        for (const [kind, endpoint] of [
          ["income", "lrbAjaxNew"],
          ["cashflow", "xjllbAjaxNew"],
        ] as const) {
          const url =
            "https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/" +
            endpoint +
            "?" +
            new URLSearchParams({
              companyType: ({ 通用: "4", 银行: "3", 保险: "2", 证券: "1" } as Record<string, string>)[
                organizationTypes.get(company.ticker) ?? ""
              ]!,
              reportDateType: "0",
              reportType: "1",
              dates: olderDates,
              code: prefix + company.ticker,
            });
          if (
            !(await capture(company, kind, url, companyStarted)) &&
            company.collection!.state === "complete"
          )
            company.collection!.state = "source_error";
          if (["budget_exhausted", "interrupted"].includes(company.collection!.state)) break;
        }
        postStatements = await assess();
        if (terminalForEnabledStrategy(postStatements)) {
          return;
        }
      }
      await collectQuotes(postStatements);
      if (
        options.pdfFallback !== false &&
        !["budget_exhausted", "interrupted"].includes(company.collection!.state)
      )
        await collectReports(company, companyStarted, assess);
      const afterSupplement = await assess();
      if (terminalForEnabledStrategy(afterSupplement)) {
        return;
      }
      await collectQuotes(afterSupplement);
    };
    if (!options.recentOnly) await collectAnnual();
    // 辅助项只在年度研究通过后取一次统一响应；无论成功与否，都不能改变年度采集状态。
    const result = latestEvaluation ?? await assess();
    if (result.research === "pass" && result.method.state === "applies" && result.method.value === "nonfinancial") {
      const annualState = company.collection!.state;
      if (!live && result.recentFinancials?.state === "complete") {
        const sourceIds = new Set(result.recentFinancials.metrics.flatMap(m => m.factIds)
          .flatMap(id => latestNormalized!.facts.find(f => f.id === id)?.evidence.map(e => e.sourceId) ?? []));
        for (const sourceId of sourceIds) {
          const source = input.sources.find(s => s.id === sourceId)!;
          input.collection!.events.push({ ticker: company.ticker, sourceId, url: source.url,
            attempt: 0, state: "cache_hit", durationMs: 0, bytes: 0, reason: "recent_same_cutoff_facts" });
        }
      } else if (!globalStopped() && !options.signal?.aborted) {
        try {
          await capture(company, "recent-financials", cnRecentFinancialsUrl(company.ticker, prefix, asOf), companyStarted);
        } finally { company.collection!.state = annualState; }
      }
    }
    await save(company);
  });
  if (!(await seeds.next()).done) throw new Error("Extra collection seed");
  const collection = input.collection!;
  collection.status =
    input.companies.some((c) => ["pending", "interrupted"].includes(c.collection!.state)) ||
    options.signal?.aborted ||
    (globalStopped() && input.companies.some((c) => c.collection!.state === "budget_exhausted"))
      ? "partial"
      : "complete";
  advanceCutoff();
  collection.finishedAt = new Date(now()).toISOString();
  for (const company of input.companies) company.asOf = asOf;
  await writes;
  await checkpoint(true);
  await fs.unlink(journalFile);
  return { inputFile, status: collection.status };
}
