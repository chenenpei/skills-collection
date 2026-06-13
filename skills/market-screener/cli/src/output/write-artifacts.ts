import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

export async function writeYamlArtifact(outputPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stringifyYaml(data), "utf8");
}
