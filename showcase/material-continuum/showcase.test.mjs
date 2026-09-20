import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
const { chromium } = createRequire(import.meta.url)("../../skills/material-continuum/node_modules/playwright");

const showcaseUrl = new URL("./index.html", import.meta.url).href;
const labels = ["靛蓝珊瑚", "青绿琥珀", "明紫薄荷", "黑白灰 · 浅色", "黑白灰 · 深色", "Owl 活泼", "深蓝灰"];
const recommendations = [
  "图文均衡的作品",
  "生活、服务与社区类内容",
  "文化、阅读和创意类内容",
  "偏阅读的照片与文字作品",
  "沉浸式的照片与文字展示",
  "短内容、课程介绍与推广",
  "有照片或精炼图示的专题",
];

async function openShowcase(context) {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(showcaseUrl);
  await page.waitForFunction(() => [...document.querySelectorAll("iframe")].length === 6
    && [...document.querySelectorAll("iframe")].every((frame) => frame.contentDocument?.body.style.transform));
  return page;
}

test("showcase uses the approved theme names from the overview", async () => {
  const registry = JSON.parse(await readFile(new URL("../../skills/material-continuum/assets/color-themes.json", import.meta.url), "utf8"));
  assert.deepEqual(registry.themes.map((theme) => theme.label), labels);
  assert.deepEqual(registry.themes.map((theme) => theme.recommendation), recommendations);
});

test("showcase keeps every page's text inside the displayed canvas after ratio changes", async (context) => {
  const page = await openShowcase(context);
  const failures = [];
  for (const width of [1440, 680, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const ratio of ["16:9", "1:1", "3:4", "16:9"]) {
      await page.locator(`#ratio-controls button[data-ratio="${ratio}"]`).click();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const issues = await page.evaluate(() => {
        const issues = [];
        if (document.documentElement.scrollWidth > innerWidth) issues.push("outer horizontal overflow");
        for (const frame of document.querySelectorAll(".showcase-frame")) {
          const iframe = frame.querySelector("iframe");
          const doc = iframe.contentDocument;
          const canvas = doc.querySelector(`[data-page-id="${frame.dataset.pageId}"]`);
          const bounds = canvas.getBoundingClientRect();
          const visiblePages = [...doc.querySelectorAll(".mc-page")].filter((item) => doc.defaultView.getComputedStyle(item).display !== "none");
          if (visiblePages.length !== 1) issues.push(`${frame.dataset.pageId}: ${visiblePages.length} visible pages`);
          for (const element of canvas.querySelectorAll("h1,h2,p,.mc-kicker,.mc-footer")) {
            const box = element.getBoundingClientRect();
            if (!box.width || !box.height || box.left < bounds.left - 1 || box.top < bounds.top - 1
              || box.right > bounds.right + 1 || box.bottom > Math.min(bounds.bottom, iframe.clientHeight) + 1) {
              issues.push(`${frame.dataset.pageId}: clipped ${element.textContent.trim()}`);
            }
          }
          if (doc.body.dataset.mcRatio === "16:9" && ["photo-led", "narrative"].includes(canvas.dataset.layout)
            && doc.defaultView.getComputedStyle(canvas).display !== "grid") issues.push(`${frame.dataset.pageId}: lost wide grid`);
        }
        return issues;
      });
      failures.push(...issues.map((issue) => `${width}px ${ratio}: ${issue}`));
    }
  }
  assert.deepEqual(failures, []);
});

test("showcase keeps square section rows aligned and wide reading on the shared grid", async (context) => {
  const page = await openShowcase(context);
  await page.locator(`#ratio-controls button[data-ratio="1:1"]`).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const square = await page.locator('.showcase-frame[data-page-id="04-sections"] iframe').evaluate((frame) => {
    const root = frame.contentDocument.querySelector('[data-page-id="04-sections"]');
    const region = root.querySelector('.mc-sections-region');
    const rows = [...root.querySelectorAll('.mc-section-row')].map((row) => {
      const visual = row.querySelector('.mc-section-visual').getBoundingClientRect();
      const copy = row.querySelector(':scope > div:last-child').getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return { display: getComputedStyle(row).display, rowLeft: bounds.left, visualTop: visual.top, copyTop: copy.top };
    });
    return { columns: getComputedStyle(region).gridTemplateColumns.trim().split(/\s+/).length, rows };
  });
  assert.equal(square.columns, 1);
  assert.equal(square.rows.length, 3);
  for (const row of square.rows) {
    assert.equal(row.display, "grid");
    assert.ok(Math.abs(row.visualTop - row.copyTop) < 1, JSON.stringify(row));
  }
  assert.ok(new Set(square.rows.map((row) => Math.round(row.rowLeft))).size === 1, JSON.stringify(square));

  await page.locator(`#ratio-controls button[data-ratio="16:9"]`).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wide = await page.evaluate(() => {
    const positions = {};
    for (const id of ["05-list", "06-reading"]) {
      const frame = document.querySelector(`.showcase-frame[data-page-id="${id}"] iframe`);
      const root = frame.contentDocument.querySelector(`[data-page-id="${id}"]`);
      positions[id] = root.querySelector("h1").getBoundingClientRect().left;
    }
    return positions;
  });
  assert.ok(Math.abs(wide["05-list"] - wide["06-reading"]) < 1, JSON.stringify(wide));
});

test("only the selected theme button is highlighted, including dark theme selection", async (context) => {
  const page = await openShowcase(context);
  const buttons = page.locator("#theme-controls button");
  const failures = [];
  for (let selected = 0; selected < 7; selected++) {
    await buttons.nth(selected).click();
    const states = await buttons.evaluateAll((elements) => elements.map((element) => ({
      selected: element.getAttribute("aria-pressed") === "true",
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
    })));
    assert.equal(states.filter((state) => state.selected).length, 1);
    const inactive = states.filter((state) => !state.selected);
    if (new Set(inactive.map((state) => `${state.background}/${state.color}`)).size !== 1)
      failures.push(`selection ${selected}: inconsistent inactive colors`);
    if (states[selected].background === inactive[0].background)
      failures.push(`selection ${selected}: no active background distinction`);
    const dot = await buttons.nth(selected).locator(".dot").evaluate((element) => getComputedStyle(element).boxShadow);
    if (dot === "none") failures.push(`selection ${selected}: theme dot is invisible`);
  }
  assert.deepEqual(failures, []);
});
