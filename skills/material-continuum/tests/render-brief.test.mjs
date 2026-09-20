import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { renderBrief } from "../scripts/render-brief.mjs";

const script = fileURLToPath(new URL("../scripts/render-brief.mjs", import.meta.url));

function source(pages) {
  return {
    schemaVersion: "1",
    sourceMode: "final-copy",
    sourceLedger: [{ sourceId: "s1", text: "Approved source <text>." }],
    pages,
  };
}

function page(layout, extra) {
  return { id: layout, layout, purpose: `Exercise ${layout}.`, sourceIds: ["s1"], title: `${layout}\nlayout`, ...extra };
}

test("renders all six registered families with stable markers and escaped plain text", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-"));
  await writeFile(path.join(temp, "visual.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#3f51b5"/></svg>');
  const image = { src: "visual.svg", alt: "A controlled visual" };
  const prose = [{ heading: "Heading", paragraphs: ["Literal <em>plain text</em> stays text.", "Second paragraph."] }];
  const visual = (heading) => ({ heading, paragraphs: ["Supporting copy."], icon: "description" });
  const input = source([
    page("photo-led", { image, blocks: prose }),
    page("narrative", { image, blocks: prose }),
    page("comparison", { columns: [visual("First"), visual("Second")] }),
    page("sections", { sections: [visual("One"), visual("Two")] }),
    page("list", { items: [visual("One"), visual("Two")] }),
    page("reading", { meta: "Note / 06", blocks: prose }),
  ]);
  const html = await renderBrief(input, { baseDir: temp, ratio: "16:9" });
  assert.match(html, /data-mc-renderer-version="1"/);
  assert.match(html, /data-mc-layouts-version="1"/);
  assert.match(html, /data-mc-css-sha256="[a-f0-9]{64}"/);
  assert.equal((html.match(/class="mc-page /g) ?? []).length, 6);
  for (const layout of ["photo-led", "narrative", "comparison", "sections", "list", "reading"]) assert.match(html, new RegExp(`data-layout="${layout}"`));
  assert.equal((html.match(/data-region="sheet"/g) ?? []).length, 3);
  assert.match(html, /mc-stable-narrative[\s\S]*?mc-narrative-sheet" data-region="sheet"/);
  assert.match(html, /<span>reading<\/span>\s*<span>layout<\/span>/);
  assert.ok(html.includes("Literal &lt;em&gt;plain text&lt;/em&gt; stays text."));
  assert.ok(!html.includes("<em>plain text</em>"));
  assert.equal((html.match(/data-region="list-item"/g) ?? []).length, 2);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /id="mc-source-ledger"/);
  assert.match(html, /Material Icons[\s\S]*Source: https:\/\/github.com\/google\/material-design-icons[\s\S]*Apache License/);
});

test("rejects arbitrary fields, unregistered sources, unsafe paths, and active SVG", async () => {
  const base = page("reading", { blocks: [{ paragraphs: ["Body"] }] });
  await assert.rejects(renderBrief(source([{ ...base, css: "body{}" }])), /unknown field "css"/);
  await assert.rejects(renderBrief(source([page("photo-led", { image: { src: "missing.png", alt: "Image", fit: "stretch" }, blocks: [{ paragraphs: ["Body"] }] })])), /expected cover or contain/);
  await assert.rejects(renderBrief(source([{ ...base, items: [{ heading: "Lost", paragraphs: ["Copy"] }] }])), /unknown field "items"/);
  await assert.rejects(renderBrief(source([page("comparison", { columns: [{ heading: "Visual", paragraphs: ["Copy"], icon: "description" }, { heading: "Text", paragraphs: ["Copy"] }] })])), /both have visuals or both be text-only/);
  await assert.rejects(renderBrief(source([{ ...base, sourceIds: ["missing"] }])), /unregistered sourceId/);
  await assert.rejects(renderBrief(source([page("photo-led", { image: { src: "../outside.png", alt: "Outside" }, blocks: [{ paragraphs: ["Body"] }] })]), { baseDir: os.tmpdir() }), /leaves the input JSON directory/);
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-svg-"));
  await writeFile(path.join(temp, "bad.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(renderBrief(source([page("photo-led", { image: { src: "bad.svg", alt: "Unsafe" }, blocks: [{ paragraphs: ["Body"] }] })]), { baseDir: temp }), /active or external content/);
});

test("mixed and text-only rows do not reserve empty visual columns", async () => {
  const input = source([
    page("sections", { sections: [{ heading: "No visual", paragraphs: ["Full width"] }, { heading: "Icon", paragraphs: ["Visual row"], icon: "description" }] }),
    page("list", { items: [{ heading: "No visual", paragraphs: ["Full width"] }, { heading: "Icon", paragraphs: ["Visual row"], icon: "description" }] }),
  ]);
  const html = await renderBrief(input);
  const markup = html.match(/<main class="mc-brief">([\s\S]*?)<\/main>/)?.[1] ?? "";
  assert.equal((markup.match(/data-has-visual="false"/g) ?? []).length, 2);
  assert.equal((markup.match(/data-has-visual="true"/g) ?? []).length, 2);
  assert.equal((markup.match(/data-visual-kind="icon"/g) ?? []).length, 2);
  assert.match(html, /\.mc-list-item\[data-has-visual="false"\] \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /\.mc-section-row\[data-has-visual="false"\] \{ display: block;/);
});

test("details render as escaped semantic facts with calibrated geometry", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const input = source([
    page("comparison", { columns: [
      { heading: "First", paragraphs: [], details: [{ label: "LABEL <1>", text: "Body & one" }, { label: "LABEL 2", text: "Body two" }] },
      { heading: "Second", details: [{ label: "LABEL 3", text: "Body three" }, { label: "LABEL 4", text: "Body four" }] },
    ] }),
    page("sections", { sections: [
      { heading: "Section", details: [{ label: "A", text: "Alpha" }, { label: "B", text: "Beta" }] },
      { heading: "Section two", paragraphs: ["Ordinary body"] },
    ] }),
    page("list", { items: [
      { heading: "List", details: [{ label: "C", text: "Gamma" }, { label: "D", text: "Delta" }] },
      { heading: "List two", paragraphs: ["Ordinary body"] },
    ] }),
  ]);
  const html = await renderBrief(input, { mode: "pages", ratio: "3:4" });
  assert.ok(html.includes("LABEL &lt;1&gt;"));
  assert.ok(html.includes("Body &amp; one"));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
    await browserPage.setContent(html, { waitUntil: "load" });
    const geometry = await browserPage.evaluate(() => {
      const detail = document.querySelector(".mc-detail");
      const next = detail.nextElementSibling;
      const label = detail.querySelector(".mc-detail-label").getBoundingClientRect();
      const body = detail.querySelector(".mc-detail-text").getBoundingClientRect();
      return {
        count: document.querySelectorAll(".mc-details").length,
        labelBodyGap: body.top - label.bottom,
        detailGap: next.getBoundingClientRect().top - detail.getBoundingClientRect().bottom,
        labelSize: getComputedStyle(detail.querySelector(".mc-detail-label")).fontSize,
      };
    });
    assert.equal(geometry.count, 4);
    assert.equal(geometry.labelBodyGap, 14);
    assert.equal(geometry.detailGap, 32);
    assert.equal(geometry.labelSize, "18px");
  } finally {
    await browser.close();
  }
});

test("five-page final-copy edition supports a title-only cover and titleless continuation", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-five-page-"));
  await writeFile(path.join(temp, "cover.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#ff5252"/></svg>');
  const entries = [
    ["p1", "title", "封面标题"], ["p2", "paragraph", "承接上一页的原文段落。"],
    ["p3", "title", "第三页"], ["p4", "paragraph", "第三页正文。"],
    ["p5", "title", "第四页"], ["p6", "paragraph", "第四页正文。"],
    ["p7", "title", "第五页"], ["p8", "paragraph", "第五页正文。"],
  ];
  const input = {
    schemaVersion: "1", sourceMode: "final-copy",
    sourceLedger: entries.map(([sourceId, type, text]) => ({ sourceId, type, text })),
    pages: [
      { id: "cover", layout: "photo-led", cover: true, purpose: "Cover", sourceIds: ["p1"], title: "封面标题", image: { src: "cover.svg", alt: "封面图", fit: "contain" }, blocks: [], footer: "01 / 05" },
      { id: "continuation", layout: "reading", continuation: true, purpose: "Continue", sourceIds: ["p2"], blocks: [{ paragraphs: ["承接上一页的原文段落。"] }], footer: "02 / 05" },
      ...[["third", "p3", "第三页", "p4", "第三页正文。"], ["fourth", "p5", "第四页", "p6", "第四页正文。"], ["fifth", "p7", "第五页", "p8", "第五页正文。"]].map(([id, titleId, title, bodyId, body]) => ({ id, layout: "reading", purpose: id, sourceIds: [titleId, bodyId], title, blocks: [{ paragraphs: [body] }], footer: `${id} / 05` })),
    ],
  };
  const html = await renderBrief(input, { baseDir: temp, mode: "pages", ratio: "3:4" });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
    await browserPage.setContent(html, { waitUntil: "load" });
    const result = await browserPage.evaluate(() => {
      const cover = document.querySelector("[data-cover='true']");
      const continuation = document.querySelector("[data-continuation='true']");
      const coverPage = cover.getBoundingClientRect();
      const image = cover.querySelector(".mc-image-region").getBoundingClientRect();
      const title = cover.querySelector(".mc-title-sheet").getBoundingClientRect();
      const paragraph = continuation.querySelector(".mc-body-region p");
      const sheet = continuation.querySelector(".mc-article-sheet").getBoundingClientRect();
      return { pages: document.querySelectorAll(".mc-page").length, titles: document.querySelectorAll("h1").length, coverImageHeight: image.height, titleCrossesImage: title.top < image.bottom && title.bottom > image.bottom, coverBottom: coverPage.bottom, footerHeight: cover.querySelector(".mc-footer").getBoundingClientRect().height, continuationHasH1: Boolean(continuation.querySelector("h1")), continuationParagraphInset: paragraph.getBoundingClientRect().top - sheet.top, continuationFont: getComputedStyle(paragraph).fontSize, continuationLineHeight: getComputedStyle(paragraph).lineHeight };
    });
    assert.equal(result.pages, 5);
    assert.equal(result.titles, 4);
    assert.equal(result.coverImageHeight, 1000);
    assert.equal(result.titleCrossesImage, true);
    assert.ok(result.footerHeight > 0);
    assert.equal(result.continuationHasH1, false);
    assert.equal(result.continuationParagraphInset, 202);
    assert.equal(result.continuationFont, "34px");
    assert.equal(result.continuationLineHeight, "61.2px");
  } finally {
    await browser.close();
  }
});

test("every family places supplied kickers and image fit is explicit", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-fields-"));
  await writeFile(path.join(temp, "visual.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="none" stroke="currentColor" d="M1 1h8v8H1z"/></svg>');
  const image = { src: "visual.svg", alt: "Exact alt", credit: "Exact credit", fit: "contain" };
  const item = (heading) => ({ heading, paragraphs: [`${heading} body`] });
  const html = await renderBrief(source([
    { ...page("photo-led", { kicker: "PHOTO KICKER", intro: "PHOTO INTRO", footer: "PHOTO FOOTER", image, blocks: [{ paragraphs: ["PHOTO BODY"] }] }), purpose: "PHOTO PURPOSE" },
    page("narrative", { kicker: "NARRATIVE KICKER", image, blocks: [{ paragraphs: ["NARRATIVE BODY"] }] }),
    page("comparison", { kicker: "COMPARISON KICKER", columns: [item("A"), item("B")] }),
    page("sections", { kicker: "SECTIONS KICKER", sections: [item("A"), item("B")] }),
    page("list", { kicker: "LIST KICKER", items: [item("A"), item("B")] }),
    { ...page("reading", { kicker: "READ KICKER", intro: "READ INTRO", footer: "READ FOOTER", meta: "READ META", blocks: [{ paragraphs: ["READ BODY"] }] }), purpose: "READ PURPOSE" },
  ]), { baseDir: temp });
  for (const expected of ["PHOTO KICKER", "NARRATIVE KICKER", "COMPARISON KICKER", "SECTIONS KICKER", "LIST KICKER", "READ KICKER", "PHOTO INTRO", "PHOTO FOOTER", "PHOTO PURPOSE", "Exact alt", "Exact credit", "PHOTO BODY", "READ INTRO", "READ FOOTER", "READ PURPOSE", "READ META", "READ BODY"]) assert.ok(html.includes(expected), expected);
  assert.equal((html.match(/<figure\b[^>]*data-image-fit="contain"/g) ?? []).length, 2);
  assert.match(html, /mc-stable-narrative[\s\S]*?mc-copy-plane mc-narrative-sheet" data-region="sheet"><header class="mc-title-region"[\s\S]*?NARRATIVE KICKER[\s\S]*?<h1/);
  assert.match(html, /mc-stable-comparison[\s\S]*?mc-header"><header class="mc-title-region"[\s\S]*?COMPARISON KICKER/);
  assert.match(html, /mc-stable-list[\s\S]*?mc-list-sheet[\s\S]*?LIST KICKER/);
});

test("sections shared image and notes preserve safe fields, embedded media, and default card accents", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-extensions-"));
  await writeFile(path.join(temp, "wide.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 10"><rect width="35" height="10" fill="#3f51b5"/></svg>');
  const html = await renderBrief(source([
    page("sections", {
      image: { src: "wide.svg", alt: "Complete shared flow", fit: "contain" },
      sections: [{ heading: "First", paragraphs: ["First flow."] }, { heading: "Second", paragraphs: ["Second flow."] }],
      notes: { heading: "Context", paragraphs: ["Secondary explanation.", "Closing note."] },
    }),
    page("list", { kicker: "STEPS", items: [{ heading: "A", paragraphs: ["A"] }, { heading: "B", paragraphs: ["B"] }] }),
    page("reading", { kicker: "NOTE", blocks: [{ paragraphs: ["Short copy."] }] }),
    page("reading", { id: "plain-reading", blocks: [{ paragraphs: ["No kicker stays unobtrusive."] }] }),
  ]), { baseDir: temp });
  assert.match(html, /data-sections-featured="true"/);
  assert.match(html, /class="mc-sections-image"[\s\S]*data:image\/svg\+xml;base64,/);
  assert.ok(html.indexOf('class="mc-sections-image"') < html.indexOf('class="mc-sections-region"'));
  assert.ok(html.indexOf('class="mc-sections-region"') < html.indexOf('class="mc-sections-notes"'));
  assert.match(html, /mc-reading-kicker-row[\s\S]*mc-reading-accent-dot[\s\S]*NOTE/);
  assert.match(html, /mc-stable-list[\s\S]*mc-reading-kicker-row[\s\S]*mc-reading-accent-dot[\s\S]*STEPS/);
  const markup = html.match(/<main class="mc-brief">([\s\S]*?)<\/main>/)?.[1] ?? "";
  assert.equal((markup.match(/mc-reading-accent-dot/g) ?? []).length, 2);
  assert.ok(!html.includes("mc-reading-accent-line"));
  await assert.rejects(renderBrief(source([page("reading", { accent: "button", blocks: [{ paragraphs: ["Body"] }] })])), /expected dot/);
  await assert.rejects(renderBrief(source([page("sections", { sections: [{ heading: "A", paragraphs: ["A"] }, { heading: "B", paragraphs: ["B"] }], notes: { paragraphs: ["Note"], html: "<b>unsafe</b>" } })])), /unknown field "html"/);
});

test("inline icons preserve explicit transparent paths", async () => {
  const html = await renderBrief(source([page("list", { items: [{ heading: "Light", paragraphs: ["Copy"], icon: "lightbulb" }, { heading: "Text", paragraphs: ["Copy"] }] })]));
  assert.match(html, /fill="none"/);
  assert.ok(!html.includes(".mc-icon * { fill: currentColor; }"));
});

test("browser layout gives text-only rows and mobile sections the full content width", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const plain = (heading) => ({ heading, paragraphs: ["这是用于检查合理中文行宽的连续正文。"] });
  const icon = (heading, name = "description") => ({ ...plain(heading), icon: name });
  const input = source([
    page("comparison", { columns: [icon("灯光", "lightbulb"), icon("文档")] }),
    page("sections", { sections: [plain("完整文字行"), icon("图文行")] }),
    page("list", { items: [plain("完整列表行"), icon("图文列表行")] }),
    page("reading", { title: "阅读标题", blocks: [{ paragraphs: ["窄屏下标题与正文应该共享同一条左侧文字轨道。"] }] }),
  ]);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.setContent(await renderBrief(input, { mode: "web" }), { waitUntil: "load" });
    const mobileGeometry = await mobile.evaluate(() => {
      const sectionGrid = document.querySelector(".mc-sections-region");
      const textSection = document.querySelector('.mc-section-row[data-has-visual="false"]');
      const textList = document.querySelector('.mc-list-item[data-has-visual="false"]');
      const columns = document.querySelector(".mc-columns");
      const reading = document.querySelector(".mc-stable-reading");
      const readingTitle = reading.querySelector(".mc-title-region h1").getBoundingClientRect();
      const readingBody = reading.querySelector(".mc-body-region p").getBoundingClientRect();
      const nonePath = document.querySelector('.mc-column-image .mc-icon [fill="none"]');
      const slot = document.querySelector(".mc-column-image").getBoundingClientRect();
      const iconBox = document.querySelector(".mc-column-image .mc-icon").getBoundingClientRect();
      return {
        sectionColumns: getComputedStyle(sectionGrid).gridTemplateColumns,
        textSectionDisplay: getComputedStyle(textSection).display,
        textListColumns: getComputedStyle(textList).gridTemplateColumns,
        columnsWidth: columns.getBoundingClientRect().width,
        readingTextLeftDelta: Math.abs(readingTitle.left - readingBody.left),
        transparentFill: nonePath && getComputedStyle(nonePath).fill,
        iconCenterDelta: Math.abs((slot.left + slot.width / 2) - (iconBox.left + iconBox.width / 2)),
      };
    });
    assert.equal(mobileGeometry.sectionColumns.split(" ").length, 1);
    assert.equal(mobileGeometry.textSectionDisplay, "block");
    assert.ok(!mobileGeometry.textListColumns.includes("90px"));
    assert.ok(mobileGeometry.columnsWidth >= 340, JSON.stringify(mobileGeometry));
    assert.ok(mobileGeometry.readingTextLeftDelta < 1, JSON.stringify(mobileGeometry));
    assert.equal(mobileGeometry.transparentFill, "none");
    assert.ok(mobileGeometry.iconCenterDelta < 1, JSON.stringify(mobileGeometry));

    const wide = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await wide.setContent(await renderBrief(source([page("comparison", { columns: [plain("甲"), plain("乙")] }), page("list", { footer: "List footer", items: [plain("甲"), plain("乙")] }), page("reading", { footer: "Reading footer", blocks: [{ paragraphs: ["这是一段连续阅读文本，用来确认宽屏纸面保持单栏并维持合理行宽。"] }] })]), { mode: "pages", ratio: "16:9" }), { waitUntil: "load" });
    assert.equal(await wide.locator(".mc-column").first().evaluate((element) => getComputedStyle(element).display), "block");
    const reading = await wide.locator(".mc-stable-reading .mc-body-region").evaluate((element) => ({ width: element.getBoundingClientRect().width, columns: getComputedStyle(element.closest(".mc-article-sheet")).columnCount }));
    assert.ok(reading.width <= 840, JSON.stringify(reading));
    assert.ok(reading.columns === "auto" || reading.columns === "1", JSON.stringify(reading));
    const wideCards = await wide.evaluate(() => [...document.querySelectorAll(".mc-stable-list,.mc-stable-reading")].map((page) => {
      const pageRect = page.getBoundingClientRect();
      const sheet = page.querySelector('[data-region="sheet"]').getBoundingClientRect();
      const footer = page.querySelector(".mc-footer").getBoundingClientRect();
      return { top: sheet.top - pageRect.top, height: sheet.height, bottom: sheet.bottom - pageRect.top, clearance: footer.top - sheet.bottom, footerEdges: [footer.left - pageRect.left, pageRect.right - footer.right] };
    }));
    for (const geometry of wideCards) {
      assert.equal(geometry.top, 54);
      assert.equal(geometry.height, 700);
      assert.equal(geometry.bottom, 754);
      assert.ok(geometry.clearance >= 24, JSON.stringify(geometry));
      assert.deepEqual(geometry.footerEdges, [110, 110]);
    }

    await wide.setContent(await renderBrief(source([
      page("comparison", { columns: [icon("甲"), icon("乙")] }),
      page("list", { footer: "List footer", items: [plain("甲"), plain("乙"), plain("丙")] }),
    ]), { mode: "pages", ratio: "16:9" }), { waitUntil: "load" });
    const visualWide = await wide.evaluate(() => {
      const columns = [...document.querySelectorAll(".mc-stable-comparison .mc-column")];
      const comparisonTextUnderHeading = columns.every((column) => {
        const heading = column.querySelector("h2").getBoundingClientRect();
        const paragraph = column.querySelector("p").getBoundingClientRect();
        return paragraph.left >= heading.left && paragraph.top >= heading.bottom;
      });
      const listBorders = [...document.querySelectorAll(".mc-stable-list .mc-list-item")].map((item) => getComputedStyle(item).borderBottomWidth);
      return { comparisonTextUnderHeading, listBorders };
    });
    assert.equal(visualWide.comparisonTextUnderHeading, true, JSON.stringify(visualWide));
    assert.deepEqual(visualWide.listBorders, ["1px", "0px", "0px"]);
  } finally {
    await browser.close();
  }
});

test("3:4 geometry preserves header breathing room, paper seam, compact icon anchors, and an open list ending", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const icon = (heading) => ({ heading, paragraphs: ["Supporting copy."], icon: "description" });
  const html = await renderBrief(source([
    page("comparison", { columns: [icon("First"), icon("Second")] }),
    page("sections", { sections: [icon("One"), icon("Two")] }),
    page("list", { kicker: "STEPS", intro: "A short introduction keeps a deliberate gap after the title.", footer: "List footer", items: [icon("One"), icon("Two")] }),
    page("reading", { blocks: [{ paragraphs: ["Short reading copy should retain the calibrated full paper depth."] }] }),
  ]), { mode: "pages", ratio: "3:4" });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
    await browserPage.setContent(html, { waitUntil: "load" });
    const geometry = await browserPage.evaluate(() => {
      const header = document.querySelector(".mc-header").getBoundingClientRect();
      const title = document.querySelector(".mc-header .mc-title-region").getBoundingClientRect();
      const readingPage = document.querySelector(".mc-stable-reading").getBoundingClientRect();
      const sheet = document.querySelector(".mc-stable-reading .mc-article-sheet").getBoundingClientRect();
      const iconSlots = [...document.querySelectorAll(".mc-column-image.mc-visual-icon,.mc-section-visual.mc-visual-icon")].map((element) => element.getBoundingClientRect());
      const listTitle = document.querySelector(".mc-list-sheet h1").getBoundingClientRect();
      const listIntro = document.querySelector(".mc-list-sheet .mc-intro").getBoundingClientRect();
      const listPage = document.querySelector(".mc-stable-list").getBoundingClientRect();
      const listSheet = document.querySelector(".mc-list-sheet").getBoundingClientRect();
      const listFooter = document.querySelector(".mc-stable-list .mc-footer").getBoundingClientRect();
      return {
        headerTop: title.top - header.top,
        headerBottom: header.bottom - title.bottom,
        sheetTop: sheet.top - readingPage.top,
        sheetBottom: sheet.bottom - readingPage.top,
        sheetHeight: sheet.height,
        seam: readingPage.height * .575,
        lastDivider: getComputedStyle(document.querySelector(".mc-list-item:last-child")).borderBottomWidth,
        maxIconSlot: Math.max(...iconSlots.flatMap((rect) => [rect.width, rect.height])),
        listIntroGap: listIntro.top - listTitle.bottom,
        listSheetTop: listSheet.top - listPage.top,
        listSheetHeight: listSheet.height,
        listSheetBottom: listSheet.bottom - listPage.top,
        listFooterClearance: listFooter.top - listSheet.bottom,
        listFooterEdges: [listFooter.left - listPage.left, listPage.right - listFooter.right],
      };
    });
    assert.ok(geometry.headerTop >= 35 && geometry.headerBottom >= 35, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.sheetTop - 202) <= 1, JSON.stringify(geometry));
    assert.equal(geometry.sheetHeight, 1104);
    assert.ok(geometry.sheetBottom >= geometry.seam + 70, JSON.stringify(geometry));
    assert.equal(geometry.lastDivider, "0px");
    assert.ok(geometry.maxIconSlot <= 120, JSON.stringify(geometry));
    assert.equal(geometry.listIntroGap, 24);
    assert.equal(geometry.listSheetTop, 168);
    assert.equal(geometry.listSheetHeight, 1138);
    assert.equal(geometry.listSheetBottom, 1306);
    assert.ok(geometry.listFooterClearance >= 24, JSON.stringify(geometry));
    assert.deepEqual(geometry.listFooterEdges, [88, 88]);
  } finally {
    await browser.close();
  }
});

test("1:1 image slots clip their media, icon anchors stay compact, and reading clears the footer", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-square-geometry-"));
  await writeFile(path.join(temp, "tall.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800" viewBox="0 0 400 800"><rect width="400" height="800" fill="#3f51b5"/></svg>');
  const image = { src: "tall.svg", alt: "Tall controlled image" };
  const icon = (heading) => ({ heading, paragraphs: ["Copy"], icon: "description" });
  const html = await renderBrief(source([
    page("comparison", { columns: [{ heading: "First", paragraphs: ["Copy"], image }, { heading: "Second", paragraphs: ["Copy"], image }] }),
    page("sections", { sections: [icon("One"), icon("Two")] }),
    page("list", { footer: "List footer", items: [icon("One"), icon("Two")] }),
    { ...page("reading", { blocks: [{ paragraphs: ["Compact copy."] }], footer: "Footer" }), footer: "Footer" },
  ]), { baseDir: temp, mode: "pages", ratio: "1:1" });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    await browserPage.setContent(html, { waitUntil: "load" });
    const geometry = await browserPage.evaluate(() => {
      const slot = document.querySelector(".mc-column-image").getBoundingClientRect();
      const imageRect = document.querySelector(".mc-column-image img").getBoundingClientRect();
      const icon = document.querySelector(".mc-section-visual.mc-visual-icon").getBoundingClientRect();
      const readingPage = document.querySelector(".mc-stable-reading").getBoundingClientRect();
      const sheet = document.querySelector(".mc-stable-reading .mc-article-sheet").getBoundingClientRect();
      const footer = document.querySelector(".mc-stable-reading .mc-footer").getBoundingClientRect();
      const listPage = document.querySelector(".mc-stable-list").getBoundingClientRect();
      const listSheet = document.querySelector(".mc-list-sheet").getBoundingClientRect();
      const listFooter = document.querySelector(".mc-stable-list .mc-footer").getBoundingClientRect();
      return { slotHeight: slot.height, imageBottom: imageRect.bottom, slotBottom: slot.bottom, icon: [icon.width, icon.height], sheetTop: sheet.top - readingPage.top, sheetHeight: sheet.height, sheetBottom: sheet.bottom, footerTop: footer.top, listSheetTop: listSheet.top - listPage.top, listSheetHeight: listSheet.height, listClearance: listFooter.top - listSheet.bottom, readingFooterEdges: [footer.left - readingPage.left, readingPage.right - footer.right], listFooterEdges: [listFooter.left - listPage.left, listPage.right - listFooter.right] };
    });
    assert.equal(geometry.slotHeight, 230);
    assert.ok(geometry.imageBottom <= geometry.slotBottom + 1, JSON.stringify(geometry));
    assert.deepEqual(geometry.icon, [88, 88]);
    assert.equal(geometry.sheetTop, 120);
    assert.equal(geometry.sheetHeight, 830);
    assert.ok(geometry.sheetBottom < geometry.footerTop, JSON.stringify(geometry));
    assert.equal(geometry.listSheetTop, 168);
    assert.equal(geometry.listSheetHeight, 782);
    assert.ok(geometry.listClearance >= 24, JSON.stringify(geometry));
    assert.deepEqual(geometry.readingFooterEdges, [104, 104]);
    assert.deepEqual(geometry.listFooterEdges, [88, 88]);
  } finally {
    await browser.close();
  }
});

test("1:1 featured sections keep a complete wide image, parallel steps, and notes above the footer", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-square-sections-"));
  await writeFile(path.join(temp, "wide.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="732" viewBox="0 0 2048 732"><rect width="2048" height="732" fill="#3f51b5"/></svg>');
  const html = await renderBrief(source([page("sections", {
    image: { src: "wide.svg", alt: "Inspection scene", fit: "contain" },
    sections: [
      { heading: "01 先检查，再报价", paragraphs: ["先判断问题。"] },
      { heading: "02 同意后，才维修", paragraphs: ["确认后继续。"] },
    ],
    notes: { heading: "服务边界", paragraphs: ["两种方式都不能承诺一定修好。", "材料未提供价格、地址、预约网址或处理天数。"] },
    footer: "02 / 02",
  })]), { baseDir: temp, mode: "pages", ratio: "1:1" });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    await browserPage.setContent(html, { waitUntil: "load" });
    const geometry = await browserPage.evaluate(() => {
      const image = document.querySelector(".mc-sections-image").getBoundingClientRect();
      const imageMedia = document.querySelector(".mc-sections-image img").getBoundingClientRect();
      const sections = document.querySelector(".mc-sections-region");
      const notes = document.querySelector(".mc-sections-notes").getBoundingClientRect();
      const footer = document.querySelector(".mc-footer").getBoundingClientRect();
      return {
        image: [image.width, image.height],
        naturalRatio: document.querySelector(".mc-sections-image img").naturalWidth / document.querySelector(".mc-sections-image img").naturalHeight,
        imageMedia: [imageMedia.width, imageMedia.height],
        sectionColumns: getComputedStyle(sections).gridTemplateColumns.split(" ").length,
        notesBottom: notes.bottom,
        footerTop: footer.top,
      };
    });
    assert.ok(Math.abs(geometry.image[0] / geometry.image[1] - geometry.naturalRatio) < 0.01, JSON.stringify(geometry));
    assert.ok(geometry.imageMedia[0] <= geometry.image[0] + 1 && geometry.imageMedia[1] <= geometry.image[1] + 1, JSON.stringify(geometry));
    assert.equal(geometry.sectionColumns, 2);
    assert.ok(geometry.notesBottom <= geometry.footerTop - 24, JSON.stringify(geometry));
  } finally {
    await browser.close();
  }
});

test("3:4 featured sections place headings beside full-width body copy", async (context) => {
  const executablePath = process.env.MC_CHROMIUM_PATH;
  if (!executablePath) return context.skip("set MC_CHROMIUM_PATH for browser geometry verification");
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-portrait-sections-"));
  await writeFile(path.join(temp, "wide.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="600" viewBox="0 0 1800 600"><rect width="1800" height="600" fill="#3f51b5"/></svg>');
  const html = await renderBrief(source([page("sections", {
    image: { src: "wide.svg", alt: "Complete shared flow", fit: "contain" },
    sections: [
      { heading: "Local write", paragraphs: ["Organize and find notes across the complete available width."] },
      { heading: "Manual sync", paragraphs: ["Move selected notes when connection returns."] },
    ],
  })]), { baseDir: temp, mode: "pages", ratio: "3:4" });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const browserPage = await browser.newPage({ viewport: { width: 1080, height: 1440 } });
    await browserPage.setContent(html, { waitUntil: "load" });
    const geometry = await browserPage.evaluate(() => {
      const hero = document.querySelector(".mc-sections-image").getBoundingClientRect();
      const row = document.querySelector(".mc-section-row");
      const heading = row.querySelector("h2").getBoundingClientRect();
      const paragraph = row.querySelector("p").getBoundingClientRect();
      return {
        heroWidth: hero.width,
        headingRight: heading.right,
        paragraphLeft: paragraph.left,
        paragraphRight: paragraph.right,
        heroRight: hero.right,
        verticalOverlap: Math.min(heading.bottom, paragraph.bottom) - Math.max(heading.top, paragraph.top),
      };
    });
    assert.equal(geometry.heroWidth, 904);
    assert.ok(geometry.paragraphLeft > geometry.headingRight, JSON.stringify(geometry));
    assert.ok(geometry.verticalOverlap > 0, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.paragraphRight - geometry.heroRight) <= 1, JSON.stringify(geometry));
  } finally {
    await browser.close();
  }
});

test("capacity errors ask for a semantic split instead of shrinking type", async () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ heading: `Item ${index}`, paragraphs: ["Copy"] }));
  await assert.rejects(renderBrief(source([page("list", { items })])), /split a longer list by meaning/);
  const huge = "段".repeat(901);
  await assert.rejects(renderBrief(source([page("reading", { blocks: [{ paragraphs: [huge] }] })])), /edit or split it at a meaningful boundary/);
});

test("CLI resolves assets from the input directory and writes web output", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-cli-"));
  const inputPath = path.join(temp, "brief.json");
  const outputPath = path.join(temp, "brief.html");
  await writeFile(inputPath, JSON.stringify(source([page("reading", { blocks: [{ paragraphs: ["CLI body."] }] })])));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, inputPath, "--out", outputPath, "--mode", "web", "--ratio", "1:1"]);
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  const html = await readFile(outputPath, "utf8");
  assert.match(html, /data-mc-mode="web" data-mc-ratio="1:1"/);
});
