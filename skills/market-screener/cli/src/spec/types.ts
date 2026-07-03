import { z } from "zod";

export const IndexSchema = z.object({
  version: z.string(),
  status: z.string(),
  tightening_profile: z.string(),
  templates: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      tracks: z.array(z.string()).optional(),
    })
  ),
  principles: z
    .object({
      funnel_soft_cap_per_market: z.number().optional(),
    })
    .optional(),
  machine_rules: z
    .object({
      exclusions: z.string().optional(),
      metrics: z.string().optional(),
      selection: z.string().optional(),
      universe: z.string().optional(),
      conventions: z.string().optional(),
      routing: z
        .object({
          us: z.string().optional(),
          cn: z.string().optional(),
          gics_and_proxy: z.string().optional(),
          cn_primary: z.string().optional(),
        })
        .optional(),
      landmine_pricing: z.string().optional(),
      landmine: z.string().optional(),
    })
    .optional(),
});

export const ExclusionRulesSchema = z.object({
  version: z.string(),
  universe: z.record(z.unknown()),
  gates: z.array(z.record(z.unknown())),
  flags_not_exclusions: z.array(z.record(z.unknown())).optional(),
  live_quote_prefilter: z.record(z.unknown()).optional(),
  enrichment_failures: z.record(z.unknown()).optional(),
});

export const RoutingMapSchema = z.object({
  version: z.string(),
  classifier: z.record(z.unknown()).optional(),
  mappings: z.array(z.record(z.unknown())),
  industry_proxy_map: z.array(z.record(z.unknown())).optional(),
  ambiguous_union_rules: z.record(z.unknown()).optional(),
});

export const CnIndustryMapSchema = z.object({
  version: z.string(),
  taxonomy: z.string().optional(),
  legacy_l1_aliases: z.record(z.string()).optional(),
  l1_defaults: z.record(z.record(z.unknown())).optional(),
  l2_overrides: z.array(z.record(z.unknown())).optional(),
  proxy_keyword_excludes: z.array(z.record(z.unknown())).optional(),
  proxy_keyword_additions: z.array(z.record(z.unknown())).optional(),
});

export const SectorTemplateSchema = z
  .object({
    version: z.string(),
    template: z.string(),
    tracks: z.array(z.string()),
  })
  .passthrough();

export type IndexSpec = z.infer<typeof IndexSchema>;
export type ExclusionRulesSpec = z.infer<typeof ExclusionRulesSchema>;
export type RoutingMapSpec = z.infer<typeof RoutingMapSchema>;
export type CnIndustryMapSpec = z.infer<typeof CnIndustryMapSchema>;
export type SectorTemplateSpec = z.infer<typeof SectorTemplateSchema>;

export interface SpecBundle {
  specDir: string;
  index: IndexSpec;
  exclusionRules: ExclusionRulesSpec;
  routing: {
    us: RoutingMapSpec;
    cn?: CnIndustryMapSpec;
  };
  metricPolicy: Record<string, unknown>;
  selectionPolicy: Record<string, unknown>;
  landminePricing: Record<string, unknown>;
  templates: Record<string, SectorTemplateSpec>;
}
