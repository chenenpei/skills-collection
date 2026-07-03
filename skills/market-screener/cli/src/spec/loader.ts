import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CnIndustryMapSchema,
  ExclusionRulesSchema,
  IndexSchema,
  RoutingMapSchema,
  SectorTemplateSchema,
  type SpecBundle,
} from "./types.js";

async function readYamlFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseYaml(raw);
}

export async function loadSpecBundle(specDir: string): Promise<SpecBundle> {
  const indexRaw = await readYamlFile(path.join(specDir, "index.yaml"));
  const index = IndexSchema.parse(indexRaw);
  const rules = index.machine_rules ?? {};
  const exclusionRulesPath = rules.exclusions ?? rules.universe?.split("#")[0] ?? "exclusion-rules.yaml";
  const metricPolicyPath = rules.metrics ?? rules.conventions ?? "metric-policy.yaml";
  const selectionPolicyPath = rules.selection ?? metricPolicyPath;
  const landminePricingPath = rules.landmine_pricing ?? rules.landmine ?? "landmine-pricing.yaml";

  const exclusionRules = ExclusionRulesSchema.parse(
    await readYamlFile(path.join(specDir, exclusionRulesPath))
  );
  const routingRefs = index.machine_rules?.routing;
  const usRoutingPath = routingRefs?.us ?? routingRefs?.gics_and_proxy ?? "routing-us.yaml";
  const cnRoutingPath = routingRefs?.cn ?? routingRefs?.cn_primary ?? "routing-cn.yaml";

  const usRouting = RoutingMapSchema.parse(
    await readYamlFile(path.join(specDir, usRoutingPath))
  );
  const cnRouting = cnRoutingPath
    ? CnIndustryMapSchema.parse(await readYamlFile(path.join(specDir, cnRoutingPath)))
    : undefined;
  const metricPolicy = (await readYamlFile(
    path.join(specDir, metricPolicyPath)
  )) as Record<string, unknown>;
  const selectionPolicy = (await readYamlFile(
    path.join(specDir, selectionPolicyPath)
  )) as Record<string, unknown>;
  const landminePricing = (await readYamlFile(
    path.join(specDir, landminePricingPath)
  )) as Record<string, unknown>;

  const templates: SpecBundle["templates"] = {};
  for (const t of index.templates) {
    const tplPath = path.join(specDir, "templates", path.basename(t.file));
    templates[t.id] = SectorTemplateSchema.parse(await readYamlFile(tplPath));
  }

  return {
    specDir,
    index,
    exclusionRules,
    routing: {
      us: usRouting,
      cn: cnRouting,
    },
    metricPolicy,
    selectionPolicy,
    landminePricing,
    templates,
  };
}
