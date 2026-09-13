#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const DEFAULTS = Object.freeze({
  width: 1080,
  height: 1440,
  scale: 1,
  maxPages: 100,
  maxWebHeight: 20_000,
  timeout: 30_000,
});

function usage() {
  return `Usage:
  node scripts/export-pages.mjs <input.html> --out <directory> [options]

Page export options:
  --width <px>       CSS page width (default: 1080)
  --height <px>      CSS page height (default: 1440)
  --scale <number>   PNG pixels per CSS pixel (default: 1; range: 0.25-4)
  --max-pages <n>    Refuse larger documents (default: 100)
  --max-web-height <px>
                      Refuse taller responsive pages (default: 20000)
  --timeout <ms>     Navigation and asset timeout (default: 30000)

Responsive web mode:
  --web              Capture full pages from 1440x900 and 390x844 viewports

The HTML must contain .mc-page elements unless --web is used. Add data-mc-check
to text/content regions that must not scroll internally. Add
data-mc-allow-overflow to an intentional exception.`;
}

function failArgument(message) {
  const error = new Error(`${message}\n\n${usage()}`);
  error.exitCode = 2;
  throw error;
}

function numberOption(raw, name, { min, max, integer = false }) {
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    failArgument(`Invalid ${name}: expected ${integer ? "an integer" : "a number"} from ${min} to ${max}.`);
  }
  return value;
}

function parseArgs(argv) {
  let input;
  let out;
  let web = false;
  let width = DEFAULTS.width;
  let height = DEFAULTS.height;
  let scale = DEFAULTS.scale;
  let maxPages = DEFAULTS.maxPages;
  let maxWebHeight = DEFAULTS.maxWebHeight;
  let timeout = DEFAULTS.timeout;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--web") {
      web = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.split("=", 2);
      const raw = inlineValue ?? argv[++index];
      if (raw === undefined || raw.startsWith("--")) failArgument(`Missing value for ${name}.`);
      if (name === "--out") out = raw;
      else if (name === "--width") width = numberOption(raw, name, { min: 64, max: 4096, integer: true });
      else if (name === "--height") height = numberOption(raw, name, { min: 64, max: 4096, integer: true });
      else if (name === "--scale") scale = numberOption(raw, name, { min: 0.25, max: 4 });
      else if (name === "--max-pages") maxPages = numberOption(raw, name, { min: 1, max: 500, integer: true });
      else if (name === "--max-web-height") maxWebHeight = numberOption(raw, name, { min: 844, max: 50_000, integer: true });
      else if (name === "--timeout") timeout = numberOption(raw, name, { min: 1_000, max: 120_000, integer: true });
      else failArgument(`Unknown option: ${name}.`);
      continue;
    }
    if (input) failArgument("Only one input HTML file may be supplied.");
    input = arg;
  }

  if (!input) failArgument("Missing input HTML file.");
  if (!out) failArgument("Missing required --out directory.");
  return {
    help: false,
    input: path.resolve(input),
    out: path.resolve(out),
    web,
    width,
    height,
    scale,
    maxPages,
    maxWebHeight,
    timeout,
  };
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    const diagnostic = new Error(
      "Playwright is required but is not available. Run `npm install` in the " +
        "material-continuum skill directory, followed by `npx playwright install chromium`.\n" +
        `Original error: ${error.message}`,
    );
    diagnostic.exitCode = 2;
    throw diagnostic;
  }
}

function cleanUrl(url) {
  if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return null;
  return url;
}

function watchAssetFailures(page) {
  const failures = [];
  const relevant = new Set(["document", "stylesheet", "script", "image", "media", "font"]);
  page.on("requestfailed", (request) => {
    if (!relevant.has(request.resourceType())) return;
    const url = cleanUrl(request.url());
    if (url) failures.push({ url, type: request.resourceType(), reason: request.failure()?.errorText ?? "request failed" });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!relevant.has(request.resourceType()) || response.status() < 400) return;
    const url = cleanUrl(response.url());
    if (url) failures.push({ url, type: request.resourceType(), reason: `HTTP ${response.status()}` });
  });
  return failures;
}

