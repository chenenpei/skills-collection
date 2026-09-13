#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadIcon, iconAttribution as readIconAttribution } from "./material-icons.mjs";

import { resolveTheme } from "./color-themes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, "..");
const ASSETS = path.join(SKILL_ROOT, "assets");
const VERSION = "1";
const LAYOUTS = new Set(["photo-led", "narrative", "comparison", "sections", "list", "reading"]);

const SOURCE_MODES = new Set(["final-copy", "rough-material"]);
const RATIOS = new Set(["3:4", "1:1", "16:9"]);
const READING_ACCENTS = new Set(["dot"]);
const SOURCE_TYPES = new Set(["title", "heading", "paragraph", "label"]);
const IMAGE_EXTENSIONS = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".gif", "image/gif"], [".svg", "image/svg+xml"]]);

function usage() {
  return "Usage: node scripts/render-brief.mjs <input.json> --out <output.html> [--mode pages|web] [--ratio 3:4|1:1|16:9]";
}

function problem(message, at = "input") {
  throw new Error(`${at}: ${message}`);
}

function object(value, at) {
  if (!value || typeof value !== "object" || Array.isArray(value)) problem("expected an object", at);
  return value;
}

function exactKeys(value, allowed, at) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problem(`unknown field ${JSON.stringify(key)}; arbitrary HTML/CSS and unregistered fields are not accepted`, at);
}

function text(value, at, { max = 1000, optional = false, lines = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string") problem("expected plain text", at);
  const cleaned = value.replace(/\r\n?/g, "\n");
  if (!cleaned.trim()) problem("must not be empty", at);
  if (!lines && cleaned.includes("\n")) problem("line breaks are only supported in page titles", at);
  if (cleaned.length > max) problem(`is too long (${cleaned.length} characters; maximum ${max}); edit or split it at a meaningful boundary`, at);
  return cleaned;
}

function stringArray(value, at, options = {}) {
  if (!Array.isArray(value) || value.length < (options.min ?? 1) || value.length > (options.max ?? 20)) {
    problem(`expected ${options.min ?? 1}–${options.max ?? 20} entries`, at);
  }
  return value.map((item, index) => text(item, `${at}[${index}]`, { max: options.textMax ?? 700 }));
}

function blocks(value, at, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) problem(`expected ${min}–${max} content blocks`, at);
  return value.map((raw, index) => {
    const block = object(raw, `${at}[${index}]`);
    exactKeys(block, ["heading", "paragraphs"], `${at}[${index}]`);
    return {
      heading: text(block.heading, `${at}[${index}].heading`, { max: 80, optional: true }),
      paragraphs: stringArray(block.paragraphs, `${at}[${index}].paragraphs`, { min: 1, max: 6, textMax: 900 }),
    };
  });
}

function details(value, at) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) problem("expected 2–4 details", at);
  return value.map((raw, index) => {
    const detail = object(raw, `${at}[${index}]`);
    exactKeys(detail, ["label", "text"], `${at}[${index}]`);
    return {
      label: text(detail.label, `${at}[${index}].label`, { max: 80 }),
      text: text(detail.text, `${at}[${index}].text`, { max: 500 }),
    };
  });
}

function imageSpec(raw, at, required = false) {
  if (!required && raw === undefined) return undefined;
  const image = object(raw, at);
  exactKeys(image, ["src", "alt", "credit", "fit"], at);
  const fit = image.fit === undefined ? "cover" : image.fit;
  if (fit !== "cover" && fit !== "contain") problem("expected cover or contain", `${at}.fit`);
  return {
    src: text(image.src, `${at}.src`, { max: 300 }),
    alt: text(image.alt, `${at}.alt`, { max: 180 }),
    credit: text(image.credit, `${at}.credit`, { max: 180, optional: true }),
    fit,
  };
}

