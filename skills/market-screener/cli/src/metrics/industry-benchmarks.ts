import type { SecurityRecord } from "../engine/kill-gates.js";

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function applyIndustryBenchmarks(records: SecurityRecord[]): SecurityRecord[] {
  const groups = new Map<string, SecurityRecord[]>();

  for (const record of records) {
    const key = `${record.market}::${record.industryProxy ?? "unknown"}`;
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const grossMedians = new Map<string, number>();
  for (const [key, group] of groups) {
    const margins = group
      .map((r) => r.metrics.gross_margin?.value)
      .filter((v): v is number => v !== undefined);
    grossMedians.set(key, median(margins));
  }

  return records.map((record) => {
    const key = `${record.market}::${record.industryProxy ?? "unknown"}`;
    const gm = record.metrics.gross_margin?.value;
    const med = grossMedians.get(key);
    if (gm === undefined || med === undefined) return record;

    return {
      ...record,
      metrics: {
        ...record.metrics,
        gross_margin_vs_industry: {
          value: gm - med,
          dataConfidence: "medium" as const,
        },
        operating_margin_vs_industry: {
          value: (record.metrics.roe_ttm?.value ?? gm) - (med * 0.6),
          dataConfidence: "medium" as const,
        },
      },
    };
  });
}
