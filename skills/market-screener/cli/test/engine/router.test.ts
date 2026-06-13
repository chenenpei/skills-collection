import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { RoutingMapSpec } from "../../src/spec/types.js";
import { routeSecurity } from "../../src/engine/router.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("routeSecurity", () => {
  let routingMap: RoutingMapSpec;

  beforeAll(async () => {
    routingMap = (await loadSpecBundle(SPEC_DIR)).routingMap;
  });

  it("routes GICS 4010 to financials/banks", () => {
    expect(routeSecurity(routingMap, { gicsCode: "401010" })).toMatchObject({
      templates: [{ id: "financials", subTemplate: "banks" }],
      routingConfidence: "high",
      auditHints: [],
    });
  });

  it("runs ambiguous union for GICS 4520", () => {
    const result = routeSecurity(routingMap, { gicsCode: "452020" });
    expect(result.routingConfidence).toBe("ambiguous_union");
    expect(result.templates.map((t) => t.id).sort()).toEqual(["manufacturing", "tech_saas"]);
  });

  it("falls back to industry proxy keywords", () => {
    expect(routeSecurity(routingMap, { industryProxy: "Commercial Bank" }).templates[0]).toEqual({
      id: "financials",
      subTemplate: "banks",
    });
  });

  it("falls back to manufacturing when unmatched", () => {
    expect(routeSecurity(routingMap, { industryProxy: "Unknown Widget Corp" })).toMatchObject({
      templates: [{ id: "manufacturing" }],
      auditHints: ["Default fallback template: manufacturing"],
    });
  });
});