async function waitForAssets(page, timeout) {
  await page.evaluate((waitMs) => {
    for (const image of document.images) image.loading = "eager";
    const waitForImages = Promise.all(
      [...document.images].map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
    const waitForFonts = document.fonts?.ready ?? Promise.resolve();
    return Promise.race([
      Promise.all([waitForImages, waitForFonts]),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Assets did not settle within ${waitMs}ms`)), waitMs)),
    ]);
  }, timeout);

  return page.evaluate(() => {
    const images = [...document.images]
      .filter((image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0)
      .map((image) => ({
        source: image.currentSrc || image.src || "(image without src)",
        alt: image.alt || "",
        reason: image.complete ? "decoded to zero pixels" : "did not finish loading",
      }));
    const fonts = document.fonts
      ? [...document.fonts]
          .filter((font) => font.status === "error")
          .map((font) => ({ family: font.family, style: font.style, weight: font.weight }))
      : [];
    return { images, fonts, fontStatus: document.fonts?.status ?? "unsupported" };
  });
}

async function inspectPrintPages(page, options) {
  return page.evaluate(
    ({ width, height, maxPages }) => {
      const tolerance = 1;
      const pages = [...document.querySelectorAll(".mc-page")];
      const errors = [];
      if (pages.length === 0) errors.push({ code: "NO_PAGES", message: "No .mc-page elements were found." });
      if (pages.length > maxPages) {
        errors.push({ code: "TOO_MANY_PAGES", message: `Found ${pages.length} pages; maximum is ${maxPages}.` });
      }

      const seenIds = new Set();
      const results = pages.slice(0, maxPages).map((pageElement, pageIndex) => {
        const rect = pageElement.getBoundingClientRect();
        const pageId = pageElement.dataset.pageId || pageElement.id || `page-${pageIndex + 1}`;
        const pageErrors = [];
        if (seenIds.has(pageId)) {
          pageErrors.push({ code: "DUPLICATE_PAGE_ID", message: `Page ID ${JSON.stringify(pageId)} is duplicated.` });
        }
        seenIds.add(pageId);
        if (Math.abs(rect.width - width) > tolerance || Math.abs(rect.height - height) > tolerance) {
          pageErrors.push({
            code: "PAGE_SIZE",
            message: `Expected ${width}x${height} CSS pixels, rendered ${rect.width.toFixed(2)}x${rect.height.toFixed(2)}.`,
          });
        }

        for (const check of pageElement.querySelectorAll("[data-mc-check]:not([data-mc-allow-overflow])")) {
          const axis = (check.getAttribute("data-mc-check") || "both").toLowerCase();
          const overflowX = check.scrollWidth - check.clientWidth > tolerance;
          const overflowY = check.scrollHeight - check.clientHeight > tolerance;
          if ((axis === "x" && overflowX) || (axis === "y" && overflowY) || (axis !== "x" && axis !== "y" && (overflowX || overflowY))) {
            pageErrors.push({
              code: "CHECK_OVERFLOW",
              target: check.id ? `#${check.id}` : check.className ? `.${String(check.className).trim().split(/\s+/).join(".")}` : check.tagName.toLowerCase(),
              message: `Checked region scrolls ${check.scrollWidth}x${check.scrollHeight} inside ${check.clientWidth}x${check.clientHeight}.`,
            });
          }
        }

        const outside = (candidate) =>
          candidate.right > rect.right + tolerance ||
          candidate.bottom > rect.bottom + tolerance ||
          candidate.left < rect.left - tolerance ||
          candidate.top < rect.top - tolerance;

        const walker = document.createTreeWalker(pageElement, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || parent.closest("[data-mc-allow-overflow], [aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
            const style = getComputedStyle(parent);
            return style.display === "none" || style.visibility === "hidden" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
          },
        });
        let textNode;
        while ((textNode = walker.nextNode())) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          if ([...range.getClientRects()].some(outside)) {
            const excerpt = textNode.textContent.trim().replace(/\s+/g, " ").slice(0, 80);
            pageErrors.push({ code: "CONTENT_OUTSIDE_PAGE", message: `Text crosses the page boundary: ${JSON.stringify(excerpt)}.` });
          }
        }

        for (const image of pageElement.querySelectorAll("img[alt]:not([alt=''])")) {
          if (image.closest("[data-mc-allow-overflow], [aria-hidden='true']")) continue;
          if (outside(image.getBoundingClientRect())) {
            pageErrors.push({ code: "CONTENT_OUTSIDE_PAGE", message: `Meaningful image crosses the page boundary: ${JSON.stringify(image.alt)}.` });
          }
        }

        errors.push(...pageErrors.map((error) => ({ pageId, pageIndex: pageIndex + 1, ...error })));
        return {
          index: pageIndex + 1,
          pageId,
          cssWidth: rect.width,
          cssHeight: rect.height,
          checks: pageElement.querySelectorAll("[data-mc-check]").length,
        };
      });
      return { pages: results, errors };
    },
    { width: options.width, height: options.height, maxPages: options.maxPages },
  );
}

