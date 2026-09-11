/**
 * 美股筛选流程：取得证券池、补全结构化财务数据，执行模板规则并分配候选席位。
 * 数据源实现在 sources/，资格判定在 template-rules.ts，运行诊断与报告在 reports.ts。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  mapPool,
  DEFAULT_CACHE_DIR,
  DEFAULT_FIXTURES_DIR,
  type ProgressLogger,
  parseMarkets,
  createProgressLogger,
} from "../shared/runtime.js";
import { type Market, type SecurityRecord } from "../shared/financial-model.js";
import {
  type ExclusionRulesSpec,
  deferredWatchlistCapFromBundle,
  funnelSoftCapFromBundle,
  northStarForPool,
  seatAllocationFromBundle,
  type SpecBundle,
  type NorthStarSpec,
  type TemplateSeatAllocationConfig,
  type TemplateSeatPoolConfig,
  loadSpecBundle,
} from "../policy/loader.js";
import {
  getUniverseProfileFailureReason,
  applyExclusionRules,
  type ExclusionResult,
  bestPassingCandidate,
  type FunnelTrack,
  listTemplateTrackResults,
  type PassingCandidate,
  routeSecurityRecord,
  type SeatSource,
} from "./template-rules.js";
import {
  applyIndustryBenchmarks,
  annualRowsNeedMetricRefresh,
  ENRICH_STATS_SAMPLE_CAP,
  mergeEnrichment,
  readCache,
  updatedQuoteHistory,
  writeCache,
  type AnnualFinancialRow,
  type EnrichCachePayload,
  fetchUsAnnualRows,
  fetchUsIndustryProxy,
  resolveCik,
} from "./sources/fundamentals.js";
import { createUsYahooAdapter, fetchUsQuoteSnapshot } from "./sources/market-data.js";

import { stringify as stringifyYaml } from "yaml";

import { FunnelDiagnosticsCollector, routingDiagnosticsFromFunnel } from "./reports.js";

// 证券池与补数：先执行行情初筛，再为剩余公司补齐模板指标。

export interface LoadUniverseOptions {
  progress?: ProgressLogger;
  quarter?: string;
}

export interface EnrichOptions {
  quarter: string;
  cacheDir: string;
  concurrency: number;
  skipCache?: boolean;
  exclusionRules?: ExclusionRulesSpec;
  progress?: ProgressLogger;
  specDir?: string;
}

export interface EnrichRunStats {
  enrichFailedCount: number;
  enrichFailedSamples: string[];
  emptyAnnualCount: number;
  emptyAnnualSamples: string[];
}

export interface EnrichResult {
  universe: SecurityRecord[];
  prefilterExcluded: SecurityRecord[];
  enrichStatsByMarket?: Partial<Record<Market, EnrichRunStats>>;
}

export interface MarketDataAdapter {
  loadUniverse(markets: Market[], opts?: LoadUniverseOptions): Promise<SecurityRecord[]>;
  enrichRecords?(records: SecurityRecord[], opts: EnrichOptions): Promise<EnrichResult>;
}

export function summarizeEnrichRunStats(records: SecurityRecord[]): EnrichRunStats {
  let enrichFailedCount = 0;
  let emptyAnnualCount = 0;
  const enrichFailedSamples: string[] = [];
  const emptyAnnualSamples: string[] = [];

  for (const r of records) {
    if (r.enrichmentFailure) {
      enrichFailedCount += 1;
      if (enrichFailedSamples.length < ENRICH_STATS_SAMPLE_CAP) {
        enrichFailedSamples.push(r.ticker);
      }
      continue;
    }

    const noAnnual = (r.revenueYoyHistory?.length ?? 0) === 0 && !r.industryProxy;
    if (noAnnual) {
      emptyAnnualCount += 1;
      if (emptyAnnualSamples.length < ENRICH_STATS_SAMPLE_CAP) {
        emptyAnnualSamples.push(r.ticker);
      }
    }
  }

  return {
    enrichFailedCount,
    enrichFailedSamples,
    emptyAnnualCount,
    emptyAnnualSamples,
  };
}

// 先按报价层面的硬条件缩小 SEC 请求范围，再并发补全幸存股票。
async function enrichOne(record: SecurityRecord, opts: EnrichOptions): Promise<SecurityRecord> {
  try {
    return await enrichUsRecord(record, opts);
  } catch {
    return { ...record, enrichmentFailure: "fetch_failed" };
  }
}

function summarizeEnrichment(enrichStats: EnrichRunStats, opts: EnrichOptions): void {
  const progress = opts.progress;
  if (!progress) return;

  if (enrichStats.enrichFailedCount > 0) {
    progress.warn(
      `${enrichStats.enrichFailedCount} ticker(s) failed enrichment` +
        (enrichStats.enrichFailedSamples.length
          ? ` (e.g. ${enrichStats.enrichFailedSamples.slice(0, 5).join(", ")})`
          : ""),
    );
  }
}

export async function enrichLiveUniverse(
  records: SecurityRecord[],
  opts: EnrichOptions,
): Promise<EnrichResult> {
  if (!opts.exclusionRules) {
    throw new Error("exclusionRules is required for live enrichment prefilter");
  }

  const progress = opts.progress;
  const { survivors, prefilterExcluded } = partitionQuotePrefilter(opts.exclusionRules, records);

  progress?.phase(
    `Quote prefilter: ${survivors.length} survivors, ${prefilterExcluded.length} excluded ` +
      `(status / market cap / listing age)`,
  );

  if (survivors.length === 0) {
    progress?.warn("No survivors after quote prefilter — funnel will produce empty candidates");
    return { universe: [], prefilterExcluded };
  }

  const cacheNote = opts.skipCache ? "cache disabled" : `cache quarter=${opts.quarter}`;
  progress?.phase(
    `Enriching ${survivors.length} tickers (concurrency=${opts.concurrency}, ${cacheNote})…`,
  );

  const enriched = await mapPool(
    survivors,
    opts.concurrency,
    (record) => enrichOne(record, opts),
    (done, total) => progress?.tick(done, total, "enrichment"),
  );

  const enrichStats = summarizeEnrichRunStats(enriched);
  summarizeEnrichment(enrichStats, opts);
  progress?.phase("Applying industry benchmark overlays…");

  return {
    universe: applyIndustryBenchmarks(enriched),
    prefilterExcluded,
    enrichStatsByMarket: { US: enrichStats },
  };
}

async function loadFixtureFile(fixturesDir: string, market: Market): Promise<SecurityRecord[]> {
  const filePath = path.join(fixturesDir, `universe-${market.toLowerCase()}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as SecurityRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export function createFixtureAdapter(fixturesDir = DEFAULT_FIXTURES_DIR): MarketDataAdapter {
  return {
    async loadUniverse(markets: Market[], _opts?: LoadUniverseOptions): Promise<SecurityRecord[]> {
      const records: SecurityRecord[] = [];
      for (const market of markets) {
        records.push(...(await loadFixtureFile(fixturesDir, market)));
      }
      return records;
    },
  };
}

// adapter 同时保留 fixture 与实时入口，供命令和离线复盘走同一套筛选流程。
export type AdapterKind = "fixture" | "live";

export function createLiveAdapter(cacheDir = DEFAULT_CACHE_DIR): MarketDataAdapter {
  const usAdapter = createUsYahooAdapter();

  return {
    async loadUniverse(markets: Market[], opts?: LoadUniverseOptions): Promise<SecurityRecord[]> {
      return markets.includes("US") ? usAdapter.loadUniverse(["US"], opts) : [];
    },

    async enrichRecords(records: SecurityRecord[], opts: EnrichOptions): Promise<EnrichResult> {
      return enrichLiveUniverse(records, { ...opts, cacheDir });
    },
  };
}

export function createAdapter(
  kind: AdapterKind,
  fixturesDir = DEFAULT_FIXTURES_DIR,
): MarketDataAdapter {
  return kind === "fixture"
    ? createFixtureAdapter(fixturesDir)
    : createLiveAdapter(DEFAULT_CACHE_DIR);
}

export function partitionQuotePrefilter(
  exclusionRules: ExclusionRulesSpec,
  records: SecurityRecord[],
): { survivors: SecurityRecord[]; prefilterExcluded: SecurityRecord[] } {
  const survivors: SecurityRecord[] = [];
  const prefilterExcluded: SecurityRecord[] = [];
  for (const record of records) {
    if (getUniverseProfileFailureReason(exclusionRules, record) === null) {
      survivors.push(record);
    } else {
      prefilterExcluded.push(record);
    }
  }
  return { survivors, prefilterExcluded };
}
// US 补全优先复用同季度年报缓存；旧缓存缺少关键资产负债字段时才定向刷新。

async function refreshUsAnnualRows(
  cik: string,
  existing: AnnualFinancialRow[],
): Promise<AnnualFinancialRow[]> {
  const fresh = await fetchUsAnnualRows(cik).catch(() => [] as AnnualFinancialRow[]);
  return fresh.length > 0 ? fresh : existing;
}

async function resolveQuoteSnapshot(
  record: SecurityRecord,
  cachedDividendYield?: number,
): Promise<{ record: SecurityRecord; dividendYield?: number }> {
  const needsQuote =
    record.metrics.pe_ttm?.value === undefined || record.metrics.pb?.value === undefined;
  const needsDividend = cachedDividendYield === undefined;
  if (!needsQuote && !needsDividend) {
    return { record, dividendYield: cachedDividendYield };
  }

  try {
    const snapshot = await fetchUsQuoteSnapshot(record.ticker, needsQuote);
    const metrics = snapshot?.metrics;
    return {
      record:
        !needsQuote || !metrics || Object.keys(metrics).length === 0
          ? record
          : { ...record, metrics: { ...record.metrics, ...metrics } },
      dividendYield: cachedDividendYield ?? snapshot?.dividendYield,
    };
  } catch (err) {
    if (needsQuote) throw err;
    return { record, dividendYield: cachedDividendYield };
  }
}

async function fetchFreshUsFundamentals(
  ticker: string,
): Promise<{ annualRows: AnnualFinancialRow[]; industryProxy?: string } | undefined> {
  const cik = await resolveCik(ticker);
  if (!cik) return undefined;
  const [annualRows, industryProxy] = await Promise.all([
    fetchUsAnnualRows(cik),
    fetchUsIndustryProxy(cik),
  ]);
  return { annualRows, industryProxy };
}

async function persistEnrichCache(
  opts: EnrichOptions,
  ticker: string,
  payload: EnrichCachePayload,
  enriched: SecurityRecord,
): Promise<void> {
  if (opts.skipCache) return;
  await writeCache(opts.cacheDir, opts.quarter, "US", ticker, {
    ...payload,
    quoteHistory: updatedQuoteHistory(
      payload.quoteHistory,
      opts.quarter,
      enriched.metrics.pe_ttm?.value,
      enriched.metrics.pb?.value,
      enriched.metrics.ps?.value,
    ),
  });
}

export async function enrichUsRecord(
  record: SecurityRecord,
  opts: EnrichOptions,
): Promise<SecurityRecord> {
  if (record.market !== "US") return record;

  const cached = opts.skipCache
    ? null
    : await readCache<EnrichCachePayload>(opts.cacheDir, opts.quarter, "US", record.ticker);
  if (cached?.annualRows.length) {
    const quotePromise = resolveQuoteSnapshot(record, cached.dividendYield);
    const annualRowsPromise = annualRowsNeedMetricRefresh(cached.annualRows)
      ? resolveCik(record.ticker).then(async (cik) =>
          cik ? refreshUsAnnualRows(cik, cached.annualRows) : cached.annualRows,
        )
      : Promise.resolve(cached.annualRows);
    const [{ record: recordWithQuote, dividendYield: fetchedDividendYield }, annualRows] =
      await Promise.all([quotePromise, annualRowsPromise]);
    const dividendYield = cached.dividendYield ?? fetchedDividendYield;
    const enriched = mergeEnrichment(
      recordWithQuote,
      annualRows,
      cached.industryProxy,
      dividendYield,
      { quarter: opts.quarter, quoteHistory: cached.quoteHistory },
    );
    const payload: EnrichCachePayload = {
      ...cached,
      annualRows,
      dividendYield,
    };
    await persistEnrichCache(opts, record.ticker, payload, enriched);
    return enriched;
  }

  const [quoteWithDividend, fundamentals] = await Promise.all([
    resolveQuoteSnapshot(record),
    fetchFreshUsFundamentals(record.ticker),
  ]);
  if (!fundamentals) {
    return { ...quoteWithDividend.record, enrichmentFailure: "cik_unresolved" };
  }
  const { annualRows, industryProxy } = fundamentals;

  const enriched = mergeEnrichment(
    quoteWithDividend.record,
    annualRows,
    industryProxy,
    quoteWithDividend.dividendYield,
    {
      quarter: opts.quarter,
    },
  );

  if (annualRows.length > 0) {
    await persistEnrichCache(
      opts,
      record.ticker,
      { annualRows, industryProxy, dividendYield: quoteWithDividend.dividendYield },
      enriched,
    );
  }

  return enriched;
}

// 筛选与席位分配：按模板判定资格，分别保存选入与容量外候选。

async function writeYamlArtifact(outputPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stringifyYaml(data), "utf8");
}

export interface AllocatedCandidate extends PassingCandidate {
  rank: number;
  seat_source: SeatSource;
}

export interface TemplateSeatAllocationResult {
  candidates: AllocatedCandidate[];
  deferred: AllocatedCandidate[];
  overflowCount: number;
  byPoolSelected: Record<string, number>;
}

export interface PoolNorthStarLookup {
  forPool(poolKey: string): NorthStarSpec | undefined;
  defaultQuality?: NorthStarSpec;
}

const CONFIDENCE_ORDER = { high: 3, medium: 2, low: 1 };

export function poolKeyForCandidate(candidate: PassingCandidate): string {
  return `${candidate.winning_template}_${candidate.passed_track}`;
}

function northStarSortValue(candidate: PassingCandidate, northStar: NorthStarSpec): number {
  const v = candidate.metric_snapshot[northStar.metric]?.value;
  if (v === undefined || !Number.isFinite(v)) {
    return northStar.direction === "desc" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  return v;
}

export function compareNorthStar(
  a: PassingCandidate,
  b: PassingCandidate,
  northStar: NorthStarSpec,
): number {
  const va = northStarSortValue(a, northStar);
  const vb = northStarSortValue(b, northStar);
  if (vb !== va) {
    return northStar.direction === "desc" ? vb - va : va - vb;
  }
  return a.ticker.localeCompare(b.ticker);
}

export function compareInPool(
  a: PassingCandidate,
  b: PassingCandidate,
  poolKey?: string,
  northStarLookup?: PoolNorthStarLookup,
): number {
  if (a.track_confluence !== b.track_confluence) {
    return a.track_confluence ? -1 : 1;
  }
  if (b.pool_score !== a.pool_score) return b.pool_score - a.pool_score;
  if (CONFIDENCE_ORDER[b.data_confidence] !== CONFIDENCE_ORDER[a.data_confidence]) {
    return CONFIDENCE_ORDER[b.data_confidence] - CONFIDENCE_ORDER[a.data_confidence];
  }
  if (poolKey && northStarLookup) {
    const northStar = northStarLookup.forPool(poolKey);
    if (northStar) return compareNorthStar(a, b, northStar);
  }
  return a.ticker.localeCompare(b.ticker);
}

function flexScore(candidate: PassingCandidate, multiplier: number): number {
  return candidate.pool_score * (candidate.track_confluence ? multiplier : 1);
}

function compareFlex(
  a: PassingCandidate,
  b: PassingCandidate,
  multiplier: number,
  northStarLookup?: PoolNorthStarLookup,
): number {
  const scoreA = flexScore(a, multiplier);
  const scoreB = flexScore(b, multiplier);
  if (scoreB !== scoreA) return scoreB - scoreA;
  return compareInPool(a, b, poolKeyForCandidate(a), northStarLookup);
}

function groupByPool(
  candidates: PassingCandidate[],
  northStarLookup?: PoolNorthStarLookup,
): Map<string, PassingCandidate[]> {
  const buckets = new Map<string, PassingCandidate[]>();
  for (const candidate of candidates) {
    const key = poolKeyForCandidate(candidate);
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  for (const [poolKey, bucket] of buckets) {
    bucket.sort((a, b) => compareInPool(a, b, poolKey, northStarLookup));
  }
  return buckets;
}

function poolConfigForKey(
  config: TemplateSeatAllocationConfig,
  key: string,
): TemplateSeatPoolConfig {
  return config.pools[key] ?? { floor: 0, cap: Number.POSITIVE_INFINITY };
}

function trySelect(
  candidate: PassingCandidate,
  seatSource: SeatSource,
  state: {
    selected: AllocatedCandidate[];
    selectedTickers: Set<string>;
    poolSelectedCount: Record<string, number>;
    byPoolSelected: Record<string, number>;
    softCap: number;
  },
): boolean {
  if (state.selected.length >= state.softCap) return false;
  if (state.selectedTickers.has(candidate.ticker)) return false;

  const key = poolKeyForCandidate(candidate);
  state.selected.push({ ...candidate, rank: 0, seat_source: seatSource });
  state.selectedTickers.add(candidate.ticker);
  state.poolSelectedCount[key] = (state.poolSelectedCount[key] ?? 0) + 1;
  state.byPoolSelected[key] = (state.byPoolSelected[key] ?? 0) + 1;
  return true;
}

function poolAtCap(
  key: string,
  config: TemplateSeatAllocationConfig,
  poolSelectedCount: Record<string, number>,
): boolean {
  const cap = poolConfigForKey(config, key).cap;
  return (poolSelectedCount[key] ?? 0) >= cap;
}

export function allocateTemplateSeats(
  candidates: PassingCandidate[],
  config: TemplateSeatAllocationConfig,
  softCap: number,
  deferredCap: number,
  northStarLookup?: PoolNorthStarLookup,
): TemplateSeatAllocationResult {
  const buckets = groupByPool(candidates, northStarLookup);
  const selected: AllocatedCandidate[] = [];
  const selectedTickers = new Set<string>();
  const poolSelectedCount: Record<string, number> = {};
  const byPoolSelected: Record<string, number> = {};
  const state = { selected, selectedTickers, poolSelectedCount, byPoolSelected, softCap };

  for (const [poolKey, poolConfig] of Object.entries(config.pools)) {
    if (poolConfig.floor <= 0) continue;
    const bucket = buckets.get(poolKey) ?? [];
    let taken = 0;
    for (const candidate of bucket) {
      if (taken >= poolConfig.floor) break;
      if (poolAtCap(poolKey, config, poolSelectedCount)) break;
      if (trySelect(candidate, "floor", state)) taken += 1;
    }
  }

  for (const [poolKey, poolConfig] of Object.entries(config.pools)) {
    const bucket = buckets.get(poolKey) ?? [];
    for (const candidate of bucket) {
      if (poolAtCap(poolKey, config, poolSelectedCount)) break;
      if ((poolSelectedCount[poolKey] ?? 0) >= poolConfig.cap) break;
      trySelect(candidate, "cap", state);
    }
  }

  const multiplier = config.flex.confluence_weight_multiplier;
  while (selected.length < softCap) {
    const eligible = candidates.filter((candidate) => {
      if (selectedTickers.has(candidate.ticker)) return false;
      const key = poolKeyForCandidate(candidate);
      return !poolAtCap(key, config, poolSelectedCount);
    });
    if (eligible.length === 0) break;
    eligible.sort((a, b) => compareFlex(a, b, multiplier, northStarLookup));
    if (!trySelect(eligible[0]!, "flex", state)) break;
  }

  if (selected.length < softCap && config.backfill.tier1 === "same_template_quality") {
    const templatesWithShortfall = new Set<string>();
    for (const [poolKey, poolConfig] of Object.entries(config.pools)) {
      const selectedFromPool = poolSelectedCount[poolKey] ?? 0;
      if (selectedFromPool < poolConfig.floor) {
        templatesWithShortfall.add(poolKey.replace(/_(quality|mispricing)$/, ""));
      }
    }

    for (const template of [...templatesWithShortfall].sort()) {
      const qualityKey = `${template}_quality`;
      const bucket = buckets.get(qualityKey) ?? [];
      for (const candidate of bucket) {
        if (selected.length >= softCap) break;
        trySelect(candidate, "backfill_same_template", state);
      }
    }
  }

  if (selected.length < softCap && config.backfill.tier2 === "global_quality") {
    const qualityCandidates = candidates.filter(
      (candidate) => candidate.passed_track === "quality" && !selectedTickers.has(candidate.ticker),
    );
    qualityCandidates.sort((a, b) => compareInPool(a, b, "default_quality", northStarLookup));
    for (const candidate of qualityCandidates) {
      if (selected.length >= softCap) break;
      trySelect(candidate, "backfill_global", state);
    }
  }

  selected.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  const unselected = candidates
    .filter((candidate) => !selectedTickers.has(candidate.ticker))
    .sort((a, b) => compareFlex(a, b, multiplier, northStarLookup));

  const deferred = unselected.slice(0, deferredCap).map((candidate, index) => ({
    ...candidate,
    rank: softCap + index + 1,
    seat_source: "deferred" as const,
  }));

  return {
    candidates: selected,
    deferred,
    overflowCount: Math.max(0, unselected.length - deferred.length),
    byPoolSelected,
  };
}

// 同模板候选先按北极星指标排序，再按席位上限保留可比较的组合。

/** Default per-ticker enrichment workers; each ticker may issue multiple HTTP calls. */
const DEFAULT_ENRICH_CONCURRENCY = 4;

