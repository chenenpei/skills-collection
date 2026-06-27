import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { BankBulletinEntry } from "./types.js";

type BulletinYamlEntry = {
  ticker: string;
  name: string;
  sina_url: string;
  pdf_url: string;
  pdf_tier: BankBulletinEntry["pdfTier"];
};

type BulletinYaml = {
  version: string;
  fiscal_year: number;
  entries: BulletinYamlEntry[];
};

const DEFAULT_SPEC_DIR = path.resolve(import.meta.dirname, "../../../../../spec");

let cachedBySpecDir = new Map<string, Map<string, BankBulletinEntry>>();

function loadBulletinMap(specDir: string): Map<string, BankBulletinEntry> {
  const cached = cachedBySpecDir.get(specDir);
  if (cached) return cached;

  const yamlPath = path.join(specDir, "data", "cn-bank-bulletins.yaml");
  const raw = fs.readFileSync(yamlPath, "utf8");
  const doc = parseYaml(raw) as BulletinYaml;
  const map = new Map<string, BankBulletinEntry>();

  for (const entry of doc.entries) {
    const key = `${entry.ticker}:${doc.fiscal_year}`;
    map.set(key, {
      ticker: entry.ticker,
      fiscalYear: doc.fiscal_year,
      name: entry.name,
      sinaUrl: entry.sina_url,
      pdfUrl: entry.pdf_url,
      pdfTier: entry.pdf_tier,
    });
  }

  cachedBySpecDir.set(specDir, map);
  return map;
}

export function loadBankBulletin(
  ticker: string,
  fiscalYear: number,
  specDir: string = DEFAULT_SPEC_DIR
): BankBulletinEntry | undefined {
  return loadBulletinMap(specDir).get(`${ticker}:${fiscalYear}`);
}
