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
  output: z.record(z.unknown()).optional(),
});

export const KillGatesSchema = z.object({
  version: z.string(),
  universe: z.record(z.unknown()),
  gates: z.array(z.record(z.unknown())),
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
export type KillGatesSpec = z.infer<typeof KillGatesSchema>;
export type RoutingMapSpec = z.infer<typeof RoutingMapSchema>;
export type CnIndustryMapSpec = z.infer<typeof CnIndustryMapSchema>;
export type SectorTemplateSpec = z.infer<typeof SectorTemplateSchema>;

export interface SpecBundle {
  specDir: string;
  index: IndexSpec;
  killGates: KillGatesSpec;
  routingMap: RoutingMapSpec;
  cnIndustryMap?: CnIndustryMapSpec;
  conventions: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  schedule: Record<string, unknown>;
  landmineRules: Record<string, unknown>;
  templates: Record<string, SectorTemplateSpec>;
}
