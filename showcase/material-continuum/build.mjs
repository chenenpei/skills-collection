import { readFile, writeFile } from "node:fs/promises";

const registryUrl = new URL("../../skills/material-continuum/assets/color-themes.json", import.meta.url);
const showcaseUrl = new URL("./index.html", import.meta.url);
const sourceUrl = new URL("./source.html", import.meta.url);
const registry = JSON.parse(await readFile(registryUrl, "utf8"));
const sourceHtml = await readFile(sourceUrl, "utf8");
const artNames = ["narrative", "layers", "editorial", "mini-cover", "mini-comparison", "mini-reading"];
await readFile(new URL("./assets/architecture-neutral.jpg", import.meta.url));
const artData = Object.fromEntries(await Promise.all(artNames.map(async (name) => {
  const artUrl = new URL(`./assets/${name}.svg`, import.meta.url);
  const source = await readFile(artUrl, "utf8");
  const tokenized = source
    .replaceAll("#3F51B5", "var(--art-primary)")
    .replaceAll("#FF5252", "var(--art-accent)")
    .replaceAll("#E8EAF6", "var(--art-tint)");
  return [name, tokenized];
})));

const themeData = registry.themes.map(({ id, label, recommendation, colorScheme, roles }) => ({
  id,
  label,
  recommendation,
  colorScheme,
  roles: {
    displayField: roles.displayField,
    coloredHeading: roles.coloredHeading,
    accent: roles.accent,
    readingMarker: roles.readingMarker,
    emphasisText: roles.emphasisText,
    tint: roles.tint,
    illustrationSurface: roles.illustrationSurface,
  },
}));

const source = await readFile(showcaseUrl, "utf8");
const block = /(\/\* BEGIN GENERATED THEME DATA \*\/)[\s\S]*?(\/\* END GENERATED THEME DATA \*\/)/;
if (!block.test(source)) throw new Error("Showcase theme data markers are missing.");
const generated = `$1\nconst themeData = ${JSON.stringify(themeData, null, 2)};\n$2`;
const artBlock = /(\/\* BEGIN GENERATED ART DATA \*\/)[\s\S]*?(\/\* END GENERATED ART DATA \*\/)/;
if (!artBlock.test(source)) throw new Error("Showcase art data markers are missing.");
const generatedArt = `$1\nconst artData = ${JSON.stringify(artData, null, 2)};\n$2`;
const sourceBlock = /(\/\* BEGIN GENERATED SOURCE HTML \*\/)[\s\S]*?(\/\* END GENERATED SOURCE HTML \*\/)/;
if (!sourceBlock.test(source)) throw new Error("Showcase source HTML markers are missing.");
const generatedSource = `$1\nconst sourceHtml = ${JSON.stringify(sourceHtml).replaceAll("<", "\\u003c")};\n$2`;
const next = source.replace(artBlock, generatedArt).replace(sourceBlock, generatedSource).replace(block, generated);
const check = process.argv.includes("--check");
if (check && source !== next) throw new Error("Showcase data is stale; run node showcase/material-continuum/build.mjs");
if (!check && source !== next) await writeFile(showcaseUrl, next);
console.log(check ? "Showcase data is synchronized." : "Showcase data written.");
