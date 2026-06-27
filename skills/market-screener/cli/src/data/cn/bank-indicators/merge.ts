import type { BankScrapeField, BankScrapeMetrics } from "./types.js";

const SCRAPE_FIELDS: BankScrapeField[] = [
  "npl_ratio",
  "provision_coverage",
  "capital_adequacy",
  "nim",
  "roa",
];

export function mergeBankScrapeSources(
  sina: BankScrapeMetrics,
  pdf: BankScrapeMetrics
): BankScrapeMetrics {
  const out: BankScrapeMetrics = {};
  for (const key of SCRAPE_FIELDS) {
    const s = sina[key];
    const p = pdf[key];
    if (key === "capital_adequacy") {
      const vals = [s, p].filter((v): v is number => v !== undefined);
      if (vals.length) out[key] = Math.max(...vals);
    } else {
      const val = p ?? s;
      if (val !== undefined) out[key] = val;
    }
  }
  return out;
}