async function inspectWebPage(page, variant) {
  return page.evaluate(({ name, width, height }) => {
    const root = document.documentElement;
    const body = document.body;
    const errors = [];
    const tolerance = 1;
    const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
    const clientWidth = root.clientWidth;
    if (scrollWidth - clientWidth > tolerance) {
      errors.push({
        code: "HORIZONTAL_OVERFLOW",
        message: `${name} document is ${scrollWidth}px wide in a ${clientWidth}px viewport.`,
      });
    }
    for (const check of document.querySelectorAll("[data-mc-check]:not([data-mc-allow-overflow])")) {
      const axis = (check.getAttribute("data-mc-check") || "both").toLowerCase();
      const overflowX = check.scrollWidth - check.clientWidth > tolerance;
      const overflowY = check.scrollHeight - check.clientHeight > tolerance;
      if ((axis === "x" && overflowX) || (axis === "y" && overflowY) || (axis !== "x" && axis !== "y" && (overflowX || overflowY))) {
        errors.push({ code: "CHECK_OVERFLOW", message: `A checked ${check.tagName.toLowerCase()} region overflows at ${name}.` });
      }
    }
    return {
      variant: name,
      viewport: { width, height },
      document: { scrollWidth, scrollHeight: Math.max(root.scrollHeight, body?.scrollHeight ?? 0) },
      errors,
    };
  }, variant);
}

function pngDimensions(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) throw new Error("Screenshot was not a valid PNG.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function writeJson(filename, value) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function commitStagedFiles(staging, out, names) {
  for (const name of names) await rename(path.join(staging, name), path.join(out, name));
  await rm(staging, { recursive: true, force: true });
}

function safePngBasename(value) {
  return typeof value === "string" && value === path.basename(value) && value.toLowerCase().endsWith(".png") ? value : null;
}

async function readManifestOwnedScreenshots(out) {
  try {
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    if (!Array.isArray(manifest.screenshots)) return [];
    return manifest.screenshots.map(({ filename }) => safePngBasename(filename)).filter(Boolean);
  } catch {
    return [];
  }
}

async function clearPriorExportFiles(out, previousNames, currentNames) {
  const names = new Set([...previousNames, ...currentNames].map(safePngBasename).filter(Boolean));
  for (const name of names) {
    await rm(path.join(out, name), { force: true });
  }
}

async function makePage(browser, viewport, scale) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();
  return { context, page };
}

async function loadHtml(page, input, timeout) {
  const response = await page.goto(pathToFileURL(input).href, { waitUntil: "load", timeout });
  if (response && !response.ok()) throw new Error(`Input navigation failed with HTTP ${response.status()}.`);
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 5_000) });
  } catch {
    // Fonts and images are checked explicitly; long-lived app requests need not block export.
  }
}

function assetErrors(assetFailures, state) {
  const errors = assetFailures.map((failure) => ({ code: "ASSET_REQUEST_FAILED", ...failure }));
  errors.push(...state.images.map((image) => ({ code: "IMAGE_FAILED", ...image })));
  errors.push(...state.fonts.map((font) => ({ code: "FONT_FAILED", ...font })));
  return errors;
}

async function exportPrint(browser, options, staging) {
  const { context, page } = await makePage(browser, { width: options.width, height: options.height }, options.scale);
  const failures = watchAssetFailures(page);
  try {
    await loadHtml(page, options.input, options.timeout);
    const assets = await waitForAssets(page, options.timeout);
    const inspection = await inspectPrintPages(page, options);
    const errors = [...assetErrors(failures, assets), ...inspection.errors];
    if (errors.length) return { status: "failed", mode: "pages", errors, assets, pages: inspection.pages, screenshots: [] };

    const screenshots = [];
    for (const pageInfo of inspection.pages) {
      const filename = `${String(pageInfo.index).padStart(2, "0")}.png`;
      const locator = page.locator(".mc-page").nth(pageInfo.index - 1);
      const buffer = await locator.screenshot({ path: path.join(staging, filename), type: "png", animations: "disabled", scale: "device" });
      const dimensions = pngDimensions(buffer);
      const expected = { width: Math.round(options.width * options.scale), height: Math.round(options.height * options.scale) };
      if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
        return {
          status: "failed",
          mode: "pages",
          errors: [{ code: "PNG_SIZE", pageId: pageInfo.pageId, message: `Expected ${expected.width}x${expected.height}px PNG, got ${dimensions.width}x${dimensions.height}px.` }],
          assets,
          pages: inspection.pages,
          screenshots,
        };
      }
      screenshots.push({ filename, pageId: pageInfo.pageId, index: pageInfo.index, width: dimensions.width, height: dimensions.height });
    }
    return { status: "ok", mode: "pages", errors: [], assets, pages: inspection.pages, screenshots };
  } finally {
    await context.close();
  }
}

