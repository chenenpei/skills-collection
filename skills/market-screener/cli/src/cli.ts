import { Command } from "commander";
import { parseMarket } from "./lib/markets.js";

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

  await program.parseAsync(argv);
}
