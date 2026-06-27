import { loadBankBulletin } from "./bulletin-map.js";
import { extractBankMetricsFromText } from "./extract.js";
import { fetchDisclosureTexts } from "./fetch.js";
import { mergeBankScrapeSources } from "./merge.js";
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
  fiscalYear: number,
  specDir: string
): Promise<BankScrapeResult | undefined> {
  const entry = loadBankBulletin(ticker, fiscalYear, specDir);
  if (!entry) return undefined;

  const { sinaText, pdfText } = await fetchDisclosureTexts(entry);
  const sinaExtract = extractBankMetricsFromText(sinaText);
  const pdfExtract = extractBankMetricsFromText(pdfText);
  const metrics = mergeBankScrapeSources(sinaExtract.metrics, pdfExtract.metrics);
  const missing = TRACKED_FIELDS.filter((k) => metrics[k] === undefined);
  const rawHits = { ...sinaExtract.rawHits, ...pdfExtract.rawHits };

  return {
    ticker,
    fiscalYear,
    metrics,
    rawHits,
    missing: [...missing],
    sourceUrls: [entry.sinaUrl, entry.pdfUrl],
    dataConfidence: missing.length <= 1 ? "medium" : "low",
    scrapedAt: new Date().toISOString(),
  };
}

export { extractBankMetricsFromText } from "./extract.js";
export { mergeBankScrapeSources } from "./merge.js";
export { loadBankBulletin } from "./bulletin-map.js";
export { fetchDisclosureTexts } from "./fetch.js";
export type {
  BankBulletinEntry,
  BankScrapeField,
  BankScrapeMetrics,
  BankScrapeResult,
} from "./types.js";
