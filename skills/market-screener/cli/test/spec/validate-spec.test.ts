import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import { validateSpecBundle } from "../../src/spec/validate-spec.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("validateSpecBundle", () => {
  it("passes on repo spec", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    const result = validateSpecBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
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
