import { Command } from "commander";
import { parseMarket } from "./lib/markets.js";
import { DEFAULT_CACHE_DIR } from "./lib/paths.js";

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("screener")
    .description("Market screener quantitative funnel CLI")
    .version("0.1.0");

  program
    .command("validate")
    .argument("<specDir>", "Path to spec directory")
    .description("Validate spec YAML files")
    .action(async (specDir: string) => {
      const { validateSpecDir } = await import("./commands/validate.js");
      const result = await validateSpecDir(specDir);
      if (!result.ok) {
        for (const err of result.errors) console.error(err);
        process.exit(1);
      }
      console.log(`Spec OK (${result.fileCount} files)`);
    });

  program
    .command("run")
    .description("Run quantitative funnel for one or more markets")
    .requiredOption("--markets <markets>", "Market scope: CN, US, or CN,US")
    .requiredOption("--quarter <quarter>", "Reporting quarter, e.g. 2026-Q2")
    .requiredOption("--output <dir>", "Output root directory")
    .requiredOption("--spec <dir>", "Path to spec directory")
    .option("--adapter <kind>", "Data adapter: fixture or live", "fixture")
    .option(
      "--enrich-concurrency <n>",
      "Parallel enrichment tickers (each may issue 2 HTTP calls)",
      "4"
    )
    .option("--skip-cache", "Ignore enrichment disk cache", false)
    .action(async (opts: {
      markets: string;
      quarter: string;
      output: string;
      spec: string;
      adapter: "fixture" | "live";
      enrichConcurrency: string;
      skipCache: boolean;
    }) => {
      const { runCommand } = await import("./commands/run.js");
      await runCommand({
        ...opts,
        enrichConcurrency: Number.parseInt(opts.enrichConcurrency, 10),
        skipCache: Boolean(opts.skipCache),
      });
    });

  program
    .command("explain")
    .argument("<ticker>", "Ticker symbol")
    .requiredOption("--market <market>", "CN or US")
    .requiredOption("--fixture <path>", "JSON file with SecurityRecord(s)")
    .requiredOption("--spec <dir>", "Path to spec directory")
    .description("Explain routing and funnel evaluation for one security")
    .action(async (
      ticker: string,
      opts: { market: string; fixture: string; spec: string }
    ) => {
      const { explainCommand } = await import("./commands/explain.js");
      await explainCommand({
        ticker,
        market: parseMarket(opts.market),
        fixture: opts.fixture,
        spec: opts.spec,
      });
    });

  program
    .command("landmine")
    .description("Compute landmine prices from audit-summary shortlist")
    .requiredOption("--from <path>", "Path to audit-summary.yaml")
    .requiredOption("--output <path>", "Path to landmines.yaml output file")
    .option("--quarter <quarter>", "Reporting quarter metadata, e.g. 2026-Q2")
    .option("--spec <dir>", "Path to spec directory")
    .action(async (opts: { from: string; output: string; quarter?: string; spec?: string }) => {
      const { landmineCommand } = await import("./commands/landmine.js");
      await landmineCommand({
        specDir: opts.spec,
        from: opts.from,
        output: opts.output,
        quarter: opts.quarter,
      });
    });

  program
    .command("filter-breakdown")
    .description("Industry-grouped filter statistics from funnel output")
    .option(
      "--from-output <dir>",
      "Funnel market dir (e.g. funnel-output/2026-Q1/CN); alternative to --output + --quarter + --markets"
    )
    .option("--output <dir>", "Same root as screener run --output")
    .option("--quarter <quarter>", "Reporting quarter, e.g. 2026-Q1")
    .option("--markets <markets>", "CN or US (one market per invocation)")
    .option("--cache-dir <dir>", "Enrichment cache root", DEFAULT_CACHE_DIR)
    .option("--spec <dir>", "Spec directory (for --template-tracks)")
    .option("--template-tracks", "Append template-track rule failure breakdown", false)
    .option(
      "--stage <stages>",
      "Template-track stages (default: sector_filtered,deferred,candidate)"
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
    .action(async (opts: {
      fromOutput?: string;
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
      const { filterBreakdownCommand } = await import("./commands/filter-breakdown.js");
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
    });

  await program.parseAsync(argv);
}
