#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { THEME_IDS, resolveTheme } from "./color-themes.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSS = path.resolve(here, "../assets/page-layouts.css");
const DEFAULT_MATERIAL_CSS = path.resolve(here, "../assets/material.css");
const DEFAULT_LAYOUTS = path.resolve(here, "../assets/layout-contract.json");
const VIEWPORTS = Object.freeze({
  pages: [{ name: "pages", width: 1440, height: 1600 }],
  web: [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ],
});

export function parseArgs(argv) {
  let input;
  let report;
  let web = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--web") { web = true; continue; }
    if (arg === "--report") {
      report = argv[++index];
      if (!report || report.startsWith("--")) throw argumentError("Missing value for --report.");
      continue;
    }
    if (arg.startsWith("--")) throw argumentError(`Unknown option: ${arg}.`);
    if (input) throw argumentError("Only one input HTML file may be supplied.");
    input = arg;
  }
  if (!input) throw argumentError("Missing input HTML file.");
  if (!report) throw argumentError("Missing required --report file.");
  return { help: false, input: path.resolve(input), report: path.resolve(report), web };
}

function usage() {
  return `Usage: node scripts/validate-brief.mjs <file.html> --report <file.json> [--web]\n\n` +
    "Validates a Material Continuum stable-renderer document. A real headless Chromium run is mandatory.\n" +
    "Set MC_CHROMIUM_PATH to a compatible Chrome/Chromium executable when Playwright's browser is unavailable.";
}

