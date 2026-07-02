import type { SecurityRecord } from "../../../domain/types.js";
import type { DataConfidence, MetricValue } from "../../../domain/types.js";
import type { BankScrapeMetrics } from "./types.js";

export function isCnBankIndustry(industryProxy: string | undefined): boolean {
  if (!industryProxy) return false;
  return industryProxy.includes("银行");
}

export function applyBankScrapeToRecord(
  record: SecurityRecord,
  scrape: { metrics: BankScrapeMetrics; dataConfidence: DataConfidence; sourceUrls: string[] }
): SecurityRecord {
  const metrics = { ...record.metrics };
  for (const [key, value] of Object.entries(scrape.metrics)) {
    if (value === undefined) continue;
    metrics[key] = { value, dataConfidence: scrape.dataConfidence } satisfies MetricValue;
  }
  return {
    ...record,
    metrics,
    auditHints: [
      ...(record.auditHints ?? []),
      `bank_disclosure_scrape:${scrape.sourceUrls.join(",")}`,
    ],
  };
}
