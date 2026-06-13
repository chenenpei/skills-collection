import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { SpecBundle } from "../../src/spec/types.js";
import { routeSecurity } from "../../src/funnel/router.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("routeSecurity", () => {
  let bundle: SpecBundle;

  beforeAll(async () => {
    bundle = await loadSpecBundle(SPEC_DIR);
  });

  it("routes GICS 4010 to financials/banks", () => {
    expect(routeSecurity(bundle.routingMap, bundle.cnIndustryMap, { gicsCode: "401010" })).toMatchObject({
      templates: [{ id: "financials", subTemplate: "banks" }],
      routingConfidence: "high",
      routingMethod: "gics",
      auditHints: [],
    });
  });

  it("runs ambiguous union for GICS 4520", () => {
    const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, { gicsCode: "452020" });
    expect(result.routingConfidence).toBe("ambiguous_union");
    expect(result.routingMethod).toBe("gics");
    expect(result.templates.map((t) => t.id).sort()).toEqual(["manufacturing", "tech_saas"]);
  });

  it("falls back to industry proxy keywords", () => {
    expect(
      routeSecurity(bundle.routingMap, bundle.cnIndustryMap, { industryProxy: "Commercial Bank" })
        .templates[0]
    ).toEqual({
      id: "financials",
      subTemplate: "banks",
    });
  });

  it("falls back to manufacturing with low confidence when unmatched", () => {
    expect(
      routeSecurity(bundle.routingMap, bundle.cnIndustryMap, { industryProxy: "Unknown Widget Corp" })
    ).toMatchObject({
      templates: [{ id: "manufacturing" }],
      routingConfidence: "low",
      routingMethod: "fallback",
      auditHints: ["routing_fallback_unmapped_industry"],
    });
  });

  describe("CN sector routing", () => {
    it("routes 电子-消费电子 to manufacturing+tech_saas, never consumer", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "电子-消费电子-品牌消费电子",
      });
      expect(result.routingMethod).toBe("cn_industry_map");
      expect(result.templates.map((t) => t.id).sort()).toEqual(["manufacturing", "tech_saas"]);
      expect(result.templates.map((t) => t.id)).not.toContain("consumer");
    });

    it("routes 食品饮料 to consumer", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "食品饮料-白酒Ⅱ-白酒Ⅲ",
      });
      expect(result.routingMethod).toBe("cn_industry_map");
      expect(result.templates[0]?.id).toBe("consumer");
    });

    it("fallback unmapped CN industry with low confidence", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "未来行业-未知-子类",
      });
      expect(result.routingMethod).toBe("fallback");
      expect(result.routingConfidence).toBe("low");
    });
  });
});
