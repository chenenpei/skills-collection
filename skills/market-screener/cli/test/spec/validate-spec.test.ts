import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import { validateSpecBundle } from "../../src/spec/validate-spec.js";
import { templateLiveViability } from "../../src/spec/policy.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("validateSpecBundle", () => {
  it("passes on repo spec", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    const result = validateSpecBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("loads semantic routing spec files from index", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    expect(bundle.index.machine_rules?.routing).toEqual({
      us: "routing-us.yaml",
      cn: "routing-cn.yaml",
    });
    expect(bundle.routing.us.mappings.length).toBeGreaterThan(0);
    expect(bundle.routing.cn?.l1_defaults?.银行?.template).toBe("financials");
  });

  it("loads semantic policy files from index", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    expect(bundle.index.machine_rules).toMatchObject({
      exclusions: "exclusion-rules.yaml",
      metrics: "metric-policy.yaml",
      selection: "selection-policy.yaml",
      landmine_pricing: "landmine-pricing.yaml",
    });
    expect(bundle.exclusionRules.gates.some((gate) => gate.reason_slug === "kill_market_cap_below_floor")).toBe(true);
    expect(bundle.metricPolicy.template_live_viability?.financials).toBeTruthy();
    expect(bundle.selectionPolicy.funnel_soft_cap?.max_candidates_per_market).toBe(20);
    expect(bundle.landminePricing.formulas?.quality_track?.slug).toBe("landmine_quality_bull_mean_70pct");
  });

  it("financials.banks quality required includes roe_ttm not rotce", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    const banks = bundle.templates.financials.sub_templates.banks;
    const required = banks.quality_track.required as Record<string, unknown>;
    expect(required).toHaveProperty("roe_ttm");
    expect(required).not.toHaveProperty("rotce");
  });

  it("financials.banks viability is proxy after enrich decision", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    expect(templateLiveViability(bundle, "financials", "banks")).toBe("proxy");
  });

  it("fails when index references missing template", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    const invalid = {
      ...bundle,
      index: {
        ...bundle.index,
        templates: [...bundle.index.templates, { id: "ghost", file: "templates/ghost.yaml" }],
      },
    };
    const result = validateSpecBundle(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("ghost"))).toBe(true);
  });
});
