import { scrapeBankIndicators } from "../data/cn/bank-indicators/scrape.js";

export async function bankIndicatorsCommand(opts: {
  ticker: string;
  year: number;
}): Promise<void> {
  const result = await scrapeBankIndicators(opts.ticker, opts.year);
  if (!result) {
    console.error(`No regulatory metrics scraped for ${opts.ticker} FY${opts.year}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
