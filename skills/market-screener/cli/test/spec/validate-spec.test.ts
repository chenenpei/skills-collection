import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import { validateSpecBundle } from "../../src/spec/validate-spec.js";
import { templateLiveViability } from "../../src/spec/conventions.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("validateSpecBundle", () => {
  it("passes on repo spec", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    const result = validateSpecBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
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
