/**
 * 证据输入：核验来源哈希、证券身份与披露时点，再将结构化响应和受支持年报归一化为财务事实。
 * 导入的数值须能从原文重建；缺失与冲突保留为事实状态，是否满足筛选条件由 screening.ts 判断。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { readJsonLines } from "../shared/runtime.js";
import {
  parseCnStatementFacts,
  parseCnRecentFinancialFacts,
  parseCnPriceFacts,
  parseCnShareStructureFacts,
  parseTencentDailyFacts,
  cnSessionObservationCurrent,
} from "./sources/market-data.js";
import { parseCnDisclosureFacts, type DisclosureText } from "./sources/annual-reports.js";
import {
  latestDisclosedFiscalYear,
  financingRoleInputs,
  insuranceContextSchema,
  type FinancialFact,
  type CompanyFacts,
} from "../shared/financial-model.js";

import {
  parseCnListingPage,
  reconcileCnUniverse,
  decodeCnListingDocument,
} from "./sources/listings.js";
import {
  applyBrokerRegulatoryReference,
  brokerRegulatoryReferenceSourceId,
  ensureBrokerRegulatoryReferenceSource,
  loadBrokerRegulatoryReference,
} from "./sources/financial-reports.js";

const date = z.string().refine((v) => Number.isFinite(new Date(v).getTime()), "Invalid date");
const period = z
  .object({ start: date, end: date })
  .refine((p) => Date.parse(p.start) <= Date.parse(p.end), "Invalid coverage period");
const scope = z.object({
  state: z.enum(["applies", "not_applicable", "unresolved"]),
  evidence: z.array(z.string()),
  coverage: period.optional(),
  reason: z.string().optional(),
});
const identity = z
  .object({
    exchange: z.enum(["SSE", "SZSE", "BSE"]),
    board: z.string(),
    listedAt: date,
    listedAtBasis: z.literal("exchange_listing_or_selected_tier").optional(),
    state: z.enum(["listed", "not_yet_listed"]),
    industryLabels: z.array(z.string()),
    sourceId: z.string(),
    locator: z.string(),
    observedAt: date,
  })
  .strict();
const universe = z
  .object({
    status: z.enum(["complete", "partial"]),
    asOf: date,
    coverage: z.array(
      z
        .object({
          board: z.enum(["SSE_MAIN", "SSE_STAR", "SZSE", "BSE"]),
          state: z.enum(["complete", "partial", "missing"]),
          expected: z.number().int().nonnegative().optional(),
          received: z.number().int().nonnegative(),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const fact = z
  .object({
    id: z.string().min(1),
    field: z.string().min(1),
    entity: z.string().min(1),
    year: z.number().int(),
    period: z.object({ start: date, end: date }),
    publishedAt: date,
    basis: z.string().min(1),
    unit: z.string().min(1),
    state: z.enum(["observed", "derived", "missing", "conflicting", "not_applicable"]),
    value: z.union([z.number().finite(), z.string(), z.boolean()]).optional(),
    evidence: z.array(
      z.object({
        sourceId: z.string(),
        locator: z.string(),
        raw: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    ),
    reason: z.string().optional(),
    unitScale: z.number().finite().positive().optional(),
    derivation: z.object({ algorithm: z.string(), inputs: z.array(z.string()) }).optional(),
  })
  .strict();
const company = z
  .object({
    ticker: z.string().min(1),
    companyId: z.string().min(1),
    companyName: z.string(),
    market: z.enum(["CN", "US"]),
    currency: z.string().min(1),
    asOf: date,
    latestFiscalYear: z.number().int(),
    basis: z.string().min(1),
    quoteDate: date.optional(),
    lastCompletedTradingDay: date.optional(),
    method: scope.extend({
      value: z
        .enum([
          "nonfinancial",
          "bank",
          "broker",
          "financial_lease",
          "pc_insurance",
          "life_insurance",
          "insurance_group",
          "futures",
          "trust",
          "mixed",
        ])
        .optional(),
    }),
    checks: z.record(scope),
    facts: z.array(fact),
    identity: identity.optional(),
    collection: z
      .object({
        state: z.enum(["pending", "complete", "source_error", "budget_exhausted", "interrupted"]),
        requests: z.number().int().nonnegative(),
        errors: z.array(z.string()),
        stoppedAfterFailure: z
          .object({ policyVersion: z.string(), conditionIds: z.array(z.string()) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const collectionBudgetSchema = z
  .object({
    attempts: z.number().int().positive(),
    requestMs: z.number().int().positive(),
    companyRequests: z.number().int().positive(),
    companyMs: z.number().int().positive(),
    globalRequests: z.number().int().positive(),
    globalMs: z.number().int().positive(),
    pdfReports: z.number().int().nonnegative().default(1),
  })
  .strict();
const selection = z
  .object({
    companyIds: z
      .array(z.string().min(1))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, "Selected company IDs must be unique"),
    reason: z.string().min(1),
  })
  .strict();
export const evidenceInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    companies: z.array(company),
    universe: universe.optional(),
    selection: selection.optional(),
    collection: z
      .object({
        status: z.enum(["complete", "partial"]),
        asOf: date,
        cutoffMode: z.enum(["live", "explicit"]).optional(),
        cachePolicy: z
          .object({ annualDays: z.number().min(0).max(365), emptyHours: z.literal(24) })
          .strict()
          .optional(),
        startedAt: date,
        finishedAt: date.optional(),
        budget: collectionBudgetSchema,
        concurrency: z.number().int().positive().optional(),
        requests: z.number().int().nonnegative(),
        timing: z.record(z.number().nonnegative()).optional(),
        events: z.array(
          z.object({
            ticker: z.string(),
            sourceId: z.string(),
            url: z.string().url(),
            attempt: z.number().int().nonnegative(),
            state: z.enum(["success", "source_error", "interrupted", "cache_hit"]),
            durationMs: z.number().nonnegative(),
            bytes: z.number().int().nonnegative(),
            reason: z.string().optional(),
          }),
        ),
      })
      .strict()
      .optional(),
    sources: z.array(
      z
        .object({
          id: z.string().min(1),
          path: z.string().min(1),
          url: z.string().url(),
          mediaType: z.enum(["application/json", "application/pdf"]),
          mapping: z
            .enum([
              "income",
              "balance",
              "cashflow",
              "indicators",
              "recent-financials",
              "company-profile",
              "share-structure",
              "reviewed-scope-v1",
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
            ])
            .optional(),
          fetchedAt: date,
          requestStartedAt: date.optional(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          request: z
            .object({
              method: z.literal("POST"),
              body: z.string(),
              contentType: z.literal("application/x-www-form-urlencoded"),
            })
            .strict()
            .optional(),
          disclosure: z
            .object({
              sourceId: z.string(),
              locator: z.string(),
              issuer: z.object({ sourceId: z.string(), locator: z.string() }).strict().optional(),
            })
            .strict()
            .optional(),
          pages: z.array(z.number().int().positive()).min(1).optional(),
        })
        .strict()
        .refine(
          (s) => !s.requestStartedAt || Date.parse(s.requestStartedAt) <= Date.parse(s.fetchedAt),
          "Source request starts after response capture",
        )
        .refine(
          (s) => (s.mediaType === "application/pdf") === (s.mapping === "cninfo-annual-pdf"),
          "Source media type and mapping disagree",
        ),
    ),
  })
  .strict();
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
const recordsInputSchema = evidenceInputSchema.extend({
  schemaVersion: z.literal(2),
  companyRecords: z
    .object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
});
const companyRecordSchema = z
  .object({ market: z.enum(["CN", "US"]), ticker: z.string(), facts: z.array(fact) })
  .strict();
// 输入恢复：中断运行仅恢复完整日志记录，尾部半条记录不构成证据。
export async function readEvidenceMetadata(file: string) {
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  // A live collection checkpoints periodically; complete journal records after
  // that checkpoint recover captured sources without requiring another fetch.
  if (raw.collectionJournal !== undefined) {
    const journal = z
      .object({
        path: z.literal("collection-journal.jsonl"),
        sequence: z.number().int().nonnegative(),
      })
      .strict()
      .parse(raw.collectionJournal);
    if (raw.schemaVersion !== 2 || raw.collection?.status !== "partial")
      throw new Error("Journal requires an unfinished collection");
    const text = await fs.readFile(path.join(path.dirname(file), journal.path), "utf8");
    const companies = new Map(
      raw.companies.map((c: EvidenceInput["companies"][number]) => [c.ticker, c]),
    );
    const events = [...raw.collection.events];
    let sequence = journal.sequence;
    // Only an incomplete final write can be ignored after an abrupt stop.
    for (const line of text
      .slice(0, text.lastIndexOf("\n") + 1)
      .split("\n")
      .filter(Boolean)) {
      const delta = JSON.parse(line);
      if (!Number.isSafeInteger(delta.sequence))
        throw new Error("Invalid collection journal sequence");
      if (delta.sequence <= journal.sequence) continue;
      if (delta.sequence !== sequence + 1) throw new Error("Collection journal has a gap");
      sequence = delta.sequence;
      for (const c of delta.companies) {
        if (!companies.has(c.ticker)) throw new Error("Journal added an unknown company");
        companies.set(c.ticker, c);
      }
      raw.sources.push(...delta.sources);
      events.push(...delta.events);
      raw.collection = { ...delta.collection, events };
    }
    raw.companies = [...companies.values()];
    for (const c of raw.companies) c.asOf = raw.collection.asOf;
    delete raw.collectionJournal;
  }
  if (raw.schemaVersion === 1)
    return { input: evidenceInputSchema.parse(raw), companyRecords: undefined };
  const { companyRecords, ...metadata } = recordsInputSchema.parse(raw);
  if (metadata.companies.some((c) => c.facts.length))
    throw new Error("Company catalogue must not duplicate fact records");
  const recordsPath = path.resolve(path.dirname(file), companyRecords.path);
  if (!recordsPath.startsWith(path.resolve(path.dirname(file)) + path.sep))
    throw new Error("Company records escape input directory");
  return {
    input: { ...metadata, schemaVersion: 1 as const },
    companyRecords: { ...companyRecords, path: recordsPath },
  };
}
/** Read saved facts without reinterpreting them; normalization is a separate boundary. */
export async function* readEvidenceCompanies(
  file: string,
  metadata: Awaited<ReturnType<typeof readEvidenceMetadata>>,
): AsyncGenerator<EvidenceInput["companies"][number]> {
  const { input, companyRecords } = metadata;
  const securities = new Set<string>();
  let index = 0;
  const records = companyRecords
    ? readJsonLines(companyRecords.path, companyRecords.sha256)
    : input.companies.map((c) => ({ market: c.market, ticker: c.ticker, facts: c.facts }));
  for await (const raw of records) {
    const record = companyRecordSchema.parse(raw),
      header = input.companies[index++];
    if (!header || header.market !== record.market || header.ticker !== record.ticker)
      throw new Error("Company record differs from catalogue");
    const key = `${record.market}:${record.ticker}`;
    if (securities.has(key)) throw new Error(`Duplicate security: ${key}`);
    securities.add(key);
    yield structuredClone({ ...header, facts: record.facts });
  }
  if (index !== input.companies.length)
    throw new Error("Company record count differs from catalogue");
}
export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
/**
 * Daily bars and market-session responses need the request boundary: a response
 * saved after 15:00 may still have begun before the close.  Legacy archives do
 * not have that boundary, so only the share endpoint's provider timestamp can
 * be rebuilt without promoting a possible intraday bar to a close.
 */
