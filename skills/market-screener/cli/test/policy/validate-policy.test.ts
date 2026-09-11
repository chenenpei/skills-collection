import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadCnPolicy, loadLandminePricing, loadSpecBundle } from "../../src/policy/loader.js";
import { validateSpecBundle, validateSpecDir } from "../../src/policy/loader.js";
import fs from "node:fs/promises";
import os from "node:os";
import { parse, stringify } from "yaml";
import { templateLiveViability } from "../../src/policy/loader.js";

const POLICY_DIR = path.resolve(import.meta.dirname, "../../src/policy");

describe("validateSpecBundle", () => {
  it("loads landmine pricing without parsing the compact bundle", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "screener-landmine-"));
    try {
      await fs.writeFile(path.join(directory, "landmine.yaml"), "formulas:\n  quality_track:\n    slug: standalone\n");
      await expect(loadLandminePricing(directory)).resolves.toEqual({
        formulas: { quality_track: { slug: "standalone" } },
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("continues to load a minimal external index.yaml override", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "screener-policy-override-"));
    try {
      await Promise.all([
        fs.writeFile(path.join(directory, "index.yaml"), [
          "version: 0.1.0", "status: active", "tightening_profile: test", "templates: []",
          "machine_rules:", "  exclusions: exclusions.yaml", "  metrics: metrics.yaml",
          "  selection: selection.yaml", "  routing: { us: routing.yaml, cn: '' }", "  landmine_pricing: landmine.yaml",
        ].join("\n")),
        fs.writeFile(path.join(directory, "exclusions.yaml"), "version: 0.1.0\nuniverse: {}\ngates: []\n"),
        fs.writeFile(path.join(directory, "routing.yaml"), "version: 0.1.0\nmappings: []\n"),
        fs.writeFile(path.join(directory, "metrics.yaml"), "{}\n"),
        fs.writeFile(path.join(directory, "selection.yaml"), "{}\n"),
        fs.writeFile(path.join(directory, "landmine.yaml"), "formulas: {}\n"),
      ]);
      const bundle = await loadSpecBundle(directory);
      expect(bundle.index.tightening_profile).toBe("test");
      expect(bundle.routing.cn).toBeUndefined();
      await fs.writeFile(path.join(directory, "template-screening.yaml"), "routing: [\n");
      await expect(loadSpecBundle(directory)).rejects.toMatchObject({ name: "YAMLParseError" });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("validates the current CN policy alongside the retained template bundle", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-spec-"));
    try {
      await fs.cp(POLICY_DIR, dir, { recursive: true });
      expect((await validateSpecDir(dir)).ok).toBe(true);
      const current = await loadCnPolicy(path.join(dir, "cn-screening.yaml"));
      const templates = await loadSpecBundle(dir);
      await fs.rename(path.join(dir, "cn-screening.yaml"), path.join(dir, "cn-quality.yaml"));
      await fs.rename(path.join(dir, "template-screening.yaml"), path.join(dir, "legacy.yaml"));
      expect(await loadCnPolicy(path.join(dir, "cn-screening.yaml"))).toEqual(current);
      expect(await loadSpecBundle(dir)).toEqual(templates);
      expect((await validateSpecDir(dir)).ok).toBe(true);
      const policyFile = path.join(dir, "cn-screening.yaml");
      await fs.copyFile(path.join(dir, "cn-quality.yaml"), policyFile);
      const policy = parse(await fs.readFile(policyFile, "utf8"));
      policy.quality.roeMedian = 0;
      await fs.writeFile(policyFile, stringify(policy));
      const invalid = await validateSpecDir(dir);
      expect(invalid.ok).toBe(false);
      // The valid old file must not mask an invalid preferred file.
      await expect(loadCnPolicy(policyFile)).rejects.toThrow();
      expect(invalid.errors.some(error => error.startsWith("cn-screening.yaml:") && error.includes('"roeMedian"'))).toBe(true);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it("passes on repo spec", async () => {
    const bundle = await loadSpecBundle(POLICY_DIR);
    const result = validateSpecBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("loads routing policy from the compact bundle", async () => {
    const bundle = await loadSpecBundle(POLICY_DIR);
    expect(bundle.routing.us.mappings.length).toBeGreaterThan(0);
    expect(bundle.routing.cn?.l1_defaults?.银行?.template).toBe("financials");
  });

  it("preserves the policy sections in the compact bundle", async () => {
    const bundle = await loadSpecBundle(POLICY_DIR);
    expect(bundle.exclusionRules.gates.some((gate) => gate.reason_slug === "kill_market_cap_below_floor")).toBe(true);
    expect(bundle.metricPolicy.template_live_viability?.financials).toBeTruthy();
    expect(bundle.selectionPolicy.funnel_soft_cap?.max_candidates_per_market).toBe(20);
    expect(bundle.landminePricing.formulas?.quality_track?.slug).toBe("landmine_quality_bull_mean_70pct");
  });

  it("financials.banks quality required includes roe_ttm not rotce", async () => {
    const bundle = await loadSpecBundle(POLICY_DIR);
    const banks = bundle.templates.financials.sub_templates.banks;
    const required = banks.quality_track.required as Record<string, unknown>;
    expect(required).toHaveProperty("roe_ttm");
    expect(required).not.toHaveProperty("rotce");
  });

  it("financials.banks viability is proxy after enrich decision", async () => {
    const bundle = await loadSpecBundle(POLICY_DIR);
    expect(templateLiveViability(bundle, "financials", "banks")).toBe("proxy");
  });

  it("fails when index references missing template", async () => {
    const bundle = await loadSpecBundle(POLICY_DIR);
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