function visualItem(raw, at) {
  const item = object(raw, at);
  exactKeys(item, ["heading", "paragraphs", "details", "image", "icon"], at);
  const image = imageSpec(item.image, `${at}.image`);
  const icon = text(item.icon, `${at}.icon`, { max: 80, optional: true });
  if (image && icon) problem("choose either image or icon, not both", at);
  const itemDetails = details(item.details, `${at}.details`);
  const paragraphs = item.paragraphs === undefined
    ? []
    : stringArray(item.paragraphs, `${at}.paragraphs`, { min: 0, max: 3, textMax: 500 });
  if (paragraphs.length === 0 && !itemDetails) problem("requires paragraphs or 2–4 details", at);
  return {
    heading: text(item.heading, `${at}.heading`, { max: 80 }),
    paragraphs,
    details: itemDetails,
    image,
    icon,
  };
}

function validateBrief(raw) {
  const brief = object(raw, "input");
  exactKeys(brief, ["schemaVersion", "title", "theme", "sourceMode", "sourceLedger", "pages"], "input");
  if (brief.schemaVersion !== VERSION) problem(`schemaVersion must be ${JSON.stringify(VERSION)}`, "input.schemaVersion");
  if (!SOURCE_MODES.has(brief.sourceMode)) problem("expected final-copy or rough-material", "input.sourceMode");
  const sourceLedger = Array.isArray(brief.sourceLedger) ? brief.sourceLedger : problem("expected an array", "input.sourceLedger");
  if (sourceLedger.length < 1 || sourceLedger.length > 200) problem("expected 1–200 source ledger entries", "input.sourceLedger");
  const sourceIds = new Set();
  const ledger = sourceLedger.map((rawSource, index) => {
    const at = `input.sourceLedger[${index}]`;
    const source = object(rawSource, at);
    exactKeys(source, ["sourceId", "text", "type", "label", "locator"], at);
    const sourceId = text(source.sourceId, `${at}.sourceId`, { max: 80 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sourceId)) problem("must use letters, digits, dot, underscore, colon, or hyphen", `${at}.sourceId`);
    if (sourceIds.has(sourceId)) problem(`duplicate sourceId ${JSON.stringify(sourceId)}`, `${at}.sourceId`);
    sourceIds.add(sourceId);
    if (source.type !== undefined && !SOURCE_TYPES.has(source.type)) problem("expected title, heading, paragraph, or label", `${at}.type`);
    return {
      sourceId,
      text: text(source.text, `${at}.text`, { max: 20_000, lines: true }),
      type: source.type,
      label: text(source.label, `${at}.label`, { max: 160, optional: true }),
      locator: text(source.locator, `${at}.locator`, { max: 300, optional: true }),
    };
  });
  if (!Array.isArray(brief.pages) || brief.pages.length < 1 || brief.pages.length > 100) problem("expected 1–100 pages", "input.pages");
  const pageIds = new Set();
  const pages = brief.pages.map((rawPage, index) => {
    const at = `input.pages[${index}]`;
    const page = object(rawPage, at);
    const common = ["id", "layout", "purpose", "sourceIds", "kicker", "title", "intro", "footer", "cover", "continuation", "image", "blocks", "columns", "sections", "items", "meta", "notes", "accent", "emphasis"];
    exactKeys(page, common, at);
    const id = text(page.id, `${at}.id`, { max: 80 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) problem("must be a stable identifier", `${at}.id`);
    if (pageIds.has(id)) problem(`duplicate page id ${JSON.stringify(id)}`, `${at}.id`);
    pageIds.add(id);
    if (!LAYOUTS.has(page.layout)) problem(`unknown layout ${JSON.stringify(page.layout)}`, `${at}.layout`);
    const baseFields = ["id", "layout", "purpose", "sourceIds", "title", "intro", "footer", "cover", "continuation"];
    baseFields.push("kicker");
    const layoutFields = page.layout === "photo-led" || page.layout === "narrative"
      ? ["image", "blocks", ...(page.layout === "narrative" ? ["emphasis"] : [])]
      : page.layout === "comparison"
        ? ["columns"]
        : page.layout === "sections"
        ? ["sections", "image", "notes"]
          : page.layout === "list"
            ? ["items"]
            : ["meta", "blocks", "accent"];
    exactKeys(page, [...baseFields, ...layoutFields], at);
    const linkedSources = stringArray(page.sourceIds, `${at}.sourceIds`, { min: 1, max: 30, textMax: 80 });
    for (const sourceId of linkedSources) if (!sourceIds.has(sourceId)) problem(`unregistered sourceId ${JSON.stringify(sourceId)}`, `${at}.sourceIds`);
    if (page.cover !== undefined && page.cover !== true) problem("cover must be true when supplied", `${at}.cover`);
    if (page.continuation !== undefined && page.continuation !== true) problem("continuation must be true when supplied", `${at}.continuation`);
    if (page.cover && page.layout !== "photo-led") problem("cover is supported only by photo-led", `${at}.cover`);
    if (page.continuation && page.layout !== "reading") problem("continuation is supported only by reading", `${at}.continuation`);
    if (page.cover && page.continuation) problem("cover and continuation cannot be combined", at);
    const title = text(page.title, `${at}.title`, { max: 100, lines: true, optional: page.continuation === true });
    if (!page.continuation && title === undefined) problem("is required unless continuation is true", `${at}.title`);
    if (page.continuation && title !== undefined) problem("must be omitted when continuation is true", `${at}.title`);
    const result = {
      id,
      layout: page.layout,
      purpose: text(page.purpose, `${at}.purpose`, { max: 240 }),
      sourceIds: linkedSources,
      kicker: text(page.kicker, `${at}.kicker`, { max: 80, optional: true }),
      title,
      cover: page.cover === true,
      continuation: page.continuation === true,
      intro: text(page.intro, `${at}.intro`, { max: 300, optional: true }),
      footer: text(page.footer, `${at}.footer`, { max: 120, optional: true }),
    };
    if (page.layout === "photo-led" || page.layout === "narrative") {
      result.image = imageSpec(page.image, `${at}.image`, true);
      if (page.layout === "narrative") result.emphasis = text(page.emphasis, `${at}.emphasis`, { max: 160, optional: true });
      result.blocks = blocks(page.blocks, `${at}.blocks`, page.cover ? 0 : 1, 2);
      if (!page.cover && result.blocks.length === 0) problem("empty blocks are supported only when cover is true", `${at}.blocks`);
    } else if (page.layout === "comparison") {
      if (!Array.isArray(page.columns) || page.columns.length !== 2) problem("comparison requires exactly 2 columns", `${at}.columns`);
      result.columns = page.columns.map((column, itemIndex) => visualItem(column, `${at}.columns[${itemIndex}]`));
      const visualCount = result.columns.filter((column) => column.image || column.icon).length;
      if (visualCount === 1) problem("comparison columns must both have visuals or both be text-only so their headings stay aligned", `${at}.columns`);
    } else if (page.layout === "sections") {
      if (!Array.isArray(page.sections) || page.sections.length < 2 || page.sections.length > 4) problem("sections requires 2–4 sections", `${at}.sections`);
      result.sections = page.sections.map((section, itemIndex) => visualItem(section, `${at}.sections[${itemIndex}]`));
      result.image = imageSpec(page.image, `${at}.image`);
      if (page.notes !== undefined) result.notes = blocks([page.notes], `${at}.notes`, 1, 1)[0];
    } else if (page.layout === "list") {
      if (!Array.isArray(page.items) || page.items.length < 2 || page.items.length > 6) problem("list requires 2–6 items; split a longer list by meaning", `${at}.items`);
      result.items = page.items.map((item, itemIndex) => visualItem(item, `${at}.items[${itemIndex}]`));
    } else {
      result.meta = text(page.meta, `${at}.meta`, { max: 180, optional: true });
      if (page.accent !== undefined && !READING_ACCENTS.has(page.accent)) problem("expected dot", `${at}.accent`);
      result.accent = page.accent;
      result.blocks = blocks(page.blocks, `${at}.blocks`, 1, 5);
    }
    const proseLength = JSON.stringify(result).length;
    const maxLength = page.layout === "reading" ? 8500 : 4200;
    if (proseLength > maxLength) problem(`content exceeds the ${page.layout} capacity; split it at a meaningful boundary instead of shrinking type`, at);
    return result;
  });
  return {
    schemaVersion: VERSION,
    title: text(brief.title, "input.title", { max: 160, optional: true }),
    theme: resolveTheme(brief.theme).id,
    sourceMode: brief.sourceMode,
    sourceLedger: ledger,
    pages,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function titleHtml(value) {
  return value.split("\n").map((line) => `<span>${escapeHtml(line)}</span>`).join("");
}

function safeLocalPath(baseDir, relative, at) {
  if (path.isAbsolute(relative)) problem("asset paths must be relative to the input JSON", at);
  const resolved = path.resolve(baseDir, relative);
  const prefix = `${path.resolve(baseDir)}${path.sep}`;
  if (!resolved.startsWith(prefix)) problem("asset path leaves the input JSON directory", at);
  return resolved;
}

function sanitizeSvg(svg, at) {
  const forbidden = /<(?:script|foreignObject|iframe|object|embed|link|style)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!#|data:image\/)/i;
  if (forbidden.test(svg) || !/<svg\b/i.test(svg)) problem("SVG contains active or external content", at);
  return svg;
}

async function embedFile(filename, at) {
  const extension = path.extname(filename).toLowerCase();
  const mime = IMAGE_EXTENSIONS.get(extension);
  if (!mime) problem("supported images are PNG, JPEG, WebP, GIF, and controlled SVG", at);
  const bytes = await readFile(filename).catch((error) => problem(`could not read asset (${error.code ?? error.message})`, at));
  if (extension === ".svg") sanitizeSvg(bytes.toString("utf8"), at);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function resolveAssets(brief, baseDir) {
  async function resolveImage(spec, at) {
    if (!spec) return undefined;
    return { ...spec, src: await embedFile(safeLocalPath(baseDir, spec.src, `${at}.src`), `${at}.src`) };
  }
  for (let pageIndex = 0; pageIndex < brief.pages.length; pageIndex += 1) {
    const page = brief.pages[pageIndex];
    if (page.image) page.image = await resolveImage(page.image, `input.pages[${pageIndex}].image`);
    for (const key of ["columns", "sections", "items"]) {
      for (let index = 0; index < (page[key]?.length ?? 0); index += 1) {
        const item = page[key][index];
        if (item.image) item.image = await resolveImage(item.image, `input.pages[${pageIndex}].${key}[${index}].image`);
        if (item.icon) {
          if (!/^[a-z0-9_]+$/.test(item.icon)) problem("icon must be a registered lowercase Material icon name", `input.pages[${pageIndex}].${key}[${index}].icon`);
          const { svg: iconSvg } = await loadIcon(item.icon).catch((error) => problem(`could not read icon (${error.code ?? error.message})`, `input.pages[${pageIndex}].${key}[${index}].icon`));
          sanitizeSvg(iconSvg, `input.pages[${pageIndex}].${key}[${index}].icon`);
          item.iconSvg = iconSvg
            .replace(/<svg\b([^>]*)>/i, '<svg class="mc-icon" aria-hidden="true" focusable="false"$1>')
            .replace(/\s(?:width|height)="[^"]*"/gi, "");
        }
      }
    }
  }
  return brief;
}

function imageHtml(image, className = "mc-inline-image") {
  const credit = image.credit ? `<figcaption class="mc-photo-credit">${escapeHtml(image.credit)}</figcaption>` : "";
  return `<figure data-image-fit="${image.fit}"><img class="${className}" src="${image.src}" alt="${escapeHtml(image.alt)}">${credit}</figure>`;
}

function blocksHtml(items) {
  return items.map((block) => `<section class="mc-block">${block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : ""}${block.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`).join("");
}

function detailsHtml(items) {
  if (!items) return "";
  return `<dl class="mc-details">${items.map((detail) => `<div class="mc-detail"><dt class="mc-detail-label">${escapeHtml(detail.label)}</dt><dd class="mc-detail-text">${escapeHtml(detail.text)}</dd></div>`).join("")}</dl>`;
}

function titleRegion(page, { kicker = false } = {}) {
  const label = kicker && page.kicker ? `<div class="mc-kicker">${escapeHtml(page.kicker)}</div>` : "";
  const heading = page.title === undefined ? "" : `<h1 class="mc-page-title">${titleHtml(page.title)}</h1>`;
  return `<header class="mc-title-region" data-region="title">${label}${heading}${page.intro ? `<p class="mc-intro">${escapeHtml(page.intro)}</p>` : ""}</header>`;
}

function cardKicker(page) {
  if (!page.kicker) return "";
  return `<div class="mc-reading-kicker-row"><span class="mc-reading-accent mc-reading-accent-dot" aria-hidden="true"></span><div class="mc-kicker">${escapeHtml(page.kicker)}</div></div>`;
}

function visual(item, wrapper, region) {
  const visualContent = item.image ? imageHtml(item.image) : item.iconSvg ?? "";
  const visualKind = item.image ? "image" : item.iconSvg ? "icon" : "none";
  return `<section class="${wrapper}" data-has-visual="${visualContent ? "true" : "false"}" data-visual-kind="${visualKind}"${region ? ` data-region="${region}"` : ""}>${visualContent ? `<div class="mc-section-visual mc-visual-${visualKind}">${visualContent}</div>` : ""}<div><h2>${escapeHtml(item.heading)}</h2>${item.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${detailsHtml(item.details)}</div></section>`;
}

function pageHtml(page) {
  const collection = page.columns ?? page.sections ?? page.items ?? [];
  const visualMode = collection.length && collection.every((item) => !item.image && !item.iconSvg) ? "text" : "visual";
  const common = `class="mc-page mc-stable-${page.layout}" data-layout="${page.layout}" data-visual-mode="${visualMode}"${page.layout === "sections" && page.image ? ' data-sections-featured="true"' : ""}${page.cover ? ' data-cover="true"' : ""}${page.continuation ? ' data-continuation="true"' : ""} data-page-id="${escapeHtml(page.id)}" data-purpose="${escapeHtml(page.purpose)}" data-source-ids="${escapeHtml(page.sourceIds.join(","))}"`;
  const background = `<div class="mc-layout-background" data-region="background" aria-hidden="true"></div>`;
  const footer = page.footer ? `<footer class="mc-footer"><span>${escapeHtml(page.footer)}</span></footer>` : "";
  let body;
  if (page.layout === "photo-led") {
    body = `<div class="mc-image-region" data-region="image">${imageHtml(page.image)}</div><div class="mc-copy-plane"><div class="mc-title-sheet">${titleRegion(page, { kicker: true })}</div><div class="mc-body-region" data-region="body" data-mc-check>${blocksHtml(page.blocks)}</div></div>`;
  } else if (page.layout === "narrative") {
    body = `<div class="mc-image-region" data-region="image">${imageHtml(page.image)}</div><div class="mc-copy-plane">${titleRegion(page, { kicker: true })}<div class="mc-body-region" data-region="body" data-mc-check>${blocksHtml(page.blocks)}${page.emphasis ? `<p class="mc-narrative-emphasis">${escapeHtml(page.emphasis)}</p>` : ""}</div></div>`;
  } else if (page.layout === "comparison") {
    body = `<div class="mc-header">${titleRegion({ ...page, intro: undefined }, { kicker: true })}</div>${page.intro ? `<p class="mc-composition-intro">${escapeHtml(page.intro)}</p>` : ""}<div class="mc-columns" data-region="columns" data-mc-check>${page.columns.map((item) => `<section class="mc-column" data-visual-kind="${item.image ? "image" : item.iconSvg ? "icon" : "none"}">${item.image ? `<div class="mc-column-image mc-visual-image">${imageHtml(item.image)}</div>` : item.iconSvg ? `<div class="mc-column-image mc-visual-icon">${item.iconSvg}</div>` : ""}<h2>${escapeHtml(item.heading)}</h2>${item.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${detailsHtml(item.details)}</section>`).join("")}</div>`;
  } else if (page.layout === "sections") {
    const hero = page.image ? `<div class="mc-sections-image" data-region="image">${imageHtml(page.image)}</div>` : "";
    const notes = page.notes ? `<aside class="mc-sections-notes" data-region="notes" data-mc-check>${page.notes.heading ? `<h2>${escapeHtml(page.notes.heading)}</h2>` : ""}${page.notes.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</aside>` : "";
    body = `<div class="mc-header">${titleRegion({ ...page, intro: undefined }, { kicker: true })}</div>${page.intro ? `<p class="mc-composition-intro">${escapeHtml(page.intro)}</p>` : ""}${hero}<div class="mc-sections-region" data-region="sections" data-mc-check>${page.sections.map((item) => visual(item, "mc-section-row")).join("")}</div>${notes}`;
  } else if (page.layout === "list") {
    body = `<div class="mc-list-sheet" data-region="sheet">${cardKicker(page)}${titleRegion(page)}<div class="mc-list-region" data-region="list" data-mc-check>${page.items.map((item) => visual(item, "mc-list-item", "list-item")).join("")}</div></div>`;
  } else {
    const readingLength = page.blocks.reduce((sum, block) => sum + (block.heading?.length ?? 0) + block.paragraphs.reduce((total, paragraph) => total + paragraph.length, 0), 0);
    body = `<article class="mc-article-sheet" data-reading-density="${readingLength < 260 ? "short" : "standard"}" data-region="sheet">${cardKicker(page)}${page.meta ? `<p class="mc-article-meta">${escapeHtml(page.meta)}</p>` : ""}${titleRegion(page)}<div class="mc-body-region" data-region="body" data-mc-check>${blocksHtml(page.blocks)}</div></article>`;
  }
  return `<section ${common}>${background}${body}${footer}</section>`;
}

export async function renderBrief(input, options = {}) {
  const mode = options.mode ?? "pages";
  const ratio = options.ratio ?? "3:4";
  if (mode !== "pages" && mode !== "web") problem("mode must be pages or web", "options.mode");
  if (!RATIOS.has(ratio)) problem("ratio must be 3:4, 1:1, or 16:9", "options.ratio");
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const brief = await resolveAssets(validateBrief(structuredClone(input)), baseDir);
  const [materialCss, layoutsCss] = await Promise.all([
    readFile(path.join(ASSETS, "material.css"), "utf8"),
    readFile(path.join(ASSETS, "page-layouts.css"), "utf8"),
  ]);
  const usesIcons = brief.pages.some((page) => [page.columns, page.sections, page.items].some((items) => items?.some((item) => item.iconSvg)));
  let iconAttribution = "";
  if (usesIcons) {
    const { license, sourceManifest } = await readIconAttribution();
    iconAttribution = `\n<!-- Material Icons\nSource: ${sourceManifest.materialIcons?.repository ?? sourceManifest.repository}\nRevision: ${sourceManifest.materialIcons?.revision ?? "upstream catalog"}\nLicense: Apache-2.0\n\n${license.trim()}\n-->`;
  }
  const cssHash = createHash("sha256").update(layoutsCss, "utf8").digest("hex");
  const title = brief.title ?? brief.pages[0].title.replace(/\n/g, " ");
  return `<!doctype html>\n<html lang="zh-CN" data-mc-renderer-version="${VERSION}" data-mc-layouts-version="${VERSION}" data-mc-css-sha256="${cssHash}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>${iconAttribution}\n<style id="mc-material-css">${materialCss}</style>\n<style id="mc-layouts-css" data-mc-css-sha256="${cssHash}">${layoutsCss}</style>\n</head>\n<body data-theme="${brief.theme}" data-mc-mode="${mode}" data-mc-ratio="${ratio}" data-source-mode="${brief.sourceMode}">\n<main class="mc-brief">${brief.pages.map(pageHtml).join("\n")}</main>\n<script type="application/json" id="mc-source-ledger">${JSON.stringify(brief.sourceLedger).replace(/</g, "\\u003c")}</script>\n</body>\n</html>\n`;
}

function parseArgs(argv) {
  let input;
  let out;
  let mode = "pages";
  let ratio = "3:4";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg.startsWith("--")) {
      const [name, inline] = arg.split("=", 2);
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("--")) problem(`missing value for ${name}`, "arguments");
      if (name === "--out") out = value;
      else if (name === "--mode") mode = value;
      else if (name === "--ratio") ratio = value;
      else problem(`unknown option ${name}`, "arguments");
    } else if (!input) input = arg;
    else problem("only one input JSON file may be supplied", "arguments");
  }
  if (!input || !out) problem(`input and --out are required\n${usage()}`, "arguments");
  return { help: false, input: path.resolve(input), out: path.resolve(out), mode, ratio };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const source = JSON.parse(await readFile(options.input, "utf8"));
  const html = await renderBrief(source, { mode: options.mode, ratio: options.ratio, baseDir: path.dirname(options.input) });
  await writeFile(options.out, html, "utf8");
  console.log(`Rendered ${source.pages?.length ?? 0} page(s) to ${options.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
