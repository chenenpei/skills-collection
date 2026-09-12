#!/usr/bin/env node
/**
 * 命令入口：校验参数并调度 A 股、美股、运行解释及独立价格观察。
 * 各筛选流程按需载入；合并的小型 landmine 命令仍保持原有输入输出。
 */
import { existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import path from "node:path";
import {
  CLI_ROOT,
  parseMarket,
  DEFAULT_CACHE_DIR,
  DEFAULT_POLICY_DIR,
  DEFAULT_OUTPUT_DIR,
} from "./shared/runtime.js";

// 参数校验与命令调度。

const defaultCnUniverseBudget = { maxRequests: 600, maxMs: 30 * 60_000, requestMs: 10_000 };
type RunOptions = {
  markets?: string;
  quarter?: string;
  output?: string;
  spec?: string;
  policy?: string;
  input?: string;
  collectFrom?: string;
  cacheFrom?: string;
  annualCacheDays?: string;
  budgetFile?: string;
  pdf: boolean;
  asOf?: string;
  limit?: string;
  backupLimit?: string;
  financialLeadLimit?: string;
  strategy?: "all" | "quality" | "financial" | "ncav";
  evaluateAll: boolean;
  adapter?: string;
  enrichConcurrency: string;
  skipCache: boolean;
};
function requestedMarkets(markets: string | undefined): string[] {
  const values = (markets ?? "CN")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !values.length ||
    values.some((value) => value !== "CN" && value !== "US") ||
    new Set(values).size !== values.length
  )
    throw new Error("Market scope must be CN, US, or CN,US");
  return values;
}
/** Reject local CN configuration errors before an automatic identity fetch. */
async function validateCnRunOptions(opts: RunOptions, hasUs: boolean): Promise<void> {
  if (opts.backupLimit !== undefined && opts.financialLeadLimit !== undefined && opts.backupLimit !== opts.financialLeadLimit)
    throw new Error("Use --backup-limit without a conflicting --financial-lead-limit alias");
  opts.backupLimit ??= opts.financialLeadLimit;
  if (
    Boolean(opts.input) === Boolean(opts.collectFrom) &&
    (opts.input !== undefined || opts.collectFrom !== undefined)
  )
    throw new Error("CN screening requires exactly one of --input or --collect-from");
  if (opts.adapter !== undefined && !hasUs)
    throw new Error(
      "--adapter applies only to legacy US runs; CN screening uses live bounded collection, or --input for offline re-evaluation.",
    );
  if (opts.skipCache && !hasUs) throw new Error("--skip-cache applies only to legacy US runs.");
  if (opts.cacheFrom && (opts.input || opts.asOf))
    throw new Error("--cache-from requires live CN collection, without --input/--as-of");
  if (opts.annualCacheDays !== undefined) {
    const days = Number(opts.annualCacheDays);
    if (!Number.isFinite(days) || days < 0 || days > 365)
      throw new Error("Annual cache days must be between 0 and 365");
    if (opts.input || opts.asOf) throw new Error("--annual-cache-days requires live CN collection");
  }
  if (opts.input && (opts.budgetFile || opts.asOf))
    throw new Error(
      "--budget-file/--as-of require --collect-from or automatic CN identity collection",
    );
  if (
    opts.backupLimit !== undefined &&
    (!Number.isInteger(Number(opts.backupLimit)) || Number(opts.backupLimit) < 0)
  )
    throw new Error("Backup display limit must be a non-negative integer");
  if (opts.limit !== undefined) {
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 0)
      throw new Error("Display limit must be a non-negative integer");
  }
  if (
    opts.strategy !== undefined &&
    !["all", "quality", "financial", "ncav"].includes(opts.strategy)
  )
    throw new Error("Strategy must be all, quality, financial, or ncav");
  const concurrency = Number(opts.enrichConcurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12)
    throw new Error("Collection concurrency must be between 1 and 12");
  if (opts.asOf !== undefined) {
    const cutoff = Date.parse(opts.asOf);
    if (!Number.isFinite(cutoff)) throw new Error("Invalid collection as-of");
    if (cutoff > Date.now()) throw new Error("Cannot collect evidence for a future cutoff");
  }
  if (opts.budgetFile) {
    const [{ readFile }, { collectionBudgetSchema }] = await Promise.all([
      import("node:fs/promises"),
      import("./cn/evidence.js"),
    ]);
    collectionBudgetSchema.parse(JSON.parse(await readFile(opts.budgetFile, "utf8")));
  }
  const { loadCnPolicy } = await import("./policy/loader.js");
  await loadCnPolicy(path.join(opts.spec ?? DEFAULT_POLICY_DIR, "cn-screening.yaml"));
}
async function runCnEvidence(
  opts: RunOptions,
  output: string,
  automaticIdentity: boolean,
): Promise<boolean> {
  if (!automaticIdentity && Boolean(opts.input) === Boolean(opts.collectFrom))
    throw new Error("CN screening requires exactly one of --input or --collect-from");
  const { runEvidenceSnapshot, openEvidenceRun } = await import("./cn/run-archive.js");
  const policyFile = path.join(opts.spec ?? DEFAULT_POLICY_DIR, "cn-screening.yaml");
  let input = opts.input ?? opts.collectFrom,
    interrupted = false;
  const controller = new AbortController(),
    stop = () => {
      interrupted = true;
      controller.abort();
    };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (automaticIdentity) {
      const { collectCnUniverse } = await import("./cn/sources/listings.js");
      input = (
        await collectCnUniverse(`${output}.identity`, {
          ...defaultCnUniverseBudget,
          signal: controller.signal,
        })
      ).inputFile;
    }
    if (opts.collectFrom || automaticIdentity) {
      const { collectCnEvidence } = await import("./cn/collection.js");
      const budget = opts.budgetFile
        ? JSON.parse(await (await import("node:fs/promises")).readFile(opts.budgetFile, "utf8"))
        : undefined;
      input = (
        await collectCnEvidence(input!, `${output}.collection`, {
          asOf: opts.asOf,
          cacheFile: opts.cacheFrom,
          annualCacheDays:
            opts.annualCacheDays === undefined ? undefined : Number(opts.annualCacheDays),
          budget,
          concurrency: Number(opts.enrichConcurrency),
          signal: controller.signal,
          policyFile,
          evaluateAll: opts.evaluateAll,
          strategy: opts.strategy,
          pdfFallback: opts.pdf,
        })
      ).inputFile;
    } else if (opts.budgetFile || opts.asOf)
      throw new Error("--budget-file/--as-of requires --collect-from or automatic CN collection");
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  await runEvidenceSnapshot(input!, output, {
    policyFile,
    displayLimit: opts.limit === undefined ? undefined : Number(opts.limit),
    backupLimit:
      opts.backupLimit === undefined ? undefined : Number(opts.backupLimit),
    evaluateAll: opts.evaluateAll,
    strategy: opts.strategy,
  });
  const run = await openEvidenceRun(output);
  console.log(
    JSON.stringify(
      { output, status: run.manifest.status, selection: run.manifest.selection, ...run.summary },
      null,
      2,
    ),
  );
  if (interrupted) process.exitCode = 130;
  else if (run.manifest.status === "partial") process.exitCode = 2;
  return interrupted;
}

