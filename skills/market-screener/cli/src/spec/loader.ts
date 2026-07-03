import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CnIndustryMapSchema,
  IndexSchema,
  KillGatesSchema,
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

  const killGates = KillGatesSchema.parse(
    await readYamlFile(path.join(specDir, "kill-gates.yaml"))
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
  const conventions = (await readYamlFile(
    path.join(specDir, "conventions.yaml")
  )) as Record<string, unknown>;
  const landmineRules = (await readYamlFile(
    path.join(specDir, "landmine-rules.yaml")
  )) as Record<string, unknown>;

  const templates: SpecBundle["templates"] = {};
  for (const t of index.templates) {
    const tplPath = path.join(specDir, "templates", path.basename(t.file));
    templates[t.id] = SectorTemplateSchema.parse(await readYamlFile(tplPath));
  }

  return {
    specDir,
    index,
    killGates,
    routing: {
      us: usRouting,
      cn: cnRouting,
    },
    conventions,
    landmineRules,
    templates,
  };
}
