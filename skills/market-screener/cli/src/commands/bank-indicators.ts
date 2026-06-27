import { scrapeBankIndicators } from "../data/cn/bank-indicators/index.js";

export async function bankIndicatorsCommand(opts: {
  ticker: string;
  year: number;
  spec: string;
}): Promise<void> {
  const result = await scrapeBankIndicators(opts.ticker, opts.year, opts.spec);
  console.log(JSON.stringify(result, null, 2));
  if (!result) process.exit(1);
}