export interface RunCommandOptions {
  markets: string;
  quarter: string;
  output: string;
  spec: string;
  adapter?: "fixture" | "live";
  fixturesDir?: string;
  enrichConcurrency?: number;
  skipCache?: boolean;
}

export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const progress = createProgressLogger();
  const adapterKind = opts.adapter ?? "fixture";
  const { marketScope, markets } = parseMarkets(opts.markets);

  progress.phase(`Loading spec from ${path.resolve(opts.spec)}…`);
  const bundle = await loadSpecBundle(path.resolve(opts.spec));

  const adapter = createAdapter(adapterKind, opts.fixturesDir);
  const enrichOpts = {
    quarter: opts.quarter,
    cacheDir: DEFAULT_CACHE_DIR,
    concurrency: opts.enrichConcurrency ?? DEFAULT_ENRICH_CONCURRENCY,
    skipCache: opts.skipCache ?? false,
    exclusionRules: bundle.exclusionRules,
    progress,
    specDir: path.resolve(opts.spec),
  };

  progress.phase(`Adapter: ${adapterKind} — loading ${marketScope} universe…`);
  let universe = await adapter.loadUniverse(markets, { progress, quarter: opts.quarter });
  progress.phase(`Loaded ${universe.length} securities`);

  let prefilterExcluded: typeof universe = [];
  let enrichStatsByMarket: Partial<Record<Market, EnrichRunStats>> | undefined;

  if (adapter.enrichRecords && adapterKind === "live") {
    const enriched = await adapter.enrichRecords(universe, enrichOpts);
    universe = enriched.universe;
    prefilterExcluded = enriched.prefilterExcluded;
    enrichStatsByMarket = enriched.enrichStatsByMarket;
  }

  const outputDir = path.join(path.resolve(opts.output), opts.quarter);
  progress.phase(`Running funnel (${marketScope}, ${universe.length} enriched records)…`);

  const result = await runFunnel({
    bundle,
    universe,
    prefilterExcluded,
    quarter: opts.quarter,
    marketScope,
    outputDir,
    progress,
    enrichStatsByMarket,
  });

  if (result.candidateCount === 0 && result.deferredCount === 0) {
    progress.warn(
      "Funnel produced no candidates — review excluded.yaml and funnel-diagnostics.yaml",
    );
  }

  console.log(
    `Funnel run complete (${opts.quarter}, ${marketScope}): ` +
      `${result.candidateCount} candidates, ${result.deferredCount} deferred, ` +
      `${result.excludedCount} excluded → ${outputDir}`,
  );
}

