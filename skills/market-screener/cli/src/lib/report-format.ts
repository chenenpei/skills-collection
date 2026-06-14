export function pct(count: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

export function sortedEntries(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
