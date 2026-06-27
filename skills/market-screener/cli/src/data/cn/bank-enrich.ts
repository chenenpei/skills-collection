import type { SecurityRecord } from "../../funnel/kill-gates.js";
import type { BankScrapeMetrics } from "./bank-indicators/types.js";
import type { DataConfidence, MetricValue } from "../../funnel/types.js";

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