export interface ExplainCommandOptions {
  ticker: string;
  market: Market;
  fixture: string;
  spec: string;
}

// 单标的 explain 复用正式路由和模板诊断，不维护第二套解释规则。
async function loadSecurityRecordFromFixture(
  fixturePath: string,
  ticker: string,
  market: Market,
): Promise<SecurityRecord> {
  const raw = JSON.parse(await fs.readFile(path.resolve(fixturePath), "utf8")) as
    | SecurityRecord
    | SecurityRecord[];

  const record = Array.isArray(raw)
    ? (raw.find((r) => r.ticker === ticker && r.market === market) ??
      raw.find((r) => r.ticker === ticker))
    : raw;

  if (!record) {
    throw new Error(`No security record found for ticker ${ticker} in ${fixturePath}`);
  }
  if (record.market !== market) {
    throw new Error(
      `Record market ${record.market} does not match --market ${market} for ticker ${ticker}`,
    );
  }

  return { ...record, ticker };
}

export async function explainCommand(opts: ExplainCommandOptions): Promise<void> {
  const bundle = await loadSpecBundle(path.resolve(opts.spec));
  const record = await loadSecurityRecordFromFixture(opts.fixture, opts.ticker, opts.market);

  const kill = applyExclusionRules(bundle.exclusionRules, record);
  const route = routeSecurityRecord(bundle, record);
  const trackResults = listTemplateTrackResults(bundle, record, route);

  console.log(
    JSON.stringify(
      {
        ticker: record.ticker,
        market: record.market,
        companyName: record.companyName,
        kill,
        route,
        bestCandidate: bestPassingCandidate(bundle, record, kill, route),
        trackResults,
      },
      null,
      2,
    ),
  );
}

