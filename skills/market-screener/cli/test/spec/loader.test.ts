import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("loadSpecBundle", () => {
  it("loads index, kill-gates, routing-map, and all templates", async () => {
    const bundle = await loadSpecBundle(SPEC_DIR);
    expect(bundle.index.version).toBe("0.1.0");
    expect(bundle.killGates.gates.length).toBeGreaterThan(0);
    expect(bundle.routingMap.mappings.length).toBeGreaterThan(0);
    expect(Object.keys(bundle.templates)).toEqual(
      expect.arrayContaining([
        "financials",
        "tech_saas",
        "consumer",
        "cyclicals",
        "manufacturing",
      ])
    );
  });
});