function argumentError(message) {
  const error = new Error(`${message}\n\n${usage()}`);
  error.exitCode = 2;
  return error;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function issue(code, message, extra = {}) { return { code, message, ...extra }; }

function loadPlaywright() {
  try { return require("playwright"); }
  catch (error) {
    const diagnostic = new Error(`Playwright is required for render validation. Original error: ${error.message}`);
    diagnostic.exitCode = 2;
    throw diagnostic;
  }
}

async function loadContract() {
  const [css, materialCss, rawLayouts] = await Promise.all([readFile(DEFAULT_CSS), readFile(DEFAULT_MATERIAL_CSS), readFile(DEFAULT_LAYOUTS, "utf8")]);
  const layoutsFile = JSON.parse(rawLayouts);
  const entries = layoutsFile.layouts ?? layoutsFile;
  const layouts = {};
  if (Array.isArray(entries)) {
    for (const item of entries) layouts[item.id ?? item.name ?? item.layout] = item;
  } else {
    Object.assign(layouts, entries);
  }
  for (const [name, spec] of Object.entries(layouts)) {
    const required = spec.requiredRegions ?? spec.regions?.filter((region) => region.required !== false).map((region) => region.id ?? region.name);
    if (!Array.isArray(required) || required.length === 0) throw new Error(`Layout ${name} has no requiredRegions contract.`);
    layouts[name] = { ...spec, requiredRegions: required };
  }
  return {
    rendererVersion: String(layoutsFile.rendererVersion ?? layoutsFile.contract?.rendererVersion ?? "1"),
    layoutsVersion: String(layoutsFile.layoutsVersion ?? layoutsFile.version ?? layoutsFile.schemaVersion ?? layoutsFile.contract?.layoutsVersion ?? "1"),
    cssHash: sha256(css),
    layoutCss: css.toString("utf8"),
    materialCss: materialCss.toString("utf8"),
    themes: Object.fromEntries(THEME_IDS.map((id) => [id, resolveTheme(id)])),
    layouts,
  };
}

function watchFailures(page) {
  const failures = [];
  const relevant = new Set(["document", "stylesheet", "image", "media", "font"]);
  page.on("requestfailed", (request) => {
    if (relevant.has(request.resourceType())) failures.push(issue("ASSET_REQUEST_FAILED", request.failure()?.errorText ?? "request failed", { url: request.url(), type: request.resourceType() }));
  });
  page.on("response", (response) => {
    if (relevant.has(response.request().resourceType()) && response.status() >= 400) failures.push(issue("ASSET_HTTP_ERROR", `HTTP ${response.status()}`, { url: response.url() }));
  });
  return failures;
}

async function inspectPage(page, contract, viewport, web) {
  return page.evaluate(({ contract, viewport, web }) => {
    const errors = [];
    const warnings = [];
    const add = (code, message, details = {}) => errors.push({ code, message, ...details });
    const root = document.documentElement;
    const brief = document.querySelector("body > main.mc-brief");
    const themeId = document.body?.dataset.theme;
    const theme = Object.hasOwn(contract.themes, themeId) ? contract.themes[themeId] : undefined;
    let checkedColorRoles = 0;
    if (!theme) add("THEME_ID", "body[data-theme] must name a canonical registered theme; render legacy aliases through render-brief.mjs.", { actual: themeId ?? null });
    const rgb = (hex) => `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
    const checkColor = (element, property, role, pageId) => {
      if (!theme || !element) return;
      const expected = rgb(theme.roles[role]);
      const actual = getComputedStyle(element)[property];
      checkedColorRoles += 1;
      if (actual !== expected) add("THEME_ROLE_COLOR", `${role} is not applied to the rendered ${element.className || element.tagName.toLowerCase()}.`, { pageId, role, property, expected, actual });
    };
    if (root.dataset.mcRendererVersion !== contract.rendererVersion) add("RENDERER_VERSION", `Expected renderer version ${contract.rendererVersion}.`);
    if (root.dataset.mcLayoutsVersion !== contract.layoutsVersion) add("LAYOUTS_VERSION", `Expected layouts version ${contract.layoutsVersion}.`);
    if (root.dataset.mcCssSha256 !== contract.cssHash) add("CSS_HASH", "The document root does not declare the installed page-layouts.css hash.");
    const layoutStyle = document.querySelector("style#mc-layouts-css");
    if (!layoutStyle) add("LAYOUT_STYLE_MISSING", "style#mc-layouts-css is missing.");
    else {
      if (layoutStyle.dataset.mcCssSha256 !== contract.cssHash) add("CSS_HASH", "The layout style hash does not match the installed page-layouts.css.");
      if (layoutStyle.textContent !== contract.layoutCss) add("CSS_CONTENT", "Embedded layout CSS bytes differ from the installed page-layouts.css contract.");
      if (root.dataset.mcCssSha256 !== layoutStyle.dataset.mcCssSha256) add("CSS_HASH_SPLIT", "Root and style CSS hashes differ.");
    }
    const materialStyle = document.querySelector("style#mc-material-css");
    if (!materialStyle) add("MATERIAL_STYLE_MISSING", "style#mc-material-css is missing.");
    else if (materialStyle.textContent !== contract.materialCss) add("MATERIAL_CSS_CONTENT", "Embedded material CSS bytes differ from the installed material.css contract.");
    const allowedStyles = new Set([materialStyle, layoutStyle].filter(Boolean));
    for (const style of document.querySelectorAll("style")) if (!allowedStyles.has(style)) add("EXTRA_STYLE", "Stable output contains an unregistered style element.");
    for (const element of document.querySelectorAll("[style]")) add("INLINE_STYLE", `Stable output contains inline style on ${element.tagName.toLowerCase()}.`);
    for (const link of document.querySelectorAll("link[rel~='stylesheet']")) add("EXTERNAL_STYLESHEET", `Stable output contains stylesheet link ${JSON.stringify(link.getAttribute("href") ?? "")}.`);
    for (const script of document.querySelectorAll("script")) {
      if (!(script.id === "mc-source-ledger" && script.type === "application/json")) add("EXECUTABLE_SCRIPT", "Stable output contains a script other than the inert JSON source ledger.");
    }
    if (!brief) add("BRIEF_ROOT", "Expected body > main.mc-brief.");

    const pageEls = brief ? [...brief.children].filter((el) => el.matches(".mc-page")) : [];
    if (brief && pageEls.length !== brief.querySelectorAll(".mc-page").length) add("PAGE_NESTING", ".mc-page elements must be direct children of main.mc-brief.");
    if (!web && pageEls.length === 0) add("NO_PAGES", "No stable-renderer pages were found.");
    const ids = new Set();
    const pages = [];
    const keylines = new Map();
    const tolerance = 1;
    const visible = (el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0; };
    for (const pageEl of pageEls) {
      const pageId = pageEl.dataset.pageId;
      const sheet = pageEl.querySelector(".mc-list-sheet,.mc-article-sheet");
      if (sheet) {
        checkColor(sheet, "backgroundColor", "surface", pageId);
        for (const text of sheet.querySelectorAll("h1,p:not(.mc-intro),.mc-intro,.mc-detail-text")) checkColor(text, "color", "onSurface", pageId);
        for (const kicker of sheet.querySelectorAll(".mc-kicker")) {
          const row = kicker.closest(".mc-reading-kicker-row");
          const dots = row?.querySelectorAll(".mc-reading-accent-dot") ?? [];
          const dot = dots[0];
          const dotRect = dot?.getBoundingClientRect(), kickerRect = kicker.getBoundingClientRect();
          if (dots.length !== 1 || !visible(dot) || dotRect.width <= 0 || dotRect.height <= 0 || !(dot.compareDocumentPosition(kicker) & Node.DOCUMENT_POSITION_FOLLOWING) || dotRect.right > kickerRect.left + 1) {
            add("THEME_READING_MARKER", "Every reading/list kicker needs exactly one visible leading circle before its text.", { pageId });
          }
          if (dot) checkColor(dot, "backgroundColor", "readingMarker", pageId);
        }
      }
      for (const field of pageEl.querySelectorAll(".mc-header,.mc-title-sheet")) {
        checkColor(field, "backgroundColor", "displayField", pageId);
        checkColor(field.querySelector(".mc-page-title"), "color", "displayHeading", pageId);
        checkColor(field.querySelector(".mc-kicker"), "color", "onDisplayField", pageId);
      }
      for (const heading of pageEl.querySelectorAll(".mc-column h2,.mc-section-row h2,.mc-list-item h2,.mc-article-sheet h2")) checkColor(heading, "color", "coloredHeading", pageId);
      for (const paragraph of pageEl.querySelectorAll(".mc-stable-narrative .mc-body-region p:not(.mc-narrative-emphasis)")) checkColor(paragraph, "color", "onNeutral", pageId);
      for (const emphasis of pageEl.querySelectorAll(".mc-narrative-emphasis")) {
        checkColor(emphasis, "color", "emphasisText", pageId);
        const size = parseFloat(getComputedStyle(emphasis).fontSize);
        if (!Number.isFinite(size) || size < 24) add("THEME_EMPHASIS_SIZE", "Narrative emphasis must remain at least 24px so bright emphasis colors are used only as large text.", { pageId, actual: size });
      }
    }
    const selector = (el) => el.id ? `#${el.id}` : `[data-region="${el.dataset.region ?? "?"}"]`;
    const paintedImageRect = (image) => {
      const box = image.getBoundingClientRect();
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      if (!naturalWidth || !naturalHeight) return box;
      const style = getComputedStyle(image);
      const fit = style.objectFit;
      let width = box.width, height = box.height;
      if (fit === "contain" || fit === "cover" || fit === "scale-down") {
        const containScale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
        const coverScale = Math.max(box.width / naturalWidth, box.height / naturalHeight);
        const scale = fit === "cover" ? coverScale : fit === "scale-down" ? Math.min(1, containScale) : containScale;
        width = naturalWidth * scale;
        height = naturalHeight * scale;
      } else if (fit === "none") {
        width = naturalWidth;
        height = naturalHeight;
      }
      const tokens = style.objectPosition.trim().split(/\s+/);
      const resolvePosition = (token, free, axis) => {
        const keywords = axis === "x" ? { left: 0, center: .5, right: 1 } : { top: 0, center: .5, bottom: 1 };
        if (token in keywords) return free * keywords[token];
        if (token.endsWith("%")) return free * Number.parseFloat(token) / 100;
        if (token.endsWith("px")) return Number.parseFloat(token);
        return free * .5;
      };
      const xToken = tokens[0] ?? "50%";
      const yToken = tokens[1] ?? (xToken === "top" || xToken === "bottom" ? xToken : "50%");
      const left = box.left + resolvePosition(xToken, box.width - width, "x");
      const top = box.top + resolvePosition(yToken, box.height - height, "y");
      return { left, top, right: left + width, bottom: top + height, width, height };
    };

    for (const [index, pageEl] of pageEls.entries()) {
      const pageId = pageEl.dataset.pageId;
      const layout = pageEl.dataset.layout;
      const pageInfo = { index: index + 1, pageId: pageId || null, layout: layout || null, regions: {}, metrics: {} };
      if (!pageId) add("PAGE_ID", "A page lacks data-page-id.", { pageIndex: index + 1 });
      else if (ids.has(pageId)) add("DUPLICATE_PAGE_ID", `Duplicate page ID ${pageId}.`, { pageId });
      ids.add(pageId);
      if (!pageEl.dataset.purpose?.trim()) add("PAGE_PURPOSE", "A page lacks data-purpose.", { pageId });
      if (!pageEl.hasAttribute("data-source-ids")) add("PAGE_SOURCES", "A page lacks data-source-ids.", { pageId });
      const spec = contract.layouts[layout];
      if (!spec) add("UNKNOWN_LAYOUT", `Unknown stable layout ${JSON.stringify(layout)}.`, { pageId });
      if (layout && !pageEl.classList.contains(`mc-stable-${layout}`)) add("LAYOUT_ROOT_CLASS", `Layout ${layout} must use root class mc-stable-${layout}.`, { pageId });
      const regions = [...pageEl.querySelectorAll("[data-region]")];
      const byName = new Map();
      for (const region of regions) {
        const name = region.dataset.region;
        const list = byName.get(name) ?? [];
        list.push(region); byName.set(name, list);
      }
      if (spec) for (const name of spec.requiredRegions) {
        if (!byName.has(name)) add("REQUIRED_REGION", `Layout ${layout} is missing region ${name}.`, { pageId, region: name });
      }
      const background = byName.get("background")?.[0];
      if (background) {
        if (background.parentElement !== pageEl) add("REGION_PARENT", "Background region must be a direct page child.", { pageId, region: "background" });
        if (background.getAttribute("aria-hidden") !== "true") add("BACKGROUND_ROLE", "Background region must be aria-hidden=true.", { pageId });
        if (background.textContent.trim() || background.querySelector("img[alt]:not([alt=''])")) add("BACKGROUND_CONTENT", "Background underlay contains reader-facing content.", { pageId });
      }
      const title = byName.get("title")?.[0];
      const continuation = pageEl.dataset.continuation === "true";
      const cover = pageEl.dataset.cover === "true";
      if (continuation && layout !== "reading") add("CONTINUATION_LAYOUT", "Continuation is supported only by reading.", { pageId });
      if (cover && layout !== "photo-led") add("COVER_LAYOUT", "Cover is supported only by photo-led.", { pageId });
      if (!continuation && title && !title.querySelector("h1")) add("TITLE_HEADING", "A non-continuation page title region requires an h1.", { pageId });
      if (continuation && title?.querySelector("h1")) add("CONTINUATION_TITLE", "A continuation page must omit its title heading.", { pageId });
      const titleParent = (layout === "reading" || layout === "list") ? byName.get("sheet")?.[0] : null;
      if ((layout === "reading" || layout === "list") && !titleParent) add("REQUIRED_REGION", `${layout} requires a sheet region.`, { pageId, region: "sheet" });
      if (titleParent && title && !titleParent.contains(title)) add("TITLE_CONTAINER", `${layout} title must be inside its ${layout === "reading" ? "sheet" : "list"} card.`, { pageId });
      const direct = (element, parent, region) => { if (element && parent && element.parentElement !== parent) add("REGION_PARENT", `${region} has the wrong parent for ${layout}.`, { pageId, region }); };
      if (layout === "photo-led") {
        direct(byName.get("image")?.[0], pageEl, "image");
        const copyPlane = [...pageEl.children].find((element) => element.classList.contains("mc-copy-plane"));
        const titleSheet = title?.closest(".mc-title-sheet");
        if (!copyPlane || !titleSheet || titleSheet.parentElement !== copyPlane || title?.parentElement !== titleSheet) add("REGION_PARENT", "photo-led title must be inside .mc-copy-plane > .mc-title-sheet.", { pageId, region: "title" });
        direct(byName.get("body")?.[0], copyPlane, "body");
      } else if (layout === "narrative") {
        direct(byName.get("image")?.[0], pageEl, "image");
        const copyPlane = [...pageEl.children].find((element) => element.classList.contains("mc-copy-plane"));
        direct(title, copyPlane, "title"); direct(byName.get("body")?.[0], copyPlane, "body");
      } else if (layout === "comparison" || layout === "sections") {
        const header = [...pageEl.children].find((element) => element.classList.contains("mc-header"));
        direct(title, header, "title");
        direct(byName.get(layout === "comparison" ? "columns" : "sections")?.[0], pageEl, layout === "comparison" ? "columns" : "sections");
      } else if (layout === "list" && titleParent) {
        direct(titleParent, pageEl, "sheet"); direct(title, titleParent, "title"); direct(byName.get("list")?.[0], titleParent, "list");
        for (const item of byName.get("list-item") ?? []) direct(item, byName.get("list")?.[0], "list-item");
      } else if (layout === "reading" && titleParent) {
        direct(titleParent, pageEl, "sheet"); direct(title, titleParent, "title"); direct(byName.get("body")?.[0], titleParent, "body");
      }

      if (!web && (layout === "photo-led" || layout === "narrative")) {
        const imageRegion = byName.get("image")?.[0];
        const image = imageRegion?.querySelector("img.mc-inline-image");
        if (imageRegion && image) {
          const slot = imageRegion.getBoundingClientRect();
          const painted = paintedImageRect(image);
          const fillsSlot = painted.left <= slot.left + tolerance && painted.top <= slot.top + tolerance && painted.right >= slot.right - tolerance && painted.bottom >= slot.bottom - tolerance;
          if (!fillsSlot) add("SCENE_IMAGE_LETTERBOX", `${layout} scene image leaves unpainted bands in its registered image region; use cover or artwork matching the region ratio.`, { pageId, painted: { x: painted.left - slot.left, y: painted.top - slot.top, width: painted.width, height: painted.height }, slot: { width: slot.width, height: slot.height } });
          if (layout === "photo-led") {
            const titleSheet = title?.closest(".mc-title-sheet")?.getBoundingClientRect();
            const overlapsPainted = titleSheet && titleSheet.left < painted.right - tolerance && titleSheet.right > painted.left + tolerance && titleSheet.top < painted.bottom - tolerance && titleSheet.bottom > painted.top + tolerance;
            if (!overlapsPainted) add("PHOTO_TITLE_IMAGE_OVERLAP", "Photo-led title paper must overlap the image's painted pixels, not only its reserved image slot.", { pageId });
          }
        }
      }

      if (!web && (layout === "comparison" || layout === "sections")) {
        const header = title?.closest(".mc-header");
        if (header && title) {
          const headerRect = header.getBoundingClientRect();
          const titleRect = title.getBoundingClientRect();
          const topInset = titleRect.top - headerRect.top;
          const bottomInset = headerRect.bottom - titleRect.bottom;
          if (topInset < 35 || bottomInset < 35) add("HEADER_INSET", `Header title needs at least 36px of internal vertical space (measured ${topInset.toFixed(1)}px top / ${bottomInset.toFixed(1)}px bottom).`, { pageId });
        }
      }

      if (!web && layout === "list") {
        const lastItem = byName.get("list-item")?.at(-1);
        if (lastItem && Number.parseFloat(getComputedStyle(lastItem).borderBottomWidth) > 0) add("LIST_TERMINAL_DIVIDER", "The final list item must not draw a bottom divider.", { pageId });
      }

      if (!web) for (const iconSlot of pageEl.querySelectorAll('.mc-column-image.mc-visual-icon,.mc-section-visual.mc-visual-icon')) {
        const rect = iconSlot.getBoundingClientRect();
        if (rect.width > 120 || rect.height > 120) add("ICON_SLOT_SCALE", `An icon anchor occupies an illustration-sized slot (${rect.width.toFixed(1)}×${rect.height.toFixed(1)}px).`, { pageId });
      }

      if (!web && (layout === "reading" || layout === "list")) {
        const sheet = byName.get("sheet")?.[0];
        if (sheet) {
          const sheetRect = sheet.getBoundingClientRect();
          const pageRectNow = pageEl.getBoundingClientRect();
          const ratio = document.body.dataset.mcRatio;
          const footerEl = pageEl.querySelector(".mc-footer");
          if (footerEl && sheetRect.bottom > footerEl.getBoundingClientRect().top - 24) add(`${layout.toUpperCase()}_FOOTER_CLEARANCE`, `${layout === "reading" ? "Reading" : "List"} paper must leave at least 24px clear before its footer.`, { pageId });
          if (layout === "reading" && ratio === "3:4") {
            const seam = pageRectNow.top + pageRectNow.height * .575;
            if (Math.abs(sheetRect.top - pageRectNow.top - 202) > 2 || sheetRect.bottom < seam + 70) add("READING_CROSS_BOUNDARY", "A 3:4 reading sheet must start at the 202px keyline and clearly cross the 57.5% background seam.", { pageId });
          }
          if (layout === "reading" && ratio === "16:9" && getComputedStyle(sheet).columnCount !== "auto" && getComputedStyle(sheet).columnCount !== "1") add("READING_MULTICOLUMN", "Wide reading remains one continuous text column.", { pageId });
        }
      }

      if (layout === "list") for (const item of byName.get("list-item") ?? []) {
        const rect = item.getBoundingClientRect();
        const text = item.textContent.trim();
        if (!text) add("EMPTY_LIST_ITEM", "List contains an empty item.", { pageId });
        if (text) {
          const range = document.createRange(); range.selectNodeContents(item);
          const textHeight = [...range.getClientRects()].reduce((sum, r) => sum + r.height, 0);
          const emptyRatio = rect.height ? Math.max(0, 1 - Math.min(rect.height, textHeight) / rect.height) : 0;
          if (rect.height > 120 && emptyRatio > 0.82) add("SPARSE_LIST_ITEM", `List item reserves excessive empty height (${Math.round(emptyRatio * 100)}%).`, { pageId });
        }
      }

      if (!web) pageEl.scrollIntoView({ block: "start", inline: "nearest" });
      const pageRect = pageEl.getBoundingClientRect();
      const outside = (rect) => rect.right > pageRect.right + tolerance || rect.bottom > pageRect.bottom + tolerance || rect.left < pageRect.left - tolerance || rect.top < pageRect.top - tolerance;
      const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT, { acceptNode(node) {
        if (!node.textContent?.trim() || !node.parentElement || !visible(node.parentElement) || node.parentElement.closest("[aria-hidden='true'],[data-mc-allow-overflow]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }});
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        if (rects.some(outside)) add("CONTENT_OUTSIDE_PAGE", `Text crosses page boundary: ${JSON.stringify(node.textContent.trim().replace(/\s+/g, " ").slice(0, 80))}.`, { pageId });
        const parent = node.parentElement;
        const occluded = rects.some((rect) => {
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
          const top = document.elementFromPoint(x, y);
          return top && pageEl.contains(top) && !parent.contains(top) && !top.contains(parent) && top.dataset.region !== "background";
        });
        if (occluded) add("CONTENT_OCCLUDED", `Text is covered by another page element: ${JSON.stringify(node.textContent.trim().replace(/\s+/g, " ").slice(0, 80))}.`, { pageId });
      }
      for (const check of pageEl.querySelectorAll("[data-mc-check]:not([data-mc-allow-overflow])")) {
        if (check.scrollWidth - check.clientWidth > tolerance || check.scrollHeight - check.clientHeight > tolerance) add("REGION_OVERFLOW", `Checked region ${selector(check)} scrolls beyond its box.`, { pageId });
      }
      const prose = layout === "photo-led" || layout === "narrative" || layout === "reading"
        ? pageEl.querySelectorAll("[data-region='body'] p")
        : pageEl.querySelectorAll("[data-region='columns'] p,[data-region='sections'] p,[data-region='list-item'] p");
      const minProsePx = web ? 16 : 24;
      for (const paragraph of prose) {
        const size = Number.parseFloat(getComputedStyle(paragraph).fontSize);
        if (Number.isFinite(size) && size < minProsePx) add("PROSE_FONT_SIZE", `Body text is ${size}px; ${viewport.name} stable output requires at least ${minProsePx}px.`, { pageId });
      }
      for (const image of pageEl.querySelectorAll("img[alt]:not([alt=''])")) if (!image.closest("[data-mc-allow-overflow]") && outside(image.getBoundingClientRect())) add("CONTENT_OUTSIDE_PAGE", `Image crosses page boundary: ${JSON.stringify(image.alt)}.`, { pageId });

      if (background && title && !continuation) {
        const br = background.getBoundingClientRect(), tr = title.getBoundingClientRect();
        const values = keylines.get(layout) ?? [];
        values.push({ pageId, backgroundLeft: br.left - pageRect.left, backgroundRight: pageRect.right - br.right, titleLeft: tr.left - pageRect.left });
        keylines.set(layout, values);
      }
      for (const [name, elements] of byName) pageInfo.regions[name] = elements.length;
      const rhythm = (name) => (byName.get(name) ?? []).map((element, itemIndex, all) => itemIndex === 0 ? null : element.getBoundingClientRect().top - all[itemIndex - 1].getBoundingClientRect().bottom).filter((value) => value !== null);
      pageInfo.metrics = { width: pageRect.width, height: pageRect.height, listItemGaps: rhythm("list-item") };
      pages.push(pageInfo);
    }

    for (const [layout, samples] of keylines) {
      if (samples.length < 2) continue;
      const baseline = samples[0];
      for (const sample of samples.slice(1)) for (const metric of ["backgroundLeft", "backgroundRight", "titleLeft"]) {
        if (Math.abs(sample[metric] - baseline[metric]) > 2) add("KEYLINE_DRIFT", `${layout} ${metric} differs by ${Math.abs(sample[metric] - baseline[metric]).toFixed(1)}px from page ${baseline.pageId}.`, { pageId: sample.pageId, metric });
      }
    }
    const ledgerScript = document.querySelector("script#mc-source-ledger[type='application/json']");
    const sourceMode = document.body?.dataset.sourceMode;
    if (!ledgerScript) add("SOURCE_LEDGER_MISSING", "Embedded source ledger is missing.");
    else {
      let ledger;
      try { ledger = JSON.parse(ledgerScript.textContent); }
      catch { add("SOURCE_LEDGER_INVALID", "Embedded source ledger is not valid JSON."); }
      if (Array.isArray(ledger)) {
        const known = new Set(ledger.map((entry) => entry.sourceId));
        const used = [];
        for (const pageEl of pageEls) for (const id of pageEl.dataset.sourceIds.split(",").filter(Boolean)) {
          used.push(id);
          if (!known.has(id)) add("UNKNOWN_SOURCE_ID", `Page references unregistered source ${JSON.stringify(id)}.`, { pageId: pageEl.dataset.pageId });
        }
        for (const entry of ledger) if (!used.includes(entry.sourceId)) add("UNUSED_SOURCE_ID", `Ledger source ${JSON.stringify(entry.sourceId)} is not linked to a page.`);
        if (sourceMode === "final-copy") {
          const actualBlocks = [];
          for (const pageEl of pageEls) {
            for (const element of pageEl.querySelectorAll("[data-region='title'] h1,[data-region='title'] .mc-intro,.mc-composition-intro,[data-region='body'] h2,[data-region='body'] p,[data-region='columns'] h2,[data-region='columns'] p,[data-region='columns'] .mc-detail-label,[data-region='columns'] .mc-detail-text,[data-region='sections'] h2,[data-region='sections'] p,[data-region='sections'] .mc-detail-label,[data-region='sections'] .mc-detail-text,[data-region='list-item'] h2,[data-region='list-item'] p,[data-region='list-item'] .mc-detail-label,[data-region='list-item'] .mc-detail-text")) {
              actualBlocks.push({ text: element.textContent.trim(), type: element.matches("h1") ? "title" : element.matches("h2") ? "heading" : element.matches(".mc-detail-label") ? "label" : "paragraph" });
            }
          }
          const expectedBlocks = ledger.flatMap((entry) => entry.text.split(/\n{2,}/).map((block) => ({ text: block.trim(), type: entry.type })).filter((block) => block.text));
          const length = Math.max(expectedBlocks.length, actualBlocks.length);
          for (let index = 0; index < length; index += 1) {
            const expected = expectedBlocks[index], actual = actualBlocks[index];
            if (expected?.text === actual?.text && (!expected.type || expected.type === actual.type)) continue;
            if (actual === undefined) add("FINAL_COPY_MISSING", `Final-copy block ${index + 1} is missing from the rendered semantic text sequence.`, { expected: expected?.text });
            else if (expected === undefined) add("FINAL_COPY_EXTRA", `Rendered semantic text contains an extra block at position ${index + 1}.`, { actual: actual.text });
            else if (expected.text === actual.text && expected.type && expected.type !== actual.type) add("FINAL_COPY_TYPE", `Final-copy block ${index + 1} has semantic type ${actual.type}; expected ${expected.type}.`, { expected: expected.text, actual: actual.text });
            else if (actualBlocks.slice(index + 1).some((block) => block.text === expected.text) || expectedBlocks.slice(index + 1).some((block) => block.text === actual.text)) add("FINAL_COPY_ORDER", `Final-copy semantic blocks differ in order at position ${index + 1}.`, { expected: expected.text, actual: actual.text });
            else add("FINAL_COPY_CHANGED", `Final-copy semantic block ${index + 1} differs verbatim from its ledger text.`, { expected: expected.text, actual: actual.text });
          }
        } else if (sourceMode !== "rough-material") add("SOURCE_MODE", "body[data-source-mode] must be final-copy or rough-material.");
      }
    }
    const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    if (web && docWidth - document.documentElement.clientWidth > tolerance) add("HORIZONTAL_OVERFLOW", `${viewport.name} document exceeds its viewport width.`);
    return { errors, warnings, pages, theme: { id: themeId ?? null, checkedColorRoles }, document: { width: docWidth, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) } };
  }, { contract, viewport, web });
}

export async function validateBrief(options) {
  await stat(options.input);
  const contract = await loadContract();
  const errors = [];
  const inspections = [];
  let browser;
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true, ...(process.env.MC_CHROMIUM_PATH ? { executablePath: process.env.MC_CHROMIUM_PATH } : {}) });
    for (const viewport of VIEWPORTS[options.web ? "web" : "pages"]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce", colorScheme: "light" });
      const page = await context.newPage();
      const assetFailures = watchFailures(page);
      try {
        await page.goto(pathToFileURL(options.input).href, { waitUntil: "load", timeout: 30_000 });
        await page.evaluate(() => Promise.all([
          document.fonts?.ready ?? Promise.resolve(),
          ...[...document.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); })),
        ]));
        const failedImages = await page.evaluate(() => [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => ({ source: image.currentSrc || image.src, alt: image.alt })));
        errors.push(...assetFailures, ...failedImages.map((image) => issue("IMAGE_FAILED", "Image did not decode to pixels.", image)));
        const inspection = await inspectPage(page, contract, viewport, options.web);
        errors.push(...inspection.errors.map((entry) => ({ viewport: viewport.name, ...entry })));
        inspections.push({ viewport, ...inspection });
      } finally { await context.close(); }
    }
  } catch (error) {
    const diagnostic = new Error(`Chromium render validation could not run: ${error.message}`);
    diagnostic.exitCode = 2;
    diagnostic.cause = error;
    throw diagnostic;
  } finally { if (browser) await browser.close().catch(() => {}); }

  const sourceCodes = new Set(["SOURCE_LEDGER_MISSING", "SOURCE_LEDGER_INVALID", "UNKNOWN_SOURCE_ID", "UNUSED_SOURCE_ID", "FINAL_COPY_MISSING", "FINAL_COPY_EXTRA", "FINAL_COPY_ORDER", "FINAL_COPY_CHANGED", "FINAL_COPY_TYPE", "SOURCE_MODE"]);
  const structureCodes = new Set(["RENDERER_VERSION", "LAYOUTS_VERSION", "CSS_HASH", "CSS_CONTENT", "MATERIAL_CSS_CONTENT", "CSS_HASH_SPLIT", "LAYOUT_STYLE_MISSING", "MATERIAL_STYLE_MISSING", "EXTRA_STYLE", "INLINE_STYLE", "EXTERNAL_STYLESHEET", "EXECUTABLE_SCRIPT", "BRIEF_ROOT", "PAGE_NESTING", "NO_PAGES", "PAGE_ID", "DUPLICATE_PAGE_ID", "PAGE_PURPOSE", "PAGE_SOURCES", "UNKNOWN_LAYOUT", "LAYOUT_ROOT_CLASS", "REQUIRED_REGION", "REGION_PARENT", "BACKGROUND_ROLE", "BACKGROUND_CONTENT", "TITLE_CONTAINER", "EMPTY_LIST_ITEM"]);
  const sourceErrors = errors.filter((entry) => sourceCodes.has(entry.code));
  const structureErrors = errors.filter((entry) => structureCodes.has(entry.code));
  const renderErrors = errors.filter((entry) => !structureCodes.has(entry.code) && !sourceCodes.has(entry.code));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    input: path.basename(options.input),
    mode: options.web ? "web" : "pages",
    status: errors.length ? "failed" : "review_required",
    source: {
      status: sourceErrors.length ? "failed" : "passed",
      mechanicalCoverage: { status: sourceErrors.length ? "failed" : "passed", errors: sourceErrors },
      semantic: { status: "not_reviewed", note: "Rough-material factual fidelity and meaning require an independent source comparison; no string rule claims semantic understanding." },
    },
    structure: { status: structureErrors.length ? "failed" : "passed", errors: structureErrors },
    render: { status: renderErrors.length ? "failed" : "passed", errors: renderErrors, inspections },
    visual: { status: "not_reviewed", note: "Independent review of rendered PNGs against source material and accepted baselines is still required." },
    errors,
  };
}

async function writeReport(filename, report) { await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, "utf8"); }

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  let report;
  try {
    report = await validateBrief(options);
    await writeReport(options.report, report);
    if (report.status === "failed") {
      process.stderr.write(`Validation failed with ${report.errors.length} measurable error(s). See ${options.report}.\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Measurable validation passed; source semantics and visual review remain not_reviewed. See ${options.report}.\n`);
    }
  } catch (error) {
    report = { schemaVersion: 1, generatedAt: new Date().toISOString(), input: path.basename(options.input), mode: options.web ? "web" : "pages", status: "failed", source: { status: "not_reviewed" }, structure: { status: "not_run", errors: [] }, render: { status: "failed", errors: [issue("VALIDATOR_ERROR", error.message)] }, visual: { status: "not_reviewed" }, errors: [issue("VALIDATOR_ERROR", error.message)] };
    await writeReport(options.report, report).catch(() => {});
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
