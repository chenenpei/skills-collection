import { normalizeCjkText } from "./normalize.js";
import type { BankScrapeField, BankScrapeMetrics } from "./types.js";

export const SANITY_BOUNDS: Record<BankScrapeField, [number, number]> = {
  npl_ratio: [0.003, 0.05],
  provision_coverage: [0.5, 5.0],
  capital_adequacy: [0.08, 0.25],
  nim: [0.005, 0.04],
  roa: [0.002, 0.025],
};

const DEC = String.raw`(\d+\.\d+)`;

const PATTERNS: Record<BankScrapeField, RegExp[]> = {
  npl_ratio: [
    new RegExp(String.raw`不良贷款率(?:\(\d+\)|（\d+）)?[^0-9]{0,30}${DEC}\s*%`, "gi"),
    new RegExp(String.raw`不良率[^0-9]{0,20}${DEC}\s*%`, "gi"),
    new RegExp(String.raw`不良贷款率[^0-9]{0,12}${DEC}\s*%?`, "gi"),
  ],
  provision_coverage: [
    new RegExp(String.raw`拨备覆盖率\s*${DEC}\s*%`, "gi"),
    new RegExp(String.raw`拨备覆盖率(?:\(\d+\)|（\d+）)?[^0-9]{0,12}${DEC}\s*%`, "gi"),
    new RegExp(String.raw`拨备覆盖率(?:\(\d+\)|（\d+）)\s*${DEC}`, "gi"),
  ],
  capital_adequacy: [
    new RegExp(String.raw`资本充足率达到${DEC}\s*%`, "gi"),
    new RegExp(String.raw`(?<!核心一级)(?<!一级)资本充足率\s*${DEC}(?:\s|%|$)`, "gi"),
    new RegExp(
      String.raw`(?<!核心一级)(?<!一级)资本充足率(?:\(\d+\)|（\d+）)?[^0-9]{0,30}${DEC}\s*%`,
      "gi"
    ),
    new RegExp(String.raw`(?<!核心一级)(?<!一级)资本充足率[^0-9]{0,12}${DEC}\s*%`, "gi"),
  ],
  nim: [
    new RegExp(String.raw`净息差(?:\(\d+\)|（\d+）)?[^0-9]{0,30}${DEC}\s*%`, "gi"),
    new RegExp(String.raw`净利息差[^0-9]{0,30}${DEC}\s*%`, "gi"),
    new RegExp(String.raw`净利息收益率[^0-9]{0,30}${DEC}\s*%`, "gi"),
    new RegExp(String.raw`净息差[^0-9]{0,12}${DEC}\s*%?`, "gi"),
  ],
  roa: [
    new RegExp(String.raw`平均总资产收益率[^0-9]{0,30}${DEC}\s*%?`, "gi"),
    new RegExp(
      String.raw`平均总资产回报率(?:\(ROA\)|（ROA）|（ROAA）|\(ROAA\))?[^0-9]{0,20}${DEC}\s*%?`,
      "gi"
    ),
    new RegExp(String.raw`平均资产回报率[^0-9]{0,30}${DEC}\s*%?`, "gi"),
    new RegExp(String.raw`总资产收益率[^0-9]{0,30}${DEC}\s*%?`, "gi"),
  ],
};

const COMPACT_LABELS: Partial<Record<BankScrapeField, string>> = {
  npl_ratio: "不良贷款率",
  provision_coverage: "拨备覆盖率",
  capital_adequacy: "资本充足率",
  nim: "净息差",
  roa: "平均总资产收益率",
};

export function pctToDecimal(raw: string): number {
  return parseFloat(raw) / 100;
}

function saneValue(key: BankScrapeField, decimal: number): boolean {
  const [lo, hi] = SANITY_BOUNDS[key];
  return lo <= decimal && decimal <= hi;
}

function allPctMatches(patterns: RegExp[], text: string): number[] {
  const out: number[] = [];
  for (const pat of patterns) {
    for (const m of text.matchAll(pat)) {
      out.push(pctToDecimal(m[1]!));
    }
  }
  return out;
}

function firstMatch(patterns: RegExp[], text: string): string | undefined {
  for (const pat of patterns) {
    const m = pat.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

function compactLabelMatch(label: string, text: string): string | undefined {
  const pat = new RegExp(String.raw`${label}(?:\(\d+\))?\s*[:：]?\s*(\d+\.\d+)\s*%?`);
  const m = pat.exec(text);
  return m?.[1];
}

function tableSeriesAfterLabel(
  label: string,
  text: string,
  key: BankScrapeField
): string | undefined {
  const labelPat = new RegExp(String.raw`${label}[^0-9]{0,40}`, "g");
  for (const m of text.matchAll(labelPat)) {
    const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 80);
    for (const num of tail.match(/\d+\.\d+/g) ?? []) {
      if (saneValue(key, pctToDecimal(num))) return num;
    }
  }
  return undefined;
}

function accept(key: BankScrapeField, raw: string): boolean {
  return saneValue(key, pctToDecimal(raw));
}

export function extractBankMetricsFromText(text: string): {
  metrics: BankScrapeMetrics;
  rawHits: Partial<Record<BankScrapeField, string>>;
  missing: BankScrapeField[];
} {
  const normalized = normalizeCjkText(text);
  const metrics: BankScrapeMetrics = {};
  const rawHits: Partial<Record<BankScrapeField, string>> = {};
  const missing: BankScrapeField[] = [];

  for (const key of Object.keys(PATTERNS) as BankScrapeField[]) {
    const pats = PATTERNS[key];

    if (key === "capital_adequacy") {
      const matches = allPctMatches(pats, normalized);
      const filtered = matches.filter((v) => v >= 0.09 && saneValue(key, v));
      if (filtered.length) {
        const val = Math.max(...filtered);
        metrics[key] = val;
        rawHits[key] = String(val * 100);
        continue;
      }
      const label = COMPACT_LABELS[key]!;
      const raw =
        compactLabelMatch(label, normalized) ??
        tableSeriesAfterLabel(label, normalized, key);
      if (raw && accept(key, raw)) {
        metrics[key] = pctToDecimal(raw);
        rawHits[key] = raw;
        continue;
      }
      missing.push(key);
      continue;
    }

    let raw = firstMatch(pats, normalized);
    const compactLabel = COMPACT_LABELS[key];
    if (raw === undefined && compactLabel) {
      const candidate = compactLabelMatch(compactLabel, normalized);
      if (candidate && accept(key, candidate)) raw = candidate;
    }
    if (raw === undefined && key === "roa") {
      for (const label of ["平均总资产回报率", "平均总资产收益率", "平均资产回报率"]) {
        const candidate =
          compactLabelMatch(label, normalized) ??
          tableSeriesAfterLabel(label, normalized, key);
        if (candidate && accept(key, candidate)) {
          raw = candidate;
          break;
        }
      }
    }
    if (raw === undefined && compactLabel) {
      const candidate = tableSeriesAfterLabel(compactLabel, normalized, key);
      if (candidate && accept(key, candidate)) raw = candidate;
    }
    if (raw === undefined || !accept(key, raw)) {
      missing.push(key);
      continue;
    }
    rawHits[key] = raw;
    metrics[key] = pctToDecimal(raw);
  }

  return { metrics, rawHits, missing };
}