async function exportWeb(browser, options, staging) {
  const variants = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const inspections = [];
  const screenshots = [];
  const errors = [];
  const assets = [];
  for (const variant of variants) {
    const { context, page } = await makePage(browser, { width: variant.width, height: variant.height }, options.scale);
    const failures = watchAssetFailures(page);
    try {
      await loadHtml(page, options.input, options.timeout);
      const state = await waitForAssets(page, options.timeout);
      assets.push({ variant: variant.name, ...state });
      errors.push(...assetErrors(failures, state).map((error) => ({ variant: variant.name, ...error })));
      const inspection = await inspectWebPage(page, variant);
      inspections.push(inspection);
      errors.push(...inspection.errors.map((error) => ({ variant: variant.name, ...error })));
      if (inspection.document.scrollHeight > options.maxWebHeight) {
        errors.push({
          variant: variant.name,
          code: "PAGE_TOO_TALL",
          message: `${variant.name} document is ${inspection.document.scrollHeight}px tall; maximum is ${options.maxWebHeight}px.`,
        });
      }
      if (errors.length) continue;
      const filename = `${variant.name}.png`;
      const buffer = await page.screenshot({ path: path.join(staging, filename), type: "png", animations: "disabled", fullPage: true, scale: "device" });
      const dimensions = pngDimensions(buffer);
      screenshots.push({
        filename,
        variant: variant.name,
        width: dimensions.width,
        height: dimensions.height,
        viewport: { width: variant.width, height: variant.height },
      });
    } finally {
      await context.close();
    }
  }
  return { status: errors.length ? "failed" : "ok", mode: "web", errors, assets, variants: inspections, screenshots };
}

async function run(options) {
  await stat(options.input).catch(() => failArgument(`Input file does not exist: ${options.input}`));
  await mkdir(options.out, { recursive: true });
  const previousScreenshots = await readManifestOwnedScreenshots(options.out);
  const staging = path.join(options.out, `.mc-export-${process.pid}-${Date.now()}`);
  let browser;
  let failureReport;
  try {
    // An export attempt immediately invalidates an earlier success marker. Any
    // later exception will leave a failed report rather than stale success.
    await rm(path.join(options.out, "manifest.json"), { force: true });
    await mkdir(staging, { recursive: true });
    const { chromium } = loadPlaywright();
    try {
      browser = await chromium.launch({
        headless: true,
        ...(process.env.MC_CHROMIUM_PATH ? { executablePath: process.env.MC_CHROMIUM_PATH } : {}),
      });
    } catch (error) {
      const diagnostic = new Error(
        "Chromium could not start. Install the matching browser with `npx playwright install chromium`, " +
          "or set MC_CHROMIUM_PATH to a compatible Chromium/Chrome executable.\n" +
          `Original error: ${error.message}`,
      );
      diagnostic.exitCode = 2;
      throw diagnostic;
    }

    const result = options.web ? await exportWeb(browser, options, staging) : await exportPrint(browser, options, staging);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      input: path.basename(options.input),
      settings: {
        mode: result.mode,
        width: options.web ? undefined : options.width,
        height: options.web ? undefined : options.height,
        maxWebHeight: options.web ? options.maxWebHeight : undefined,
        scale: options.scale,
      },
      ...result,
    };
    if (result.status !== "ok") {
      failureReport = report;
      const error = new Error(`Export validation failed with ${result.errors.length} error(s). See ${path.join(options.out, "report.json")}.`);
      error.exitCode = 1;
      throw error;
    }
    const manifest = {
      schemaVersion: 1,
      mode: result.mode,
      input: path.basename(options.input),
      scale: options.scale,
      screenshots: result.screenshots,
    };
    await writeJson(path.join(staging, "manifest.json"), manifest);
    // The manifest is the success marker. Remove it before replacing prior output,
    // and publish it only after every PNG has landed.
    await rm(path.join(options.out, "manifest.json"), { force: true });
    await writeJson(path.join(options.out, "report.json"), { ...report, status: "publishing" });
    await clearPriorExportFiles(
      options.out,
      previousScreenshots,
      result.screenshots.map(({ filename }) => filename),
    );
    await commitStagedFiles(staging, options.out, [...result.screenshots.map(({ filename }) => filename), "manifest.json"]);
    await writeJson(path.join(options.out, "report.json"), report);
    process.stdout.write(`Exported ${result.screenshots.length} PNG(s) to ${options.out}\n`);
  } catch (error) {
    await rm(path.join(options.out, "manifest.json"), { force: true });
    const report = failureReport ?? {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      input: path.basename(options.input),
      settings: {
        mode: options.web ? "web" : "pages",
        width: options.web ? undefined : options.width,
        height: options.web ? undefined : options.height,
        maxWebHeight: options.web ? options.maxWebHeight : undefined,
        scale: options.scale,
      },
      status: "failed",
      mode: options.web ? "web" : "pages",
      errors: [{ code: "EXPORT_ERROR", message: error.message }],
      screenshots: [],
    };
    await writeJson(path.join(options.out, "report.json"), report);
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    await run(options);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode ?? 1;
}
