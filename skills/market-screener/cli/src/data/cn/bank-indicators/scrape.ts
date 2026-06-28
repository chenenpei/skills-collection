import { discoverBankBulletin } from "./discover.js";
import { extractBankMetricsFromText } from "./extract.js";
import { fetchDisclosureTexts, mergeBankScrapeSources } from "./fetch.js";
import type { BankScrapeField, BankScrapeResult } from "./types.js";

const TRACKED_FIELDS: BankScrapeField[] = [
  "npl_ratio",
  "provision_coverage",
  "capital_adequacy",
  "roa",
  "nim",
];

export async function scrapeBankIndicators(
  ticker: string,
  fiscalYear: number
): Promise<BankScrapeResult | undefined> {
  let entry;
  try {
    entry = await discoverBankBulletin(ticker, fiscalYear);
  } catch {
    return undefined;
  }

  const { sinaText, pdfText } = await fetchDisclosureTexts(entry);
  const sinaExtract = extractBankMetricsFromText(sinaText);
  const pdfExtract = extractBankMetricsFromText(pdfText);
  const metrics = mergeBankScrapeSources(sinaExtract.metrics, pdfExtract.metrics);
  const missing = TRACKED_FIELDS.filter((k) => metrics[k] === undefined);

  return {
    ticker,
    fiscalYear,
    metrics,
    rawHits: { ...sinaExtract.rawHits, ...pdfExtract.rawHits },
    missing: [...missing],
    sourceUrls: [entry.sinaUrl, entry.pdfUrl].filter((url): url is string => url !== undefined),
    dataConfidence: missing.length <= 1 ? "medium" : "low",
    scrapedAt: new Date().toISOString(),
    bulletinTitle: entry.name,
  };
}
