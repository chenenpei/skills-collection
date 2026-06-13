import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { DEFAULT_SPEC_DIR } from "../paths.js";
import { loadSpecBundle } from "../spec/loader.js";

interface ShortlistItem {
  ticker: string;
  market: "CN" | "US";
  passed_track?: "quality" | "mispricing";
  fair_value_bull_mean?: number;
  current_price?: number;
  currency?: string;
}

export interface LandmineCommandOptions {
  specDir?: string;
  from: string;
  output: string;
  quarter?: string;
}

export async function landmineCommand(opts: LandmineCommandOptions): Promise<void> {
  const specDir = path.resolve(opts.specDir ?? DEFAULT_SPEC_DIR);
  const bundle = await loadSpecBundle(specDir);
  const formulas =
    (bundle.landmineRules as { formulas?: Record<string, { slug?: string }> }).formulas ?? {};
  const raw = parseYaml(await fs.readFile(path.resolve(opts.from), "utf8")) as {
    shortlist_for_landmine?: ShortlistItem[];
    quarter?: string;
  };

  const landmines = (raw.shortlist_for_landmine ?? []).map((item) => {
    const track = item.passed_track ?? "quality";
    const bull = item.fair_value_bull_mean ?? 0;
    const spot = item.current_price ?? bull;
    const formulaSlug =
      track === "mispricing"
        ? "landmine_mispricing_min_discount"
        : "landmine_quality_bull_mean_70pct";
    const price =
      track === "mispricing" ? Math.min(spot * 0.85, bull * 0.7) : bull * 0.7;

    return {
      ticker: item.ticker,
      market: item.market,
      landmine_price: price,
      currency: item.currency ?? (item.market === "CN" ? "CNY" : "USD"),
      basis:
        formulas[track === "quality" ? "quality_track" : "mispricing_track"]?.slug ?? formulaSlug,
      passed_track: track,
      fair_value_reference: bull,
      current_price: spot,
      formula_slug: formulaSlug,
      expiry: "GTC",
      notes: "Manual broker order only",
    };
  });

  const doc = {
    quarter: opts.quarter ?? raw.quarter ?? "unknown",
    generated_at: new Date().toISOString(),
    landmines,
  };

  const outputPath = path.resolve(opts.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stringifyYaml(doc), "utf8");
}
