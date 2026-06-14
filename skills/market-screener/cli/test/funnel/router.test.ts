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
    it("routes 电子-消费电子-品牌消费电子 to consumer", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "电子-消费电子-品牌消费电子",
      });
      expect(result.routingMethod).toBe("cn_industry_map");
      expect(result.matchedRule).toBe("l3:电子/消费电子/品牌消费电子");
      expect(result.templates).toEqual([{ id: "consumer" }]);
      expect(result.routingConfidence).toBe("high");
    });

    it("routes 电子-消费电子-零部件及组装 to manufacturing only", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "电子-消费电子-消费电子零部件及组装",
      });
      expect(result.routingMethod).toBe("cn_industry_map");
      expect(result.matchedRule).toBe("l3:电子/消费电子/消费电子零部件及组装");
      expect(result.templates).toEqual([{ id: "manufacturing" }]);
      expect(result.templates.map((t) => t.id)).not.toContain("consumer");
      expect(result.templates.map((t) => t.id)).not.toContain("tech_saas");
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

    it("routes 医药生物 L1 to healthcare without also_run union", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "医药生物-化学制药-化学制剂",
      });
      expect(result.routingMethod).toBe("cn_industry_map");
      expect(result.templates).toEqual([{ id: "healthcare" }]);
      expect(result.routingConfidence).toBe("high");
      expect(result.templates.map((t) => t.id)).not.toContain("consumer");
      expect(result.templates.map((t) => t.id)).not.toContain("tech_saas");
    });

    it("routes 医药生物-中药Ⅱ to consumer", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "医药生物-中药Ⅱ-中药Ⅲ",
      });
      expect(result.templates).toEqual([{ id: "consumer" }]);
    });

    it("routes 医药生物-医疗器械 to manufacturing", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "医药生物-医疗器械-医疗耗材",
      });
      expect(result.templates).toEqual([{ id: "manufacturing" }]);
    });

    it("routes 电子 L1 to manufacturing high without tech_saas", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "电子-元件-被动元件",
      });
      expect(result.templates).toEqual([{ id: "manufacturing" }]);
      expect(result.routingConfidence).toBe("high");
      expect(result.templates.map((t) => t.id)).not.toContain("tech_saas");
    });

    it("routes 电子-半导体 to manufacturing + cyclicals only", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        industryProxy: "电子-半导体-集成电路",
      });
      expect(result.matchedRule).toBe("l2:电子/半导体");
      expect(result.templates.map((t) => t.id).sort()).toEqual(["cyclicals", "manufacturing"]);
      expect(result.templates.map((t) => t.id)).not.toContain("tech_saas");
    });

    it("routes CN 银行 to financials/banks_proxy via cn_industry_map before GICS", () => {
      const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
        market: "CN",
        gicsCode: "401010",
        industryProxy: "银行-国有大型银行Ⅱ-国有大型银行Ⅲ",
      });
      expect(result.routingMethod).toBe("cn_industry_map");
      expect(result.matchedRule).toBe("l1:银行");
      expect(result.templates).toEqual([{ id: "financials", subTemplate: "banks_proxy" }]);
    });
  });

  it("routes GICS 3520 to healthcare", () => {
    const result = routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
      gicsCode: "352010",
    });
    expect(result.templates).toEqual([{ id: "healthcare" }]);
    expect(result.routingConfidence).toBe("high");
  });
});
