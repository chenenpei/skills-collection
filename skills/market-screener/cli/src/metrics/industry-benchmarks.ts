import type { SecurityRecord } from "../engine/kill-gates.js";

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function industryGroupKey(record: SecurityRecord): string {
  return `${record.market}::${record.industryProxy ?? "unknown"}`;
}

function metricValues(
  group: SecurityRecord[],
  key: string
): number[] {
  return group
    .map((r) => r.metrics[key]?.value)
    .filter((v): v is number => v !== undefined);
}

export function applyIndustryBenchmarks(records: SecurityRecord[]): SecurityRecord[] {
  const groups = new Map<string, SecurityRecord[]>();

  for (const record of records) {
    const key = industryGroupKey(record);
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const grossMedians = new Map<string, number>();
  const operatingMedians = new Map<string, number>();
  for (const [key, group] of groups) {
    grossMedians.set(key, median(metricValues(group, "gross_margin")));
    operatingMedians.set(key, median(metricValues(group, "operating_margin")));
  }

  return records.map((record) => {
    const key = industryGroupKey(record);
    const gm = record.metrics.gross_margin?.value;
    const om = record.metrics.operating_margin?.value;
    const grossMed = grossMedians.get(key);
    const opMed = operatingMedians.get(key);

    const metrics = { ...record.metrics };
    if (gm !== undefined && grossMed !== undefined) {
      metrics.gross_margin_vs_industry = {
        value: gm - grossMed,
        dataConfidence: "medium" as const,
      };
    }
    if (om !== undefined && opMed !== undefined) {
      metrics.operating_margin_vs_industry = {
        value: om - opMed,
        dataConfidence: "medium" as const,
      };
    }

    if (metrics.gross_margin_vs_industry === undefined && metrics.operating_margin_vs_industry === undefined) {
      return record;
    }

    return { ...record, metrics };
  });
}