export async function runCli(argv: string[]): Promise<void> {
  // 包版本只有 package.json 一处来源；筛选政策与归档格式分别保留自己的标识。
  const packageMetadata = JSON.parse(
    await fs.readFile(path.join(CLI_ROOT, "package.json"), "utf8"),
  );
  const program = new Command();
  program
    .name("screener")
    .description("Market screener quantitative funnel CLI")
    .version(packageMetadata.version);

  program
    .command("validate")
    .argument("<specDir>", "Path to screening policy directory")
    .description("Validate spec YAML files")
    .action(async (specDir: string) => {
      const { validateSpecDir } = await import("./policy/loader.js");
      const result = await validateSpecDir(specDir);
      if (!result.ok) {
        for (const err of result.errors) console.error(err);
        process.exit(1);
      }
      console.log(`Spec OK (${result.fileCount} files)`);
    });

  program
    .command("universe")
    .description(
      "Freeze CN exchange identities without quotes (experimental; reports missing coverage)",
    )
    .requiredOption("--output <dir>", "New identity snapshot directory")
    .requiredOption("--max-requests <n>", "Identity request budget")
    .requiredOption("--max-ms <n>", "Identity collection deadline in milliseconds")
    .requiredOption("--request-ms <n>", "Per-request timeout in milliseconds")
    .action(
      async (opts: { output: string; maxRequests: string; maxMs: string; requestMs: string }) => {
        const { collectCnUniverse } = await import("./cn/sources/listings.js");
        const controller = new AbortController(),
          stop = () => controller.abort();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        try {
          const result = await collectCnUniverse(opts.output, {
            maxRequests: Number(opts.maxRequests),
            maxMs: Number(opts.maxMs),
            requestMs: Number(opts.requestMs),
            signal: controller.signal,
          });
          console.log(JSON.stringify(result, null, 2));
          if (result.status === "partial") process.exitCode = controller.signal.aborted ? 130 : 2;
        } finally {
          process.removeListener("SIGINT", stop);
          process.removeListener("SIGTERM", stop);
        }
      },
    );

  program
    .command("run")
    .description("Run quantitative funnel for one or more markets")
    .option("--markets <markets>", "Market scope: CN (default), US, or CN,US")
    .option("--quarter <quarter>", "Reporting quarter, e.g. 2026-Q2")
    .option("--output <dir>", "Output root directory")
    .option("--spec <dir>", "Path to screening policy directory")
    .option(
      "--adapter <kind>",
      "Legacy US adapter only: fixture (default) or live; CN uses bounded live collection or --input offline re-evaluation",
    )
    .option(
      "--policy <name>",
      "Policy: cn-screening (CN default) or template-screening (US); aliases: cn-quality, legacy",
    )
    .option(
      "--backup-limit <n>",
      "Independent CN NCAV/financial backup seats (default: 5)",
    )
    .option("--financial-lead-limit <n>", "Deprecated alias for --backup-limit; applies to all backups")
    .option("--input <path>", "Saved CN evidence snapshot JSON")
    .option("--collect-from <path>", "Collect bounded CN sources for a frozen identity input")
    .option(
      "--cache-from <path>",
      "Reuse verified CN annual statements from a saved input; refresh indicators, prices and shares",
    )
    .option(
      "--annual-cache-days <n>",
      "Annual statement refresh interval in days (default 30, 0 disables reuse, max 365)",
    )
    .option("--budget-file <path>", "Override the bounded CN collection budget with JSON")
    .option("--no-pdf", "Use structured sources only during CN collection")
    .option(
      "--as-of <date>",
      "Fixed evidence cutoff; omit to freeze actual live collection at completion",
    )
    .option(
      "--limit <n>",
      "Per-list display limit; full research and opportunity sets remain saved",
    )
    .option(
      "--strategy <name>",
      "CN strategy view: all (default), quality, financial, or ncav",
      "all",
    )
    .option(
      "--evaluate-all",
      "Evaluate later conditions for validation without bypassing base qualification",
      false,
    )
    .option(
      "--enrich-concurrency <n>",
      "Parallel CN evidence collection and legacy US enrichment",
      "4",
    )
    .option("--skip-cache", "Ignore enrichment disk cache", false)
    .action(async (opts: RunOptions) => {
      const markets = requestedMarkets(opts.markets),
        hasCn = markets.includes("CN"),
        hasUs = markets.includes("US"),
        mixed = hasCn && hasUs;
      // 旧命令名只在入口归一化，内部统一使用当前政策族名称。
      if (opts.policy === "cn-quality") opts.policy = "cn-screening";
      if (opts.policy === "legacy") opts.policy = "template-screening";
      if (opts.policy && !["template-screening", "cn-screening"].includes(opts.policy))
        throw new Error(`Unknown policy: ${opts.policy}`);
      if (opts.adapter !== undefined && !["fixture", "live"].includes(opts.adapter))
        throw new Error("--adapter must be fixture or live");
      if (opts.policy === "template-screening" && hasCn)
        throw new Error(
          "CN legacy screening is retired; use a saved historical archive with replay, explain, compare, or filter-breakdown.",
        );
      if (opts.policy === "cn-screening" && !hasCn)
        throw new Error(
          "cn-screening applies to CN only; run US without --policy or with --policy template-screening.",
        );
      if (mixed && !opts.quarter)
        throw new Error("CN,US runs require --quarter for the retained US legacy output.");
      if (hasUs && (!opts.quarter || !opts.output || !opts.spec))
        throw new Error("Legacy US run requires --quarter, --output and --spec");
      if (hasCn && opts.policy !== "template-screening") {
        await validateCnRunOptions(opts, hasUs);
        const automaticIdentity = !opts.input && !opts.collectFrom;
        const output = opts.output ?? path.join(DEFAULT_OUTPUT_DIR, `cn-${Date.now()}`);
        const interrupted = await runCnEvidence(
          opts,
          mixed ? path.join(output, opts.quarter!, "CN") : output,
          automaticIdentity,
        );
        if (!hasUs || interrupted) return;
      }
      if (!hasCn && opts.input) throw new Error("--input requires CN screening");
      if (
        !hasCn &&
        (opts.collectFrom ||
          opts.cacheFrom ||
          opts.annualCacheDays !== undefined ||
          opts.budgetFile ||
          opts.asOf ||
          opts.evaluateAll)
      )
        throw new Error("Evidence collection/validation options require CN screening");
      if (!opts.quarter || !opts.output || !opts.spec)
        throw new Error("Legacy US run requires --quarter, --output and --spec");
      const { runCommand } = await import("./us/screening.js");
      await runCommand({
        ...opts,
        markets: "US",
        quarter: opts.quarter,
        output: opts.output,
        spec: opts.spec,
        adapter: opts.adapter as "fixture" | "live" | undefined,
        enrichConcurrency: Number.parseInt(opts.enrichConcurrency, 10),
        skipCache: Boolean(opts.skipCache),
      });
    });

  program
    .command("compare")
    .argument("<left>", "Earlier saved evidence run")
    .argument("<right>", "Later saved evidence run")
    .description("Compare saved rule, data, route, quote and display changes without fetching")
    .action(async (left: string, right: string) => {
      const { compareEvidenceRuns } = await import("./cn/run-archive.js");
      console.log(JSON.stringify(await compareEvidenceRuns(left, right), null, 2));
    });

  program
    .command("candidates")
    .argument("<runDir>", "Saved CN evidence run")
    .option("--financial-leads", "Show the complete financial-discount qualification set")
    .option("--backups", "Show the complete independent backup qualification set")
    .description("View complete qualifications and main/backup display decisions without fetching")
    .action(async (runDir: string, opts: { financialLeads?: boolean; backups?: boolean }) => {
      const { openEvidenceRun } = await import("./cn/run-archive.js");
      const run = await openEvidenceRun(runDir);
      if (opts.financialLeads && opts.backups) throw new Error("Choose --backups or --financial-leads");
      const ids = opts.backups
        ? (run.summary.backupCandidates ?? run.summary.candidateQueue?.filter(r => r.tier === 3 && r.reason !== "duplicate_company").map(r => r.id) ?? [])
        : opts.financialLeads
        ? (run.summary.strategies?.financial_discount?.qualified ?? [])
        : (run.summary.candidateQueue?.map((r) => r.id) ?? run.summary.researchCandidates);
      const wanted = new Set(ids);
      const rows = [];
      for await (const { result } of run.records()) {
        const id = `${result.market}:${result.ticker}`;
        if (wanted.has(id))
          rows.push({
            id,
            companyName: result.companyName,
            ranking: result.researchRanking,
            selection: run.summary.candidateQueue?.find((r) => r.id === id),
            // Surface archived changes without interpreting missing data as stability.
            ...(result.recentFinancials ? { recentFinancials: result.recentFinancials } : {}),
            qualifications: Object.values(result.strategies ?? {})
              .filter((s) => s.state === "pass")
              .map((s) => s.id),
            ...(opts.financialLeads
              ? { financialDiscount: result.strategies?.financial_discount }
              : {}),
          });
      }
      const order = new Map(ids.map((id, i) => [id, i]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      console.log(
        JSON.stringify(
          { runId: run.manifest.runId, count: rows.length, candidates: rows },
          null,
          2,
        ),
      );
    });

  program
    .command("explain")
    .argument("<ticker>", "Ticker symbol")
    .option("--market <market>", "CN or US", "CN")
    .option("--fixture <path>", "Legacy JSON file with SecurityRecord(s)")
    .option("--spec <dir>", "Path to screening policy directory")
    .option("--from-run <dir>", "Saved evidence run directory")
    .description("Explain routing and funnel evaluation for one security")
    .action(
      async (
        ticker: string,
        opts: { market: string; fixture?: string; spec?: string; fromRun?: string },
      ) => {
        if (opts.fromRun) {
          const { openEvidenceRun, diagnoseEvidenceRun, explainCompanyCollectionDiagnostics } =
            await import("./cn/run-archive.js");
          const run = await openEvidenceRun(opts.fromRun);
          let selected: Awaited<ReturnType<ReturnType<typeof run.records>["next"]>>["value"];
          for await (const record of run.records())
            if (record.company.ticker === ticker && record.company.market === opts.market)
              selected = record;
          if (!selected) throw new Error(`Ticker not in saved run: ${opts.market}:${ticker}`);
          const { result, company } = selected;
          const facts = [...company.facts, ...(result.derivedFacts ?? [])];
          const diagnostics = await diagnoseEvidenceRun({
            ...run,
            input: {
              ...run.input,
              companies: [company],
              ...(run.input.collection
                ? {
                    collection: {
                      ...run.input.collection,
                      events: run.input.collection.events.filter(
                        (event) => event.ticker === ticker,
                      ),
                    },
                  }
                : {}),
            },
            records: async function* () {
              yield { company, result };
            },
          });
          console.log(
            JSON.stringify(
              {
                runId: run.manifest.runId,
                selection: run.summary.candidateQueue?.find(
                  (row) => row.id === `${result.market}:${result.ticker}`,
                ),
                result,
                facts,
                sources: run.input.sources,
                collectionDiagnostics: explainCompanyCollectionDiagnostics(diagnostics, ticker),
              },
              null,
              2,
            ),
          );
          return;
        }
        if (!opts.fixture || !opts.spec)
          throw new Error("Legacy explain requires --fixture and --spec; or use --from-run");
        const { explainCommand } = await import("./us/screening.js");
        await explainCommand({
          ticker,
          market: parseMarket(opts.market),
          fixture: opts.fixture,
          spec: opts.spec,
        });
      },
    );

  program
    .command("landmine")
    .description("Compute landmine prices from audit-summary shortlist")
    .requiredOption("--from <path>", "Path to audit-summary.yaml")
    .requiredOption("--output <path>", "Path to landmines.yaml output file")
    .option("--quarter <quarter>", "Reporting quarter metadata, e.g. 2026-Q2")
    .option("--spec <dir>", "Path to screening policy directory")
    .action(async (opts: { from: string; output: string; quarter?: string; spec?: string }) => {
      await landmineCommand({
        specDir: opts.spec,
        from: opts.from,
        output: opts.output,
        quarter: opts.quarter,
      });
    });

  program
    .command("filter-breakdown")
    .option("--from-run <dir>", "Saved evidence run directory")
    .description("Industry-grouped filter statistics from funnel output")
    .option(
      "--from-output <dir>",
      "US template market dir (e.g. /tmp/us-run/2026-Q2/US); alternative to --output + --quarter + --markets",
    )
    .option("--output <dir>", "Same root as screener run --output")
    .option("--quarter <quarter>", "Reporting quarter, e.g. 2026-Q1")
    .option("--markets <markets>", "CN or US (one market per invocation)")
    .option("--cache-dir <dir>", "Enrichment cache root", DEFAULT_CACHE_DIR)
    .option("--spec <dir>", "Spec directory (for --template-tracks)")
    .option("--template-tracks", "Append template-track rule failure breakdown", false)
    .option(
      "--stage <stages>",
      "Template-track stages (default: sector_filtered,deferred,candidate)",
    )
    .option("--template <templates>", "Filter template-track breakdown to template ids")
    .option("--track <tracks>", "Filter template-track breakdown to quality and/or mispricing")
    .option("--industry-l1 <name>", "Filter template-track breakdown to Shenwan L1")
    .option("--industry-l2 <name>", "Filter template-track breakdown to Shenwan L2")
    .option("--industry-l3 <name>", "Filter template-track breakdown to Shenwan L3")
    .option("--track-top <n>", "Max rows in template-track failure tables", "25")
    .option("--report <path>", "Override report file path")
    .option("--top-l2 <n>", "Max L2 industry rows", "25")
    .option("--top-l3 <n>", "Max L3 industry rows", "25")
    .option("--stdout", "Print report to stdout instead of writing a file", false)
    .action(
      async (opts: {
        fromOutput?: string;
        fromRun?: string;
        output?: string;
        quarter?: string;
        markets?: string;
        cacheDir: string;
        spec?: string;
        templateTracks: boolean;
        stage?: string;
        template?: string;
        track?: string;
        industryL1?: string;
        industryL2?: string;
        industryL3?: string;
        trackTop: string;
        report?: string;
        topL2: string;
        topL3: string;
        stdout: boolean;
      }) => {
        if (opts.fromRun) {
          const { openEvidenceRun, diagnoseEvidenceRun } = await import("./cn/run-archive.js");
          const run = await openEvidenceRun(opts.fromRun);
          console.log(
            JSON.stringify(
              { ...run.summary, diagnostics: await diagnoseEvidenceRun(run) },
              null,
              2,
            ),
          );
          return;
        }
        const { filterBreakdownCommand } = await import("./us/reports.js");
        await filterBreakdownCommand({
          fromOutput: opts.fromOutput,
          output: opts.output,
          quarter: opts.quarter,
          markets: opts.markets,
          cacheDir: opts.cacheDir,
          spec: opts.spec,
          templateTracks: Boolean(opts.templateTracks),
          stage: opts.stage,
          template: opts.template,
          track: opts.track,
          industryL1: opts.industryL1,
          industryL2: opts.industryL2,
          industryL3: opts.industryL3,
          trackTop: Number.parseInt(opts.trackTop, 10),
          report: opts.report,
          topL2: Number.parseInt(opts.topL2, 10),
          topL3: Number.parseInt(opts.topL3, 10),
          stdout: Boolean(opts.stdout),
        });
      },
    );

  program
    .command("replay")
    .argument("<runDir>", "Saved evidence run directory")
    .description("Verify source/artifact hashes and reproduce a saved run offline")
    .action(async (runDir: string) => {
      const { replayEvidenceRun } = await import("./cn/run-archive.js");
      console.log(JSON.stringify(await replayEvidenceRun(runDir)));
    });

  await program.parseAsync(argv);
}

// 独立价格观察：从审计摘要的公允价值与现价计算观察价。

interface ShortlistItem {
  ticker: string;
  market: "CN" | "US";
  passed_track?: "quality" | "mispricing";
  fair_value_bull_mean?: number;
  current_price?: number;
  currency?: string;
}

export interface LandmineCommandOptions {
  specDir?: string;
  from: string;
  output: string;
  quarter?: string;
}

export async function landmineCommand(opts: LandmineCommandOptions): Promise<void> {
  const [{ loadLandminePricing }, { parse: parseYaml, stringify: stringifyYaml }] =
    await Promise.all([import("./policy/loader.js"), import("yaml")]);
  const specDir = path.resolve(opts.specDir ?? DEFAULT_POLICY_DIR);
  const landminePricing = await loadLandminePricing(specDir);
  const formulas =
    (landminePricing as { formulas?: Record<string, { slug?: string }> }).formulas ?? {};
  const raw = parseYaml(await fs.readFile(path.resolve(opts.from), "utf8")) as {
    shortlist_for_landmine?: ShortlistItem[];
    quarter?: string;
  };

  const landmines = (raw.shortlist_for_landmine ?? []).map((item) => {
    const track = item.passed_track ?? "quality";
    const bull = item.fair_value_bull_mean ?? 0;
    const spot = item.current_price ?? bull;
    const formulaSlug =
      track === "mispricing"
        ? "landmine_mispricing_min_discount"
        : "landmine_quality_bull_mean_70pct";
    const price = track === "mispricing" ? Math.min(spot * 0.85, bull * 0.7) : bull * 0.7;

    return {
      ticker: item.ticker,
      market: item.market,
      landmine_price: price,
      currency: item.currency ?? (item.market === "CN" ? "CNY" : "USD"),
      basis:
        formulas[track === "quality" ? "quality_track" : "mispricing_track"]?.slug ?? formulaSlug,
      passed_track: track,
      fair_value_reference: bull,
      current_price: spot,
      formula_slug: formulaSlug,
    };
  });

  const doc = {
    quarter: opts.quarter ?? raw.quarter ?? "unknown",
    generated_at: new Date().toISOString(),
    landmines,
  };

  const outputPath = path.resolve(opts.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stringifyYaml(doc), "utf8");
}

// Importable by tests; npm bin symlinks resolve to this same executable module.
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