export interface FunnelRunOptions {
  bundle: SpecBundle;
  universe: SecurityRecord[];
  prefilterExcluded?: SecurityRecord[];
  quarter: string;
  marketScope: Market | "CN,US";
  outputDir: string;
  progress?: ProgressLogger;
  enrichStatsByMarket?: Partial<Record<Market, EnrichRunStats>>;
  cacheGapByMarket?: Partial<Record<Market, { count: number; samples: string[] }>>;
}

export interface FunnelRunResult {
  candidateCount: number;
  deferredCount: number;
  excludedCount: number;
}

export async function runFunnel(opts: FunnelRunOptions): Promise<FunnelRunResult> {
  const softCap = funnelSoftCapFromBundle(opts.bundle);
  const deferredCap = deferredWatchlistCapFromBundle(opts.bundle);
  const markets =
    opts.marketScope === "CN,US" ? (["CN", "US"] as Market[]) : [opts.marketScope as Market];

  let totalCandidates = 0;
  let totalDeferred = 0;
  let totalExcluded = 0;

  for (const market of markets) {
    opts.progress?.phase(`Funnel stage: ${market} (kill gates → sector templates → rank)…`);
    const marketUniverse = opts.universe.filter((u) => u.market === market);
    const marketPrefilterExcluded = (opts.prefilterExcluded ?? []).filter(
      (r) => r.market === market,
    );
    const excluded: unknown[] = [];
    const passed: PassingCandidate[] = [];
    const diagnostics = new FunnelDiagnosticsCollector();
    diagnostics.recordPrefilterExcluded(opts.bundle, marketPrefilterExcluded);

    for (const record of marketUniverse) {
      const kill = applyExclusionRules(opts.bundle.exclusionRules, record);
      if (kill.excluded) {
        diagnostics.recordKillExcluded(kill.killReason);
        excluded.push({
          ticker: record.ticker,
          market: record.market,
          kill_reason: kill.killReason,
          metric_snapshot: {},
          enrichment_failure: record.enrichmentFailure,
        });
        continue;
      }

      const best = diagnostics.recordKillSurvivor(opts.bundle, record, kill);
      if (best) passed.push(best);
    }

    const seatConfig = seatAllocationFromBundle(opts.bundle);
    const northStarLookup = {
      forPool: (poolKey: string) => northStarForPool(opts.bundle, poolKey),
    };
    const allocation = allocateTemplateSeats(
      passed,
      seatConfig,
      softCap,
      deferredCap,
      northStarLookup,
    );

    const stripInternalFields = ({
      compositeScore: _compositeScore,
      supportingPassCount: _supportingPassCount,
      ...output
    }: PassingCandidate) => output;

    const primary = allocation.candidates.map(stripInternalFields);
    const deferred = allocation.deferred.map(stripInternalFields);
    const sectorPassOverflow = allocation.overflowCount;
    const universeCount = marketUniverse.length + marketPrefilterExcluded.length;
    const funnelDiagnostics = diagnostics.finalize({
      bundle: opts.bundle,
      quarter: opts.quarter,
      market,
      universeCount,
      enrichedInRun: marketUniverse.length,
      prefilterExcluded: marketPrefilterExcluded.length,
      candidateCount: primary.length,
      deferredCount: deferred.length,
      sectorPassOverflow,
      deferredWatchlistCap: deferredCap,
      byPoolSelected: allocation.byPoolSelected,
      enrichStats: opts.enrichStatsByMarket?.[market],
      cacheGap: opts.cacheGapByMarket?.[market],
    });

    const base = path.join(opts.outputDir, market);
    const writes: Promise<void>[] = [
      writeYamlArtifact(path.join(base, "candidates.yaml"), {
        run_metadata: funnelDiagnostics.run_metadata,
        candidates: primary,
      }),
      writeYamlArtifact(path.join(base, "deferred.yaml"), {
        run_metadata: funnelDiagnostics.run_metadata,
        deferred,
      }),
      writeYamlArtifact(path.join(base, "excluded.yaml"), {
        run_metadata: funnelDiagnostics.run_metadata,
        excluded,
      }),
      writeYamlArtifact(path.join(base, "funnel-diagnostics.yaml"), funnelDiagnostics),
      writeYamlArtifact(
        path.join(base, "routing-diagnostics.yaml"),
        routingDiagnosticsFromFunnel(funnelDiagnostics),
      ),
    ];
    if (diagnostics.prefilterExcludedRows.length > 0) {
      writes.push(
        writeYamlArtifact(path.join(base, "prefilter-excluded.yaml"), {
          run_metadata: funnelDiagnostics.run_metadata,
          prefilter_excluded: diagnostics.prefilterExcludedRows,
        }),
      );
    }
    await Promise.all(writes);

    const fallbackRate = funnelDiagnostics.routing?.fallback_rate;
    if (fallbackRate !== undefined && fallbackRate >= 0.5) {
      opts.progress?.warn(
        `${market} routing fallback_rate=${(fallbackRate * 100).toFixed(1)}% — ` +
          "check industry enrichment and CN routing coverage",
      );
    }

    opts.progress?.phase(
      `${market} done: ${primary.length} candidates, ${deferred.length} deferred, ` +
        `${excluded.length} excluded`,
    );

    totalCandidates += primary.length;
    totalDeferred += deferred.length;
    totalExcluded += excluded.length;
  }

  return {
    candidateCount: totalCandidates,
    deferredCount: totalDeferred,
    excludedCount: totalExcluded,
  };
}
