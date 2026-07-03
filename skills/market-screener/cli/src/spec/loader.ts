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
  const routingMap = RoutingMapSchema.parse(
    await readYamlFile(path.join(specDir, "routing-map.yaml"))
  );
  const cnMapRef = (routingMap.classifier as { cn_industry_map_ref?: string } | undefined)
    ?.cn_industry_map_ref;
  const cnIndustryMap = cnMapRef
    ? CnIndustryMapSchema.parse(await readYamlFile(path.join(specDir, cnMapRef)))
    : undefined;
  const conventions = (await readYamlFile(
    path.join(specDir, "conventions.yaml")
  )) as Record<string, unknown>;
  const outputSchema = (await readYamlFile(
    path.join(specDir, "output-schema.yaml")
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
    routingMap,
    cnIndustryMap,
    conventions,
    outputSchema,
    landmineRules,
    templates,
  };
}