function quoteRebuildObservedAt(source: EvidenceInput["sources"][number]): string | undefined {
  if (source.mapping === "eastmoney-shares") return source.fetchedAt;
  if (
    ["eastmoney-daily", "eastmoney-session", "tencent-daily", "tencent-session"].includes(
      source.mapping ?? "",
    )
  )
    return source.requestStartedAt;
  return source.fetchedAt;
}
function legacyQuoteNeedsRequestStart(source: EvidenceInput["sources"][number]): boolean {
  return (
    ["eastmoney-daily", "eastmoney-session", "tencent-daily", "tencent-session"].includes(
      source.mapping ?? "",
    ) && source.requestStartedAt === undefined
  );
}
export function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  for (const key of pointer
    .slice(1)
    .split("/")
    .map((v) => v.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function normalized(raw: unknown, unit: string, scale = 1): unknown {
  if (unit === "text" || unit === "boolean") return raw;
  if (typeof raw === "number") return raw * scale;
  if (typeof raw === "string" && /^[-+]?\d[\d,]*(\.\d+)?$/.test(raw.trim()))
    return Number(raw.replaceAll(",", "")) * scale;
  return undefined;
}
/** Read one original and revalidate it on every use, including the final archive copy. */
export async function readEvidenceSource(
  source: EvidenceInput["sources"][number],
  baseDirectory: string,
): Promise<Buffer> {
  const bytes = await fs.readFile(path.resolve(baseDirectory, source.path));
  if (sha256(bytes) !== source.sha256) throw new Error(`Source hash mismatch: ${source.id}`);
  return bytes;
}
// 信任校验：输入声明必须与已保存的原始来源、哈希及解析值一致。
export async function openEvidenceInput(file: string) {
  const metadata = await readEvidenceMetadata(file),
    { input } = metadata;
  // Capture originals separately: archiving rewrites input.sources[*].path later.
  const originals = new Map<string, EvidenceInput["sources"][number]>();
  const sourceOrder = new Map<string, number>();
  for (const [position, source] of input.sources.entries()) {
    if (originals.has(source.id)) throw new Error(`Duplicate source ID: ${source.id}`);
    originals.set(
      source.id,
      structuredClone({ ...source, path: path.resolve(path.dirname(file), source.path) }),
    );
    sourceOrder.set(source.id, position);
  }
  const readSource = async (id: string): Promise<Buffer> => {
    const source = originals.get(id);
    if (!source) throw new Error(`Missing source: ${id}`);
    return readEvidenceSource(source, path.dirname(file));
  };
  const companySources = new Map<string, Set<string>>(),
    sessionSources = new Set<string>();
  const dependencies = new Map<string, string[]>();
  const listingPages: Array<ReturnType<typeof parseCnListingPage>> = [];
  const listingSources = input.sources.filter(
    (s) => s.mapping === "sse-list" || s.mapping === "szse-list" || s.mapping === "bse-list",
  );
  const indexEntities = (id: string, entities: unknown[]) => {
    for (const entity of new Set(entities))
      if (typeof entity === "string") {
        const ids = companySources.get(entity) ?? new Set<string>();
        ids.add(id);
        companySources.set(entity, ids);
      }
  };
  // Keep only identities and dependency IDs between companies, not decoded documents or bytes.
  const indexSource = async (source: EvidenceInput["sources"][number]) => {
    if (source.mapping === "regulatory-reference-v1") return;
    if (source.mediaType === "application/pdf") {
      dependencies.set(source.id, [
        ...(source.disclosure ? [source.disclosure.sourceId] : []),
        ...(source.disclosure?.issuer ? [source.disclosure.issuer.sourceId] : []),
      ]);
      return;
    }
    const body = decodeCnListingDocument(
      (await readSource(source.id)).toString("utf8"),
      source.mapping,
    ) as Record<string, unknown>;
    let entities: unknown[] = [];
    if (
      [
        "income",
        "balance",
        "cashflow",
        "indicators",
        "recent-financials",
        "company-profile",
        "share-structure",
      ].includes(source.mapping ?? "")
    ) {
      const statement = body as {
        data?: Array<{ SECURITY_CODE?: string }>;
        result?: { data?: Array<{ SECURITY_CODE?: string }> };
      };
      entities = (statement?.data ?? statement?.result?.data ?? []).map((r) => r.SECURITY_CODE);
    } else if (source.mapping === "reviewed-scope-v1") {
      const review = reviewSchema.parse(body);
      entities = [review.entity];
      dependencies.set(source.id, [
        ...new Set(review.assertions.flatMap((a) => a.evidence.map((e) => e.sourceId))),
      ]);
    } else if (source.mapping === "eastmoney-session" || source.mapping === "tencent-session")
      sessionSources.add(source.id);
    else if (source.mapping === "tencent-daily")
      entities = [new URL(source.url).searchParams.get("param")?.split(",")[0]?.slice(2)];
    else if (source.mapping === "eastmoney-shares" || source.mapping === "eastmoney-daily") {
      const data = body?.data as { f57?: string; code?: string } | undefined;
      entities = [source.mapping === "eastmoney-shares" ? data?.f57 : data?.code];
    }
    if (
      source.mapping === "sse-list" ||
      source.mapping === "szse-list" ||
      source.mapping === "bse-list"
    )
      listingPages.push(parseCnListingPage(body, { ...source, mapping: source.mapping }));
    indexEntities(source.id, entities);
  };
  for (const source of input.sources) await indexSource(source);
  if (
    input.universe ||
    input.selection ||
    listingSources.length ||
    input.companies.some((c) => c.identity)
  ) {
    if (!input.universe) throw new Error("Exchange identities require a declared universe");
    const rebuilt = reconcileCnUniverse(listingPages, input.universe.asOf);
    if (!isDeepStrictEqual(rebuilt.universe, input.universe))
      throw new Error("Universe coverage does not match archived listing pages");
    const identities = new Map(rebuilt.identities.map((c) => [c.ticker, c]));
    const expectedIds = input.selection?.companyIds ?? [...identities.keys()];
    const expectedSet = new Set(expectedIds),
      actualIds = input.companies.map((c) => c.companyId),
      actualSet = new Set(actualIds);
    for (const id of expectedSet)
      if (!identities.has(id))
        throw new Error(`Selected company is absent from exchange universe: ${id}`);
    if (
      expectedSet.size !== expectedIds.length ||
      actualSet.size !== actualIds.length ||
      actualSet.size !== expectedSet.size ||
      [...expectedSet].some((id) => !actualSet.has(id))
    ) {
      throw new Error(
        input.selection
          ? "Selected companies differ from declared selection"
          : "Universe identities were removed or added",
      );
    }
    for (const c of input.companies) {
      const expected = identities.get(c.ticker);
      if (
        !expected ||
        c.market !== "CN" ||
        c.companyId !== c.ticker ||
        c.companyName !== expected.companyName ||
        !isDeepStrictEqual(c.identity, expected.identity)
      )
        throw new Error(`Identity differs from exchange listing: ${c.ticker}`);
      if (Date.parse(c.asOf) < Date.parse(input.universe.asOf))
        throw new Error("Company cutoff precedes frozen universe");
    }
  }
  const validatedPdfs = new Set<string>();
  const hydrate = async (
    id: string,
    documents: Map<string, unknown>,
    visiting = new Set<string>(),
  ): Promise<void> => {
    if (documents.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cyclic source dependency: ${id}`);
    const source = originals.get(id);
    if (!source) throw new Error(`Missing source: ${id}`);
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? [])
      await hydrate(dependency, documents, visiting);
    const bytes = await readSource(id);
    if (source.mediaType === "application/pdf") {
      documents.set(id, await readDisclosurePdf(source, bytes, documents, input.sources));
      validatedPdfs.add(id);
    } else documents.set(id, decodeCnListingDocument(bytes.toString("utf8"), source.mapping));
    visiting.delete(id);
  };
  // The announcement contract identifies the company before PDF extraction. Full
  // identity/contents validation still runs for every PDF, including unused ones.
  for (const source of input.sources.filter((s) => s.mediaType === "application/pdf")) {
    const documents = new Map<string, unknown>();
    for (const dependency of dependencies.get(source.id) ?? [])
      await hydrate(dependency, documents);
    indexEntities(source.id, [disclosureAnnouncement(source, documents, input.sources).entity]);
  }
  /** Rebuild one company with all indexed observations, including contradictions. */
  const normalizeCompany = async (
    company: EvidenceInput["companies"][number],
    documents = new Map<string, unknown>(),
  ) => {
    const c = structuredClone(company);
    const relevantIds = new Set([
      ...(companySources.get(c.companyId) ?? []),
      ...sessionSources,
      ...(c.identity ? [c.identity.sourceId] : []),
    ]);
    const relevantSources = [...relevantIds]
      .sort((a, b) => sourceOrder.get(a)! - sourceOrder.get(b)!)
      .map((id) => originals.get(id)!);
    for (const source of relevantSources) await hydrate(source.id, documents);
    for (const f of c.facts) for (const ref of f.evidence) await hydrate(ref.sourceId, documents);
    const approved = new Map<string, FinancialFact>();
    if (c.identity?.industryLabels.length) {
      const identity = c.identity,
        column = { SSE: "CSRC_CODE_DESC", SZSE: "sshymc", BSE: "xxhyzl" }[identity.exchange];
      const locator = `${identity.locator}/${column}`,
        raw = jsonPointer(documents.get(identity.sourceId), locator);
      if (typeof raw !== "string") throw new Error("Missing verified exchange industry field");
      const id = `${identity.sourceId}:${c.ticker}:industry`;
      approved.set(id, {
        id,
        field: "industryClassification",
        entity: c.companyId,
        year: Number(identity.observedAt.slice(0, 4)),
        period: { start: identity.observedAt, end: identity.observedAt },
        publishedAt: identity.observedAt,
        basis: c.basis,
        unit: "text",
        state: "observed",
        value: identity.industryLabels.join(";"),
        evidence: [{ sourceId: identity.sourceId, locator, raw }],
        reason: "verified_exchange_classification_at_observation",
      });
    }
    const legacyQuoteSources = new Set<string>();
    for (const source of relevantSources) {
      if (legacyQuoteNeedsRequestStart(source)) {
        legacyQuoteSources.add(source.id);
        continue;
      }
      const quoteObservedAt = quoteRebuildObservedAt(source) ?? source.fetchedAt;
      const quoteCutoff =
        Date.parse(quoteObservedAt) < Date.parse(c.asOf) ? quoteObservedAt : c.asOf;
      if (
        source.mapping === "income" ||
        source.mapping === "balance" ||
        source.mapping === "cashflow" ||
        source.mapping === "indicators"
      ) {
        const rows = documents.get(source.id) as {
          data?: Array<{ SECURITY_CODE?: string }>;
          result?: { data?: Array<{ SECURITY_CODE?: string }> };
        };
        if (!(rows.data ?? rows.result?.data ?? []).some((r) => r.SECURITY_CODE === c.companyId))
          continue;
        for (const f of parseCnStatementFacts(documents.get(source.id), {
          sourceId: source.id,
          entity: c.companyId,
          basis: c.basis,
          kind: source.mapping,
          sourceUrl: source.url,
        }))
          approved.set(f.id, f);
      }
      if (source.mapping === "recent-financials") {
        for (const f of parseCnRecentFinancialFacts(documents.get(source.id), {
          sourceId: source.id, entity: c.companyId, basis: c.basis,
        })) approved.set(f.id, f);
      }
      if (source.mapping === "share-structure") {
        for (const f of parseCnShareStructureFacts(documents.get(source.id), source.url, {
          sourceId: source.id,
          entity: c.companyId,
          basis: c.basis,
          asOf: c.asOf,
          observedAt: source.fetchedAt,
        }))
          approved.set(f.id, f);
      }
      if (source.mapping === "company-profile") {
        for (const f of parseCnProfileFacts(documents.get(source.id), source, c))
          approved.set(f.id, f);
      }
      if (source.mapping === "cninfo-annual-pdf") {
        const document = documents.get(source.id) as DisclosureText;
        if (document.entity === c.companyId) {
          const year = Number(document.periodEnd.slice(0, 4));
          const annual: FinancialFact = {
            id: `${source.id}:annual-report`,
            field: "annualReportYear",
            entity: c.companyId,
            year,
            period: { start: `${year}-01-01`, end: document.periodEnd },
            publishedAt: document.publishedAt,
            basis: c.basis,
            unit: "year",
            state: "observed",
            value: year,
            evidence: [
              {
                sourceId: source.id,
                locator: `/pages/${document.identityPage!}/text`,
                raw: document.pages[document.identityPage!].text,
              },
            ],
            reason: "annual_report_identity_verified_against_announcement",
          };
          approved.set(annual.id, annual);
          for (const f of parseCnDisclosureFacts(document, { sourceId: source.id, basis: c.basis }))
            approved.set(f.id, f);
        }
      }
      if (source.mapping === "tencent-daily" || source.mapping === "tencent-session") {
        for (const f of parseTencentDailyFacts(documents.get(source.id), source.url, {
          sourceId: source.id,
          entity: c.companyId,
          basis: c.basis,
          asOf: quoteCutoff,
          observedAt: quoteObservedAt,
          kind: source.mapping === "tencent-daily" ? "daily" : "session",
        }))
          approved.set(f.id, f);
      }
      if (
        source.mapping === "eastmoney-daily" ||
        source.mapping === "eastmoney-shares" ||
        source.mapping === "eastmoney-session"
      ) {
        const url = new URL(source.url),
          shares = source.mapping === "eastmoney-shares";
        if (
          shares
            ? !["push2.eastmoney.com", "push2delay.eastmoney.com"].includes(url.hostname) ||
              url.pathname !== "/api/qt/stock/get"
            : url.hostname !== "push2his.eastmoney.com" ||
              url.pathname !== "/api/qt/stock/kline/get" ||
              url.searchParams.get("klt") !== "101" ||
              url.searchParams.get("fqt") !== "0"
        )
          throw new Error("Quote source requires a supported unadjusted daily/share contract");
        const body = documents.get(source.id) as {
          data?: { code?: string; market?: number; f57?: string };
        };
        if (
          source.mapping !== "eastmoney-session" &&
          (shares ? body.data?.f57 : body.data?.code) !== c.companyId
        )
          continue;
        const kind = shares
          ? "shares"
          : source.mapping === "eastmoney-session"
            ? "session"
            : "daily";
        const code = shares ? body.data?.f57 : body.data?.code;
        if (url.searchParams.get("secid")?.split(".")[1] !== code)
          throw new Error("Quote request/response identity mismatch");
        for (const f of parseCnPriceFacts(body, {
          sourceId: source.id,
          entity: c.companyId,
          basis: c.basis,
          asOf: quoteCutoff,
          observedAt: quoteObservedAt,
          kind,
        }))
          approved.set(f.id, f);
      }
    }
    const brokerAdditions = applyBrokerRegulatoryReference(
      c,
      approved,
      await loadBrokerRegulatoryReference(),
    );
    if (brokerAdditions.length) {
      const brokerReference = await ensureBrokerRegulatoryReferenceSource(input);
      if (!originals.has(brokerReference.id)) await registerSource(brokerReference);
      await hydrate(brokerRegulatoryReferenceSourceId, documents);
      for (const fact of brokerAdditions) approved.set(fact.id, fact);
    }
    // Check all parsed disclosures, including rows the caller did not select as facts.
    const disclosures = [...approved.values()].filter(
      (f) =>
        !["price", "ordinaryShares"].includes(f.field) &&
        !f.field.startsWith("quote.") &&
        !f.field.startsWith("recent.") &&
        !f.field.startsWith("scope."),
    );
    c.latestFiscalYear = latestDisclosedFiscalYear(c, disclosures);
    for (const source of relevantSources.filter((s) => s.mapping === "reviewed-scope-v1")) {
      for (const f of reviewedScopeFacts(
        documents.get(source.id),
        source.id,
        c,
        documents,
        input.sources,
        disclosures,
      ))
        approved.set(f.id, f);
    }
    const ids = new Set<string>();
    for (const f of c.facts) {
      if (ids.has(f.id)) throw new Error(`Duplicate fact ID: ${f.id}`);
      ids.add(f.id);
      if (new Date(f.period.start) > new Date(f.period.end))
        throw new Error(`Invalid fact period: ${f.id}`);
      const contract = approved.get(f.id);
      if (contract && f.state !== contract.state)
        throw new Error(`Fact contract mismatch (state): ${f.id}`);
      if (
        f.state === "observed" &&
        ["price", "scope.lastCompletedTradingDay"].includes(f.field) &&
        f.evidence.some((e) => legacyQuoteSources.has(e.sourceId))
      ) {
        f.state = "missing";
        delete f.value;
        f.reason = "legacy_quote_request_start_missing";
        continue;
      }
      if (f.state === "observed") {
        // A supported context can join a contiguous scope paragraph and its table. Numeric observations remain singular.
        const multiPageContext =
          !!contract &&
          [
            "quote.shareStructure",
            "quote.shareHistory",
            "regulatory.context",
            "business.profile",
            "business.segments",
            "insurance.context",
            "earnings.returnContext",
            "earnings.restatementContext",
            "business.licensedMethod",
            "business.licenseNumber",
            "business.trustAssetSeparation",
          ].includes(contract.field) &&
          contract.unit === "text";
        if (!f.evidence.length || (!multiPageContext && f.evidence.length !== 1))
          throw new Error(`Observed fact needs one primary observation: ${f.id}`);
        for (const e of f.evidence) {
          if (!documents.has(e.sourceId)) throw new Error(`Missing source: ${e.sourceId}`);
          if (
            JSON.stringify(jsonPointer(documents.get(e.sourceId), e.locator)) !==
            JSON.stringify(e.raw)
          )
            throw new Error(`Source locator/value mismatch: ${f.id}`);
        }
        const raw = jsonPointer(documents.get(f.evidence[0].sourceId), f.evidence[0].locator);
        if (
          f.value === undefined ||
          (!contract && normalized(raw, f.unit, f.unitScale) !== f.value)
        )
          throw new Error(`Normalized value mismatch: ${f.id}`);
        if (contract) {
          for (const key of [
            "field",
            "entity",
            "year",
            "period",
            "publishedAt",
            "basis",
            "unit",
            "unitScale",
            "state",
            "value",
            "evidence",
          ] as const) {
            if (JSON.stringify(contract[key]) !== JSON.stringify(f[key]))
              throw new Error(`Fact contract mismatch (${key}): ${f.id}`);
          }
        } else {
          f.state = "missing";
          delete f.value;
          f.reason = "unverified_field_or_scope_contract";
        }
      } else if (f.state === "derived") {
        // Calculations belong in the shared evaluator, not an unverified imported assertion.
        throw new Error(`Unverified derived fact: ${f.id}; import its source operands`);
      } else if (f.value !== undefined) throw new Error(`Unavailable fact carries value: ${f.id}`);
    }
    // The selected facts list is not an allowlist for suppressing contradictory observations.
    for (const f of approved.values()) if (!ids.has(f.id)) c.facts.push(fact.parse(f));
    const ncavIssues = c.facts.filter(
      (f) =>
        f.field === "scope.ncav" &&
        f.state === "observed" &&
        f.entity === c.companyId &&
        f.basis === c.basis &&
        Date.parse(f.publishedAt) <= Date.parse(c.asOf),
    );
    if (ncavIssues.length)
      c.checks.ncav = {
        state: ncavIssues.every((f) => f.value === "applies")
          ? "applies"
          : ncavIssues.every((f) => f.value === "not_applicable")
            ? "not_applicable"
            : "unresolved",
        evidence: ncavIssues.map((f) => f.id),
      };
    for (const [key, proof] of [["method", c.method], ...Object.entries(c.checks)] as const) {
      // Coverage is reconstructed from the approved records, never the caller's assertion.
      delete proof.coverage;
      const expected = key === "method" ? c.method.value : proof.state;
      const allEvidence = c.facts.filter(
        (f) =>
          f.field === `scope.${key}` &&
          f.state === "observed" &&
          f.entity === c.companyId &&
          f.basis === c.basis &&
          new Date(f.publishedAt) <= new Date(c.asOf),
      );
      if (new Set(allEvidence.map((f) => f.value)).size > 1) {
        proof.state = "unresolved";
        proof.reason = "conflicting_scope_evidence";
        proof.evidence = allEvidence.map((f) => f.id);
        continue;
      }
      const valid =
        proof.evidence.length > 0 &&
        proof.evidence.every((id) => {
          const f = c.facts.find((f) => f.id === id);
          return (
            f?.state === "observed" &&
            f.field === `scope.${key}` &&
            f.value === expected &&
            f.entity === c.companyId &&
            new Date(f.publishedAt) <= new Date(c.asOf)
          );
        });
      if (proof.state !== "unresolved" && !valid) {
        proof.state = "unresolved";
        proof.reason = "scope_contract_unverified";
      }
      if (valid) {
        const periods = proof.evidence.map((id) => c.facts.find((f) => f.id === id)!.period);
        const start = periods
            .map((p) => p.start)
            .sort()
            .at(-1)!,
          end = periods.map((p) => p.end).sort()[0];
        if (start <= end) proof.coverage = { start, end };
      }
    }
    resolveStatementMethod(c);
    // Trading-session assertions are scope facts too; two identical date strings are not evidence.
    const quoteScopeVerified = c.checks.quote?.state === "applies";
    const currentSessionSources = new Set(
      relevantSources
        .filter(
          (s) =>
            s.mapping === "reviewed-scope-v1" ||
            (s.requestStartedAt !== undefined &&
              cnSessionObservationCurrent(s.requestStartedAt, c.asOf)),
        )
        .map((s) => s.id),
    );
    const sessions = c.facts.filter(
      (f) =>
        f.field === "scope.lastCompletedTradingDay" &&
        f.state === "observed" &&
        f.evidence.every((e) => currentSessionSources.has(e.sourceId)),
    );
    const days = [...new Set(sessions.map((f) => f.value))];
    if (days.length === 1 && typeof days[0] === "string") c.lastCompletedTradingDay = days[0];
    else {
      c.lastCompletedTradingDay = undefined;
      if (c.checks.quote && !quoteScopeVerified) {
        c.checks.quote.state = "unresolved";
        c.checks.quote.reason = "trading_session_unverified";
      }
    }
    if (legacyQuoteSources.size && days.length !== 1 && !quoteScopeVerified)
      c.checks.quote = {
        state: "unresolved",
        evidence: [],
        reason: "legacy_quote_request_start_missing",
      };
    const prices = c.facts.filter(
      (f) =>
        f.field === "price" &&
        f.state === "observed" &&
        new Date(f.publishedAt) <= new Date(c.asOf),
    );
    c.quoteDate = prices
      .map((f) => f.period.end)
      .sort()
      .at(-1);
    return c;
  };
  /** Register a newly archived source; its path must already be absolute. */
  const registerSource = async (source: EvidenceInput["sources"][number]) => {
    if (originals.has(source.id)) throw new Error(`Duplicate source ID: ${source.id}`);
    if (!path.isAbsolute(source.path)) throw new Error("Registered source path must be absolute");
    sourceOrder.set(source.id, originals.size);
    originals.set(source.id, structuredClone(source));
    await indexSource(source);
    if (source.mediaType === "application/pdf") {
      const documents = new Map<string, unknown>();
      for (const dependency of dependencies.get(source.id) ?? [])
        await hydrate(dependency, documents);
      indexEntities(source.id, [disclosureAnnouncement(source, documents, input.sources).entity]);
    }
  };
  const companies = async function* (): AsyncGenerator<EvidenceInput["companies"][number]> {
    for await (const c of readEvidenceCompanies(file, metadata)) yield await normalizeCompany(c);
    for (const source of input.sources)
      if (source.mediaType === "application/pdf" && !validatedPdfs.has(source.id))
        await hydrate(source.id, new Map());
  };
  return { input, readSource, companies, normalizeCompany, registerSource };
}

/** Compatibility adapter for small callers; batch execution consumes openEvidenceInput directly. */
export async function loadEvidenceInput(
  file: string,
): Promise<{ input: EvidenceInput; readSource: (id: string) => Promise<Buffer> }> {
  const opened = await openEvidenceInput(file),
    companies: EvidenceInput["companies"] = [];
  for await (const c of opened.companies()) companies.push(c);
  opened.input.companies = companies;
  return { input: opened.input, readSource: opened.readSource };
}

/** Current business observation; it does not prove a historic licence or regulatory scope. */
export function parseCnProfileFacts(
  raw: unknown,
  source: EvidenceInput["sources"][number],
  c: Pick<CompanyFacts, "companyId" | "basis" | "asOf">,
): FinancialFact[] {
  const url = new URL(source.url);
  if (
    url.hostname !== "datacenter-web.eastmoney.com" ||
    url.pathname !== "/api/data/v1/get" ||
    url.searchParams.get("reportName") !== "RPT_F10_BASIC_ORGINFO"
  )
    throw new Error("Unsupported company profile contract");
  const body = z
    .object({
      success: z.literal(true),
      result: z.object({
        data: z
          .array(
            z.object({
              SECURITY_CODE: z.string(),
              SECUCODE: z.string(),
              BUSINESS_SCOPE: z.string().nullable(),
              MAIN_BUSINESS: z.string().nullable(),
              INDUSTRYCSRC1: z.string().nullable(),
            }),
          )
          .length(1),
      }),
    })
    .parse(raw);
  const row = body.result.data[0];
  if (
    row.SECURITY_CODE !== c.companyId ||
    !new RegExp(`^${c.companyId}\\.(SH|SZ|BJ)$`).test(row.SECUCODE)
  )
    throw new Error("Company profile entity mismatch");
  if (Date.parse(source.fetchedAt) > Date.parse(c.asOf)) return [];
  return [
    {
      id: `${source.id}:business.profile`,
      field: "business.profile",
      entity: c.companyId,
      basis: c.basis,
      year: Number(source.fetchedAt.slice(0, 4)),
      period: { start: source.fetchedAt, end: source.fetchedAt },
      publishedAt: source.fetchedAt,
      unit: "text",
      state: "observed",
      value: JSON.stringify({
        scope: row.BUSINESS_SCOPE,
        mainBusiness: row.MAIN_BUSINESS,
        industry: row.INDUSTRYCSRC1,
      }),
      evidence: [
        "SECURITY_CODE",
        "SECUCODE",
        "BUSINESS_SCOPE",
        "MAIN_BUSINESS",
        "INDUSTRYCSRC1",
      ].map((key) => ({
        sourceId: source.id,
        locator: `/result/data/0/${key}`,
        raw: row[key as keyof typeof row],
      })),
      reason: "eastmoney_current_business_profile;historical_effective_date_not_reported",
    },
  ];
}
function observedProfileMethods(
  c: CompanyFacts,
  latestPublication: string,
): {
  methods: string[];
  evidence: string[];
  investmentActivity: boolean;
  investmentOnly: boolean;
  ordinaryOperations: boolean;
  materialFinancialConflict: boolean;
} {
  const profiles = c.facts.filter(
    (f) =>
      f.field === "business.profile" &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      f.publishedAt >= latestPublication &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const methods = profiles.map((f) => {
    try {
      const v = JSON.parse(String(f.value)),
        scope = String(v.scope ?? "")
          .replace(/\s/g, "")
          .replace(/[（(][一二三四五六七八九十]+[)）]/g, ""),
        mainBusiness = String(v.mainBusiness ?? "")
          .replace(/\s/g, "")
          .replace(/[（(][一二三四五六七八九十]+[)）]/g, ""),
        industry = String(v.industry ?? "");
      // Match the issuer's registered activities, not incidental mentions or its name.
      const bankingText = `${scope};${mainBusiness}`;
      const bank =
        industry === "金融业-货币金融服务" &&
        ((/(?:^|[;；:：])吸收(?:人民币|本外币)?(?:公众)?存款(?:[;；,，。]|$)/.test(bankingText) &&
          /(?:^|[;；:：])发放[^;；。]{0,40}贷款/.test(bankingText)) ||
          /(?:^|[;；:：])办理(?:人民币|本外币)?(?:存款|存、贷、结算(?:、汇兑)?)(?:业务)?(?:[;；,，。]|$)/.test(
            bankingText,
          ) ||
          /(?:^|[;；:：])(?:商业)?银行业务(?:[;；,，。]|$)/.test(bankingText) ||
          /提供银行及相关金融服务/.test(mainBusiness));
      const broker =
        /(?:^|[;；:：])证券业务(?:[（(;；,，。]|$)/.test(scope) ||
        (/(?:^|[;；:：])证券经纪(?:[;；,，。]|$)/.test(scope) &&
          /(?:^|[;；:：])证券承销/.test(scope));
      const lease = /(?:^|[;；:：])金融租赁服务(?:[（(;；,，。]|$)/.test(scope);
      // A current profile can route a direct insurer only when its registered
      // activities name an unambiguous product family. Reinsurance, advisory,
      // and agency services are permitted ancillary activities and do not turn
      // a direct insurer into a group; an agent alone never selects insurance.
      const activities = scope
        .split(/[;；]/)
        .map((activity) => activity.replace(/^(?:许可|一般)项目[:：]?/, "").trim());
      // The direct-underwriting activity must lead its own registered clause.
      // This rejects an agent merely authorised to sell life products, while a
      // direct life insurer may still list agency and reinsurance separately.
      const life =
        industry === "金融业-保险业" &&
        activities.some(
          (activity) =>
            /^(?:(?:人民币|外币)(?:[、,，](?:人民币|外币))*的?)?(?:人寿保险|人身保险)/.test(
              activity,
            ) &&
            /健康保险/.test(activity) &&
            /意外伤害保险/.test(activity) &&
            !/财产保险|责任保险|信用保险|保证保险|机动车保险/.test(activity),
        );
      const pc =
        industry === "金融业-保险业" &&
        activities.some(
          (activity) =>
            /^财产保险/.test(activity) &&
            /(?:责任保险|信用保险|保证保险|机动车保险|农业保险)/.test(activity) &&
            !/(?:人寿保险|人身保险|健康保险|意外伤害保险)/.test(activity),
        );
      // An insurance holding business is a route, not proof of regulated group
      // capital. Require both ownership and management clauses from the issuer.
      const insuranceGroup =
        industry === "金融业-保险业" &&
        activities.some((a) => /^(?:控股)?投资保险企业$/.test(a)) &&
        activities.some((a) => /^监督管理控股投资(?:保险)?企业的/.test(a));
      // A direct futures/trust issuer leads a registered-activity clause with
      // the core licensed activities.  This excludes advisory, agency, and a
      // subsidiary's activities without treating normal asset management or
      // risk-management affiliates as an issuer-wide audit requirement.
      const hasActivity = (activity: string, name: string) =>
        new RegExp(`(?:^|[、，,])${name}(?:[、，,]|$)`).test(activity);
      const futures =
        industry === "金融业-资本市场服务" &&
        ["金融期货经纪", "商品期货经纪"].every((name) =>
          activities.some((activity) => hasActivity(activity, name)),
        );
      const trust =
        industry === "金融业-其他金融业" &&
        ["资金信托", "动产信托", "不动产信托"].every((name) =>
          activities.some((activity) => hasActivity(activity, name)),
        );
      const candidates = [
        ...(bank ? ["bank"] : []),
        ...(broker && industry === "金融业-资本市场服务" ? ["broker"] : []),
        ...(lease && industry === "金融业-货币金融服务" ? ["financial_lease"] : []),
        ...(life ? ["life_insurance"] : []),
        ...(pc ? ["pc_insurance"] : []),
        ...(insuranceGroup ? ["insurance_group"] : []),
        // A broker may also offer futures brokerage; that ancillary activity is not a second issuer method.
        ...(futures && !broker ? ["futures"] : []),
        ...(trust ? ["trust"] : []),
      ];
      return candidates.length === 1 ? candidates[0] : "unresolved";
    } catch {
      return "unresolved";
    }
  });
  const investmentDescriptions = profiles.map((f) => {
    try {
      return String(JSON.parse(String(f.value)).mainBusiness ?? "").replace(/\s/g, "");
    } catch {
      return "";
    }
  });
  const investment = "(?:金融投资|自营(?:投资|交易)|自有(?:资金|资产)(?:投资|交易)|金融控股)";
  const investmentActivity = investmentDescriptions.some((main) =>
    new RegExp(investment).test(main),
  );
  // Only a complete, unambiguous description of investment operations supplies
  // contrary primary-business evidence. A mixed list merely mentions a business.
  const onlyInvestment = new RegExp(
    `^(?:(?:本公司|本集团|公司)?(?:主要从事|主营业务为|主营业务是|主要业务为|主要业务是))?(?:以)?${investment}(?:业务)?(?:[、，,及和]${investment}(?:业务)?)*(?:为主)?[。.]?$`,
  );
  const investmentOnly = investmentDescriptions.some((main) => onlyInvestment.test(main));
  const materialFinancialConflict = profiles.some((f) => {
    try {
      const main = String(JSON.parse(String(f.value)).mainBusiness ?? "").replace(/\s/g, "");
      return /小额贷款|发放[^；;。]{0,40}贷款|金融控股|自营(?:投资|交易)|信用资产处置|金融投资[^。；;]{0,24}核心|核心[^。；;]{0,24}金融投资/.test(
        main,
      );
    } catch {
      return true;
    }
  });
  const ordinaryOperations =
    !materialFinancialConflict &&
    profiles.some((f) => {
      try {
        const v = JSON.parse(String(f.value)),
          industry = String(v.industry ?? ""),
          levels = industry.split("-").map((x) => x.trim()),
          leaf = levels.at(-1) ?? "",
          scope = String(v.scope ?? "").replace(/\s/g, ""),
          main = String(v.mainBusiness ?? "").replace(/\s/g, ""),
          text = `${scope}${main}`;
        // These are fine structured industry categories plus their named
        // operating activity. They are not name- or ticker-based exceptions.
        return (
          (industry.endsWith("-燃气生产和供应业") && /(?:管道)?天然气|城市燃气/.test(text)) ||
          (industry.endsWith("-畜牧业") && /(?:生猪|肉鸡|畜禽|水产)?养殖/.test(text)) ||
          (levels.length >= 2 &&
            levels.every(Boolean) &&
            !/^(?:金融业|综合)$/.test(levels[0]) &&
            leaf !== "综合" &&
            !/金融|银行|保险|证券|期货|信托/.test(leaf) &&
            /研发|开发|生产|制造|销售|运营|经营|管理|建设|施工|加工|供应链|贸易|发电|运输|服务/.test(
              scope,
            ) &&
            /研发|开发|生产|制造|销售|运营|经营|管理|供应链|贸易|发电|运输|服务|医药|纺织|印染/.test(
              main,
            ))
        );
      } catch {
        return false;
      }
    });
  return {
    methods: [...new Set(methods)],
    evidence: profiles.map((f) => f.id),
    investmentActivity,
    investmentOnly,
    ordinaryOperations,
    materialFinancialConflict,
  };
}

// CSRC JR/T 0020—2024, manufacturing categories C13–C43. Exact category names,
// including those without a 制造业 suffix, never company names or ticker overrides.
const manufacturingIndustryCategories = new Set([
  "农副食品加工业",
  "食品制造业",
  "酒、饮料和精制茶制造业",
  "烟草制品业",
  "纺织业",
  "纺织服装、服饰业",
  "皮革、毛皮、羽毛及其制品和制鞋业",
  "木材加工和木、竹、藤、棕、草制品业",
  "家具制造业",
  "造纸和纸制品业",
  "印刷和记录媒介复制业",
  "文教、工美、体育和娱乐用品制造业",
  "石油、煤炭及其他燃料加工业",
  "化学原料和化学制品制造业",
  "医药制造业",
  "化学纤维制造业",
  "橡胶和塑料制品业",
  "非金属矿物制品业",
  "黑色金属冶炼和压延加工业",
  "有色金属冶炼和压延加工业",
  "金属制品业",
  "通用设备制造业",
  "专用设备制造业",
  "汽车制造业",
  "铁路、船舶、航空航天和其他运输设备制造业",
  "电气机械和器材制造业",
  "计算机、通信和其他电子设备制造业",
  "仪器仪表制造业",
  "其他制造业",
  "废弃资源综合利用业",
  "金属制品、机械和设备修理业",
]);

// These are business classifications, not issuer exceptions.  A broad sector is
// deliberately absent unless its label itself identifies the policy's business
// exposure.  In particular, agriculture, electronics, and transport need a
// finer verified label before they select either cycle branch.
const cyclicalIndustryCategories = new Set([
  "煤炭开采和洗选业",
  "石油和天然气开采业",
  "黑色金属矿采选业",
  "有色金属矿采选业",
  "非金属矿采选业",
  "黑色金属冶炼和压延加工业",
  "有色金属冶炼和压延加工业",
  "石油、煤炭及其他燃料加工业",
  "化学原料和化学制品制造业",
  "化学纤维制造业",
  "非金属矿物制品业",
  "房地产开发经营",
  "房地产开发",
]);
const noncyclicalIndustryCategories = new Set([
  "农副食品加工业",
  "食品制造业",
  "酒、饮料和精制茶制造业",
  "烟草制品业",
  "纺织业",
  "纺织服装、服饰业",
  "皮革、毛皮、羽毛及其制品和制鞋业",
  "木材加工和木、竹、藤、棕、草制品业",
  "家具制造业",
  "印刷和记录媒介复制业",
  "文教、工美、体育和娱乐用品制造业",
  "医药制造业",
  "橡胶和塑料制品业",
  "金属制品业",
  "通用设备制造业",
  "专用设备制造业",
  "汽车制造业",
  "铁路、船舶、航空航天和其他运输设备制造业",
  "仪器仪表制造业",
  "其他制造业",
  "废弃资源综合利用业",
  "金属制品、机械和设备修理业",
  "软件和信息技术服务业",
  "专业技术服务业",
  "零售业",
  "批发业",
  "燃气生产和供应业",
  "生态保护和环境治理业",
  "多式联运和运输代理业",
  "公共设施管理业",
]);
// These labels describe equipment classes, not necessarily the product made by
// the issuer.  A verified main-business product may refine them.
const broadEquipmentIndustryCategories = new Set(["通用设备制造业", "专用设备制造业"]);
type CycleApplicability = "applies" | "not_applicable";
type CycleMapping = {
  value: CycleApplicability | undefined;
  id: string;
  kind: "exchange" | "industry" | "product";
  label?: string;
};
const principalFinancialActivity =
  /金融投资|自营|贷款|信贷|融资租赁|金融租赁|资产管理|资管|信托业务|承保/;
function cycleLabelApplicability(label: string): CycleApplicability | undefined {
  const normalized = label.replace(/^[A-Z]\s+/, "").trim();
  if (cyclicalIndustryCategories.has(normalized)) return "applies";
  if (noncyclicalIndustryCategories.has(normalized)) return "not_applicable";
  return undefined;
}
function cycleProfileApplicability(value: unknown): {
  industry?: CycleApplicability;
  industryLabel?: string;
  product?: CycleApplicability;
  feeInformation?: boolean;
} {
  try {
    const profile = JSON.parse(String(value)),
      text =
        typeof profile.mainBusiness === "string" ? profile.mainBusiness.replace(/\s/g, "") : "";
    // The provider's industry value is hierarchical. Only a nonempty, explicitly
    // delimited leaf is eligible for the same fixed fine-label mapping used for
    // exchange classifications; unknown leaves remain unresolved.
    const levels =
      typeof profile.industry === "string"
        ? profile.industry.split("-").map((level: string) => level.trim())
        : [];
    const industryLabel = levels.length >= 2 && levels.every(Boolean) ? levels.at(-1) : undefined;
    const industry =
      industryLabel === undefined ? undefined : cycleLabelApplicability(industryLabel);
    const scope = typeof profile.scope === "string" ? profile.scope.replace(/\s/g, "") : "";
    // Financial information is an operating service, not a principal credit or
    // trading business. Require both the main activity and registered services;
    // merely naming financial customers or an incidental software activity fails.
    const feeInformation =
      /金融信息服务/.test(text) &&
      /提供商|服务提供|平台/.test(text) &&
      /信息服务|软件|技术服务/.test(scope) &&
      !principalFinancialActivity.test(text) &&
      !/证券业务|证券经纪|发放[^;；。]{0,40}贷款|吸收[^;；。]{0,20}公众存款|受托资产管理|资金信托|支付业务/.test(
        scope,
      );
    const ordinaryProduct =
      feeInformation ||
      (industryLabel === "电气机械和器材制造业" &&
        /墙壁开关插座|电源连接/.test(text) &&
        /转换器|插座/.test(text) &&
        /研发|生产|制造|销售/.test(text)) ||
      (industryLabel === "造纸和纸制品业" &&
        /一次性个人卫生用品|卫生巾|婴儿纸尿裤|成人纸尿裤/.test(text) &&
        /研发|生产|制造/.test(text)) ||
      (industryLabel === "互联网和相关服务" &&
        /网络游戏|手机游戏|移动游戏/.test(text) &&
        /研发|开发|运营/.test(text));
    // Registered scope commonly lists incidental activities.  A current main
    // business can refine an ambiguous exchange class only when it names the
    // exposed product or operation, rather than its equipment or a generic sale.
    const exposedProduct =
      /(?:半导体(?:芯片|器件|材料)|集成电路(?!测试设备)|(?:显示|液晶)面板|光伏(?:组件|电池片)?|太阳能电池片|锂(?:离子)?电池|动力电池)/.test(
        text,
      );
    const exposedOperation = /研发|生产|制造|销售/.test(text);
    const product =
      exposedProduct &&
      exposedOperation &&
      !/(?:半导体|集成电路)(?:测试|检测)?设备|(?:生产|检测)装备|专用仪器/.test(text)
        ? "applies"
        : /生猪养殖|肉鸡养殖|水产养殖|国际海运|干散货运输|房地产开发/.test(text)
          ? "applies"
          : ordinaryProduct
            ? "not_applicable"
            : undefined;
    return { industry, industryLabel, product, feeInformation };
  } catch {
    /* An unparseable profile is not a classification. */
  }
  return {};
}
/** Derive cycle scope from verified fine business evidence, never a caller label. */
function resolveCycleApplicability(c: CompanyFacts): void {
  if (c.market !== "CN" || c.method.state !== "applies" || c.method.value !== "nonfinancial")
    return;
  const classifications = c.facts.filter(
    (f) =>
      f.field === "industryClassification" &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const profiles = c.facts.filter(
    (f) =>
      f.field === "business.profile" &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const classified: CycleMapping[] = classifications.flatMap((f) =>
    String(f.value)
      .split(";")
      .map((label) => ({
        value: cycleLabelApplicability(label),
        id: f.id,
        kind: "exchange" as const,
        label: label.replace(/^[A-Z]\s+/, "").trim(),
      })),
  );
  const profiled: CycleMapping[] = profiles.flatMap((f) => {
    const mapping = cycleProfileApplicability(f.value);
    return [
      ...(mapping.industry === undefined || mapping.industryLabel === undefined
        ? []
        : [
            {
              value: mapping.industry,
              id: f.id,
              kind: "industry" as const,
              label: mapping.industryLabel,
            },
          ]),
      ...(mapping.product === undefined
        ? []
        : [{ value: mapping.product, id: f.id, kind: "product" as const }]),
    ];
  });
  const mapped = [...classified, ...profiled].filter(
    (entry): entry is CycleMapping & { value: CycleApplicability } => entry.value !== undefined,
  );
  const profileProductValues = [
    ...new Set(
      profiled
        .filter(
          (entry): entry is CycleMapping & { value: CycleApplicability } =>
            entry.kind === "product" && entry.value !== undefined,
        )
        .map((entry) => entry.value),
    ),
  ];
  const mappedIndustryLabels = [
    ...classified.filter(
      (entry): entry is CycleMapping & { value: CycleApplicability; label: string } =>
        entry.value !== undefined && entry.label !== undefined,
    ),
    ...profiled.filter(
      (entry): entry is CycleMapping & { value: CycleApplicability; label: string } =>
        entry.kind === "industry" && entry.value !== undefined && entry.label !== undefined,
    ),
  ];
  const broadEquipmentOnly =
    mappedIndustryLabels.length > 0 &&
    mappedIndustryLabels.every(
      (entry) =>
        entry.value === "not_applicable" && broadEquipmentIndustryCategories.has(entry.label),
    );
  // The product named in the verified main business is finer than an equipment
  // class, so it refines that class instead of creating a false conflict.
  const values =
    profileProductValues.length === 1 && broadEquipmentOnly
      ? profileProductValues
      : [...new Set(mapped.map((entry) => entry.value))];
  const reviewed = c.facts.filter(
    (f) =>
      f.field === "scope.cycle" &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf) &&
      f.period.start <= `${c.latestFiscalYear}-12-31` &&
      f.period.end >= `${c.latestFiscalYear}-12-31`,
  );
  const reviewedValues = [
    ...new Set(
      reviewed
        .map((f) => f.value)
        .filter(
          (value): value is CycleApplicability => value === "applies" || value === "not_applicable",
        ),
    ),
  ];
  if (
    values.length > 1 ||
    reviewedValues.length > 1 ||
    (values.length === 1 && reviewedValues.length === 1 && values[0] !== reviewedValues[0])
  ) {
    c.checks.cycle = {
      state: "unresolved",
      evidence: [...mapped.map((entry) => entry.id), ...reviewed.map((f) => f.id)],
      reason: "conflicting_cycle_evidence",
    };
    return;
  }
  const value = values[0] ?? reviewedValues[0];
  if (!value) return;
  const coverage = values.length
    ? { start: `${c.latestFiscalYear}-01-01`, end: `${c.latestFiscalYear}-12-31` }
    : {
        start: reviewed
          .map((f) => f.period.start)
          .sort()
          .at(-1)!,
        end: reviewed.map((f) => f.period.end).sort()[0],
      };
  c.checks.cycle = {
    state: value,
    evidence: [...mapped.map((entry) => entry.id), ...reviewed.map((f) => f.id)],
    coverage,
    reason: values.length ? "verified_fine_business_cycle_mapping" : "reviewed_cycle_scope",
  };
}
/** Classify already source-validated facts; this does not certify group risk scope. */
export function resolveStatementMethod(c: CompanyFacts): void {
  if (c.market !== "CN") return;
  const facts = c.facts.filter(
    (f) =>
      ["statementFamily", "business.licensedMethod", "insurance.context"].includes(f.field) &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      f.year === c.latestFiscalYear &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf) &&
      Date.parse(f.period.end) <= Date.parse(c.asOf),
  );
  const business = c.facts.filter(
    (f) =>
      ["business.breakdown", "business.primaryActivity"].includes(f.field) &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      f.year === c.latestFiscalYear &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf) &&
      Date.parse(f.period.end) <= Date.parse(c.asOf),
  );
  if (!facts.length && !business.length) return;
  const families = [
      ...new Set(facts.filter((f) => f.field === "statementFamily").map((f) => f.value)),
    ],
    evidence = [...facts, ...business].map((f) => f.id);
  if (families.length > 1) {
    c.method = { state: "unresolved", evidence, reason: "conflicting_statement_families" };
    return;
  }
  const family = families[0],
    licenses = [
      ...new Set(facts.filter((f) => f.field === "business.licensedMethod").map((f) => f.value)),
    ];
  const profile = observedProfileMethods(
    c,
    facts
      .filter((f) => f.field === "statementFamily")
      .map((f) => f.publishedAt)
      .sort()
      .at(-1) ?? "",
  );
  const profileMethod =
    profile.methods.length === 1 && profile.methods[0] !== "unresolved"
      ? (profile.methods[0] as
          | "bank"
          | "broker"
          | "financial_lease"
          | "life_insurance"
          | "pc_insurance"
          | "insurance_group"
          | "futures"
          | "trust")
      : undefined;
  const feeInformation =
    profile.evidence.length > 0 &&
    c.facts
      .filter((f) => profile.evidence.includes(f.id))
      .every((f) => cycleProfileApplicability(f.value).feeInformation === true);
  evidence.push(...profile.evidence);
  if (profile.methods.length > 1) {
    c.method = { state: "unresolved", evidence, reason: "conflicting_business_profiles" };
    return;
  }
  const profileFamilies =
    profileMethod === "broker"
      ? ["证券"]
      : profileMethod === "futures"
        ? ["通用", "证券"]
        : profileMethod === "trust"
          ? ["通用", "银行"]
          : ["life_insurance", "pc_insurance", "insurance_group"].includes(profileMethod ?? "")
            ? ["保险"]
            : ["银行"];
  if (
    profileMethod &&
    (licenses.some((value) => value !== profileMethod) ||
      (family !== undefined && !profileFamilies.includes(String(family))))
  ) {
    c.method = { state: "unresolved", evidence, reason: "conflicting_business_methods" };
    return;
  }
  const insurance = facts
    .filter((f) => f.field === "insurance.context")
    .flatMap((f) => {
      try {
        const parsed = insuranceContextSchema.safeParse(JSON.parse(String(f.value)));
        return parsed.success &&
          parsed.data.subject === c.companyId &&
          parsed.data.scope === "group" &&
          parsed.data.kind === "group" &&
          parsed.data.reportYear === c.latestFiscalYear
          ? [f]
          : [];
      } catch {
        return [];
      }
    });
  const primary = business.filter((f) => f.field === "business.primaryActivity");
  const primaryOrdinaryOperations =
    primary.length > 0 &&
    primary.every((f) => {
      try {
        const activity = JSON.parse(String(f.value));
        return (
          ["issuer", "group"].includes(activity.scope) &&
          typeof activity.description === "string" &&
          ((feeInformation &&
            /金融信息服务/.test(activity.description) &&
            !principalFinancialActivity.test(activity.description)) ||
            (/研发|开发|设计|生产|制造|销售|零售|批发|供水|供电|安装|运输|物流|软件服务/.test(
              activity.description,
            ) &&
              !/金融|银行|保险|证券|期货|信托|投资|融资|租赁|资管|资产管理|资产处置|担保|保理|基金|贷款|信用|交易|支付/.test(
                activity.description,
              )))
        );
      } catch {
        return false;
      }
    });
  const primaryMaterialFinancial = primary.some((f) => {
    try {
      return principalFinancialActivity.test(String(JSON.parse(String(f.value)).description ?? ""));
    } catch {
      return true;
    }
  });
  const ordinaryOperations =
    primaryOrdinaryOperations || (family === "通用" && profile.ordinaryOperations);
  const licensed = ["financial_lease", "bank", "futures", "trust", "broker"].includes(
    String(licenses[0]),
  )
    ? (licenses[0] as "financial_lease" | "bank" | "futures" | "trust" | "broker")
    : undefined;
  const compatibleFamily =
    licensed === "futures" || licensed === "broker" ? ["通用", "证券"] : ["通用", "银行"];
  // Investment mentions alone do not displace verified ordinary primary
  // operations. Without representative evidence the method remains unresolved;
  // an explicitly investment-only profile still conflicts with ordinary scope.
  if (
    (primaryMaterialFinancial || (profile.materialFinancialConflict && !profile.investmentOnly)) &&
    !licensed &&
    !profileMethod &&
    !insurance.length
  ) {
    c.method = { state: "unresolved", evidence, reason: "conflicting_primary_business_evidence" };
    return;
  }
  if (
    family === "通用" &&
    profile.investmentActivity &&
    (!ordinaryOperations || profile.investmentOnly) &&
    !licensed &&
    !profileMethod &&
    !insurance.length
  ) {
    c.method = {
      state: "unresolved",
      evidence,
      reason: profile.investmentOnly
        ? ordinaryOperations
          ? "conflicting_primary_business_evidence"
          : "reported_investment_operations_require_specific_method"
        : "reported_investment_activity_primary_method_unresolved",
    };
    return;
  }
  if (
    (insurance.length &&
      (licenses.length > 0 ||
        (profileMethod !== undefined && profileMethod !== "insurance_group") ||
        (family !== undefined && family !== "保险"))) ||
    licenses.length > 1 ||
    (licensed && family !== undefined && !compatibleFamily.includes(String(family)))
  ) {
    c.method = { state: "unresolved", evidence, reason: "conflicting_business_methods" };
    return;
  }
  if (
    ordinaryOperations &&
    (licensed || insurance.length || (family !== undefined && family !== "通用"))
  ) {
    c.method = { state: "unresolved", evidence, reason: "conflicting_business_methods" };
    return;
  }
  if (primary.length && !ordinaryOperations && !licensed && !insurance.length && !profileMethod) {
    c.method = {
      state: "unresolved",
      evidence,
      reason: "primary_activity_requires_specific_business_method",
    };
    return;
  }
  // Exchange classifications plus ordinary statements support an initial
  // nonfinancial route; business/license contradictions above take precedence.
  const classifications = c.facts.filter(
    (f) =>
      f.field === "industryClassification" &&
      f.state === "observed" &&
      f.entity === c.companyId &&
      f.basis === c.basis &&
      Date.parse(f.publishedAt) <= Date.parse(c.asOf),
  );
  const classifiedOrdinary =
    family === "通用" &&
    !primary.length &&
    classifications.length > 0 &&
    classifications.every((f) =>
      String(f.value)
        .split(";")
        .every(
          (label) =>
            manufacturingIndustryCategories.has(label) ||
            (!/金融|银行|保险|证券|期货|信托|投资|租赁|综合|资产管理/.test(label) &&
              (cycleLabelApplicability(label) !== undefined ||
                /^(?:[A-I]|[KM-R])\s+/.test(label) ||
                /制造业$/.test(label) ||
                /^(?:软件和信息技术服务业|专业技术服务业|零售业|批发业|开采专业及辅助性活动|农、林、牧、渔专业及辅助性活动|农业|畜牧业|房地产业|燃气生产和供应业|电信、广播电视和卫星传输服务|生态保护和环境治理业|多式联运和运输代理业|公共设施管理业|道路运输业|铁路运输业|航空运输业|水上运输业|管道运输业|装卸搬运和仓储业|土木工程建筑业)$/.test(
                  label,
                ))),
        ),
    );
  if (classifiedOrdinary) evidence.push(...classifications.map((f) => f.id));
  const feeOperations =
    family === "通用" && !primary.length && !profileMethod && !licensed && feeInformation;
  const method =
    licensed ??
    profileMethod ??
    (insurance.length
      ? "insurance_group"
      : ordinaryOperations || classifiedOrdinary || feeOperations
        ? "nonfinancial"
        : undefined);
  if (method) {
    const reviewed = c.facts.filter(
      (f) =>
        f.field === "scope.method" &&
        f.state === "observed" &&
        f.entity === c.companyId &&
        f.basis === c.basis &&
        Date.parse(f.publishedAt) <= Date.parse(c.asOf) &&
        f.period.start <= `${c.latestFiscalYear}-12-31` &&
        f.period.end >= `${c.latestFiscalYear}-12-31`,
    );
    if (reviewed.some((f) => f.value !== method)) {
      c.method = {
        state: "unresolved",
        evidence: [...evidence, ...reviewed.map((f) => f.id)],
        reason: "conflicting_scope_evidence",
      };
      return;
    }
    c.method = {
      state: "applies",
      value: method,
      evidence,
      coverage: { start: `${c.latestFiscalYear}-01-01`, end: `${c.latestFiscalYear}-12-31` },
      reason: licensed
        ? "explicit_issuer_license_and_business_regime"
        : profileMethod
          ? "observed_business_profile_and_annual_statement_family"
          : insurance.length
            ? "explicit_insurance_group_regulatory_disclosure"
            : feeOperations
              ? "reported_fee_information_services"
              : classifiedOrdinary
                ? "exchange_classification_and_ordinary_statements"
                : "reported_primary_operations",
    };
  } else if (c.method.state !== "applies" && c.method.reason !== "conflicting_scope_evidence") {
    c.method = {
      state: "unresolved",
      evidence,
      reason:
        family === "证券"
          ? "broker_or_futures_entity_unresolved"
          : family === "银行"
            ? "bank_or_nonbank_credit_entity_unresolved"
            : family === "保险"
              ? "insurance_business_scope_required"
              : business.length
                ? "group_scope_not_established_by_main_business_table"
                : family === "通用"
                  ? "business_scope_required"
                  : "unknown_statement_family",
    };
  }
  resolveCycleApplicability(c);
}

const reviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    entity: z.string(),
    basis: z.string(),
    asOf: date,
    reviewer: z.string().min(1),
    reviewedAt: date,
    expiresAt: date,
    assertions: z.array(
      z
        .object({
          key: z.union([
            z.enum([
              "method",
              "cycle",
              "cash",
              "ncav",
              "financing",
              "debtLiabilityBound",
              "interest",
              "capital",
              "capitalAdjustments",
              "capitalAssetBound",
              "earnings",
              "quote",
              "lastCompletedTradingDay",
            ]),
            z
              .string()
              .refine(
                (k) =>
                  k.startsWith("financing.") && Object.hasOwn(financingRoleInputs, k.slice(10)),
              ),
          ]),
          value: z.string().min(1),
          coverage: period.optional(),
          components: z.array(z.string()).optional(),
          criteria: z.string().min(1),
          evidence: z
            .array(
              z.object({
                sourceId: z.string(),
                locator: z.string(),
                raw: z.union([z.number(), z.string(), z.boolean(), z.null()]),
              }),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();
/** Explicit, dated external review records are reusable inputs; the CLI never creates them. */
function reviewedScopeFacts(
  raw: unknown,
  sourceId: string,
  c: CompanyFacts,
  documents: Map<string, unknown>,
  sources: EvidenceInput["sources"],
  disclosures: FinancialFact[],
): FinancialFact[] {
  const review = reviewSchema.parse(raw);
  if (
    review.entity !== c.companyId ||
    review.basis !== c.basis ||
    new Date(review.reviewedAt) > new Date(c.asOf) ||
    new Date(review.expiresAt) < new Date(c.asOf)
  )
    return [];
  if (
    new Date(review.asOf) > new Date(c.asOf) ||
    new Date(review.asOf) > new Date(review.reviewedAt)
  )
    return [];
  if (review.asOf.slice(0, 10) < `${c.latestFiscalYear}-12-31`) return [];
  // A review covers the disclosed group at that time. Any later eligible financial
  // revision requires renewal; a new source ID must not hide this dependency.
  if (
    disclosures.some(
      (f) =>
        new Date(f.publishedAt) > new Date(review.reviewedAt) &&
        new Date(f.publishedAt) <= new Date(c.asOf),
    )
  )
    return [];
  if (
    sources
      .filter((s) => s.mapping === "cninfo-annual-pdf")
      .some((s) => {
        const d = documents.get(s.id) as DisclosureText;
        return (
          d?.entity === c.companyId &&
          new Date(d.publishedAt) > new Date(review.reviewedAt) &&
          new Date(d.publishedAt) <= new Date(c.asOf)
        );
      })
  )
    return [];
  return review.assertions.flatMap((a, i) => {
    if (a.coverage && new Date(a.coverage.end) > new Date(review.asOf)) return [];
    const financingRole = a.key.startsWith("financing.") ? a.key.slice(10) : undefined;
    if (financingRole) {
      if (
        !a.coverage ||
        a.coverage.start !== a.coverage.end ||
        !/^\d{4}-12-31$/.test(a.coverage.end)
      )
        throw new Error("Financing classification needs an exact year-end");
      const components = a.components ?? [];
      if (
        (a.value === "absent"
          ? components.length !== 0
          : a.value !== "components" || !components.length) ||
        new Set(components).size !== components.length ||
        components.some((f) => !financingRoleInputs[financingRole].includes(f))
      )
        throw new Error("Invalid financing classification operands");
      if (components.includes("currentNoncurrentLiabilities") && components.length > 1)
        throw new Error("Overlapping current financing total and components");
    } else if (a.components) throw new Error("Scope assertion cannot contain numeric operands");
    if (["quote", "lastCompletedTradingDay"].includes(a.key) && review.asOf !== c.asOf) return [];
    for (const ref of a.evidence) {
      const source = sources.find((s) => s.id === ref.sourceId);
      if (
        !source ||
        source.id === sourceId ||
        source.mapping === "reviewed-scope-v1" ||
        JSON.stringify(jsonPointer(documents.get(source.id), ref.locator)) !==
          JSON.stringify(ref.raw)
      )
        throw new Error(`Review source mismatch: ${sourceId}:${i}`);
      if (source.mapping === "cninfo-annual-pdf") {
        const document = documents.get(source.id) as DisclosureText;
        if (
          !/^\/pages\/\d+\/(text|lines\/\d+)$/.test(ref.locator) ||
          document.entity !== c.companyId ||
          document.publishedAt > review.reviewedAt ||
          document.periodEnd > review.asOf
        )
          return [];
        continue;
      }
      const rowPointer = ref.locator.match(/^(\/(?:result\/)?data\/\d+)\//)?.[1];
      if (!rowPointer) return [];
      const row = jsonPointer(documents.get(source.id), rowPointer) as { SECURITY_CODE?: string };
      const rowFacts = disclosures.filter((f) =>
        f.evidence.some((e) => e.sourceId === source.id && e.locator.startsWith(rowPointer + "/")),
      );
      if (
        row.SECURITY_CODE !== c.companyId ||
        !rowFacts.length ||
        rowFacts.some(
          (f) =>
            new Date(f.publishedAt) > new Date(review.reviewedAt) ||
            new Date(f.period.end) > new Date(review.asOf),
        )
      )
        return [];
    }
    return [
      {
        id: `${sourceId}:${i}`,
        field: financingRole ? `classification.${financingRole}` : `scope.${a.key}`,
        entity: c.companyId,
        year: Number((financingRole ? a.coverage!.end : review.asOf).slice(0, 4)),
        period: a.coverage ?? { start: review.asOf, end: review.asOf },
        publishedAt: review.reviewedAt,
        basis: c.basis,
        unit: "text",
        state: "observed" as const,
        value: financingRole
          ? JSON.stringify({ state: a.value, components: a.components ?? [] })
          : a.value,
        evidence: [{ sourceId, locator: `/assertions/${i}/value`, raw: a.value }],
        reason: `external_review:${review.reviewer}:${a.criteria}`,
      },
    ];
  });
}

/** PDF identity and publication come from its matched announcement, never from a fact assertion. */
export function cnAnnualReportYear(title: string, issuerName?: string): string | undefined {
  let normalized = title.replace(/\s/g, "");
  const issuer = issuerName?.replace(/\s/g, "");
  if (issuer && normalized.startsWith(issuer))
    normalized = normalized
      .slice(issuer.length)
      .replace(/^(?:股份有限公司|有限责任公司|有限公司)?[：:]?/, "");
  return normalized.match(
    /^(20\d{2})年年度报告(?:[（(](?:全文|修订版|修订稿|更正版|更正后|更新后)[）)])?$/,
  )?.[1];
}
function disclosureAnnouncement(
  source: EvidenceInput["sources"][number],
  documents: Map<string, unknown>,
  sources: EvidenceInput["sources"],
) {
  if (source.mapping !== "cninfo-annual-pdf" || !source.disclosure)
    throw new Error(`PDF source needs a supported disclosure contract: ${source.id}`);
  const index = sources.find((s) => s.id === source.disclosure!.sourceId);
  if (
    index?.mapping !== "cninfo-announcements" ||
    !["www.cninfo.com.cn", "cninfo.com.cn"].includes(new URL(index.url).hostname)
  )
    throw new Error(`Unverified announcement index: ${source.id}`);
  const entry = z
    .object({
      secCode: z.string().regex(/^\d{6}$/),
      secName: z.string().optional(),
      orgId: z.string().optional(),
      announcementTitle: z.string(),
      announcementTime: z.number().finite(),
      adjunctUrl: z.string(),
    })
    .parse(jsonPointer(documents.get(index.id), source.disclosure.locator));
  let entity = entry.secCode;
  if (source.disclosure.issuer) {
    const link = source.disclosure.issuer,
      issuerSource = sources.find((s) => s.id === link.sourceId);
    if (
      issuerSource?.mapping !== "cninfo-stock-list" ||
      issuerSource.url !== "https://www.cninfo.com.cn/new/data/szse_stock.json"
    )
      throw new Error(`Unverified issuer directory: ${source.id}`);
    const rowSchema = z.object({ code: z.string().regex(/^\d{6}$/), orgId: z.string().min(1) });
    const issuer = rowSchema.parse(jsonPointer(documents.get(link.sourceId), link.locator));
    const rows = z
      .object({ stockList: z.array(rowSchema) })
      .parse(documents.get(link.sourceId)).stockList;
    const query = new URLSearchParams(index.request?.body);
    if (
      index.request?.method !== "POST" ||
      query.get("stock") !== `${issuer.code},${issuer.orgId}` ||
      entry.orgId !== issuer.orgId ||
      [issuer.code, entry.secCode].some((code) => {
        const ids = [...new Set(rows.filter((r) => r.code === code).map((r) => r.orgId))];
        return ids.length !== 1 || ids[0] !== issuer.orgId;
      })
    )
      throw new Error(`Announcement issuer identity mismatch: ${source.id}`);
    entity = issuer.code;
  }
  const year = cnAnnualReportYear(entry.announcementTitle, entry.secName);
  const url = new URL(entry.adjunctUrl, "https://static.cninfo.com.cn/");
  if (!year || url.hostname !== "static.cninfo.com.cn" || url.href !== source.url)
    throw new Error(`PDF announcement mismatch: ${source.id}`);
  return { entry, entity, year };
}
// PDF 兜底：先绑定发行人与正式公告，再读取受支持文本；格式未知时保留缺失。
export async function readDisclosurePdf(
  source: EvidenceInput["sources"][number],
  bytes: Buffer,
  documents: Map<string, unknown>,
  sources: EvidenceInput["sources"],
): Promise<DisclosureText> {
  const { entry, entity, year } = disclosureAnnouncement(source, documents, sources);
  const parser = new PDFParse({ data: bytes });
  try {
    let text = await parser.getText(
      source.pages
        ? {
            partial: [
              ...new Set([...Array.from({ length: 10 }, (_, i) => i + 1), ...source.pages]),
            ],
          }
        : {},
    );
    const name = entry.secName?.normalize("NFKC").replace(/\s/g, "");
    const frontmatter = text.pages.filter((p) => p.num <= 10).sort((a, b) => a.num - b.num);
    const explicitCodes = (value: string) =>
      [...value.matchAll(/(?:股票|证券)代码[：:｜|]?([0-9]{6})/g)].map((m) => m[1]);
    const firstCover = frontmatter.find((p) => p.num === 1)?.text.replace(/\s/g, "") ?? "";
    if (explicitCodes(firstCover).some((code) => code !== entry.secCode))
      throw new Error(`PDF cover identity/year mismatch: ${source.id}`);
    let identity = frontmatter.find((p) => {
      const value = p.text.normalize("NFKC").replace(/\s/g, ""),
        namedIssuer = !!name && name.length >= 4 && value.includes(name);
      // A decorative first page is common. Later pages must explicitly identify a report
      // cover or the issuer's own stock table; an incidental mention in the body is insufficient.
      const chineseYear = [...year].map((d) => "零一二三四五六七八九"[Number(d)]).join("");
      const reportYear = new RegExp(
        `${year}年年度报告|${year}annualreport|${chineseYear}年年报`,
        "i",
      ).test(value);
      const companyTable =
        value.includes("公司信息") &&
        value.includes("公司的中文名称") &&
        /股票上市(?:证券)?交易所[：:]?(?:上海|深圳|北京)证券交易所/.test(value);
      const stockTable =
        value.includes("公司股票简况") && /A股(?:上海|深圳|北京)证券交易所[^\d]{0,40}/.test(value);
      const introduction = value.includes("关于我们") && value.includes("我们是谁");
      const listingParagraph = introduction
        ? value.match(/公司在[^。]*证券交易所[^。]*上市。/)?.[0]
        : undefined;
      const introductionCode = listingParagraph?.match(
        /(?:上海|深圳|北京)证券交易所[（(](\d{6})\.(?:SH|SZ|BJ)[）)]/,
      )?.[1];
      const location =
        p.num === 1 ||
        (p.num === 2 && reportYear) ||
        ((stockTable || companyTable || introductionCode) && reportYear);
      const codes = explicitCodes(value);
      const tableCode = stockTable
        ? value.match(/A股(?:上海|深圳|北京)证券交易所[^\d]{0,40}(\d{6})/)?.[1]
        : undefined;
      return (
        location &&
        (p.num === 1 ? value.includes(year) : reportYear) &&
        !codes.some((code) => code !== entry.secCode) &&
        (!tableCode || tableCode === entry.secCode) &&
        (companyTable
          ? codes.length === 1 && codes[0] === entry.secCode && namedIssuer
          : stockTable
            ? tableCode === entry.secCode
            : introduction
              ? introductionCode === entry.secCode && namedIssuer
              : value.includes(entry.secCode) || namedIssuer)
      );
    });
    if (!identity) {
      // Some annual reports place their legal identity table at the back. Read only
      // the bounded closing pages when the caller requested selected evidence pages.
      const closingPages = Array.from(
        { length: Math.min(10, text.total) },
        (_, i) => text.total - i,
      );
      if (source.pages && closingPages.some((n) => !text.pages.some((p) => p.num === n))) {
        text = await parser.getText({
          partial: [...new Set([...text.pages.map((p) => p.num), ...closingPages])],
        });
      }
      const chineseYear = [...year].map((d) => "零一二三四五六七八九"[Number(d)]).join("");
      identity = text.pages
        .filter((p) => p.num <= 10 || closingPages.includes(p.num))
        .find((p) => {
          const value = p.text.normalize("NFKC").replace(/\s/g, "");
          if (
            !name ||
            name.length < 4 ||
            !value.includes(name) ||
            !value.includes("公司信息") ||
            !value.includes("法定名称") ||
            !new RegExp(`${year}年年度报告|${chineseYear}年年报`).test(value)
          )
            return false;
          const venue = value.match(/证券类别及上市地点A股(上海|深圳|北京)证券交易所/);
          const code = value.match(/证券简称及代码A股[^0-9]{1,60}(\d{6})(?!\d)/)?.[1];
          return (
            !!venue &&
            code === entry.secCode &&
            !explicitCodes(value).some((code) => code !== entry.secCode)
          );
        });
    }
    if (!identity) throw new Error(`PDF cover identity/year mismatch: ${source.id}`);
    // Preserve geometric cells for dense monthly regulatory tables; never join
    // line-wrapped numbers across columns or invoke OCR/LLM to guess their values.
    const tablePages = [
      ...new Set(
        text.pages
          .filter(
            (p) =>
              p.text.includes("预警") && p.text.includes("风险监管指标") && /12\s*月/.test(p.text),
          )
          .flatMap((p) => [p.num, ...(p.num < text.total ? [p.num + 1] : [])]),
      ),
    ];
    const tables = tablePages.length ? await parser.getTable({ partial: tablePages }) : undefined;
    if (tablePages.some((n) => !text.pages.some((p) => p.num === n)))
      text = await parser.getText({
        partial: [...new Set([...text.pages.map((p) => p.num), ...tablePages])],
      });
    return {
      entity,
      identityPage: identity.num,
      periodEnd: `${year}-12-31`,
      publishedAt: new Date(entry.announcementTime + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
      pages: Object.fromEntries(
        text.pages.map((p) => [
          p.num,
          {
            text: p.text,
            lines: p.text.split("\n"),
            ...(tables?.pages.find((t) => t.num === p.num)
              ? { tables: tables.pages.find((t) => t.num === p.num)!.tables }
              : {}),
          },
        ]),
      ),
    };
  } finally {
    await parser.destroy();
  }
}
