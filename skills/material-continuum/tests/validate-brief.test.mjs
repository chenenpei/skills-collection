import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderBrief } from "../scripts/render-brief.mjs";

const script = fileURLToPath(new URL("../scripts/validate-brief.mjs", import.meta.url));

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const brief = {
  schemaVersion: "1",
  title: "Stable example",
  theme: "A",
  sourceMode: "rough-material",
  sourceLedger: [{ sourceId: "s1", text: "Input notes for the two practical steps." }],
  pages: [{
    id: "steps",
    layout: "list",
    purpose: "Give two concrete steps",
    sourceIds: ["s1"],
    title: "Two steps",
    items: [
      { heading: "Prepare", paragraphs: ["Gather the material before starting."] },
      { heading: "Review", paragraphs: ["Check the result against the source."] },
    ],
  }],
};

async function fixture(transform = (html) => html, source = brief) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-validate-"));
  const input = path.join(temp, "brief.html");
  const report = path.join(temp, "report.json");
  await writeFile(input, transform(await renderBrief(source, { mode: "pages", ratio: "3:4", baseDir: temp })), "utf8");
  return { input, report };
}

async function validate(transform, source) {
  const files = await fixture(transform, source);
  const result = await run([files.input, "--report", files.report]);
  const report = JSON.parse(await readFile(files.report, "utf8"));
  return { result, report };
}

test("passes measurable stable structure while leaving semantic and visual review explicit", async () => {
  const { result, report } = await validate();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.status, "review_required");
  assert.equal(report.source.mechanicalCoverage.status, "passed");
  assert.equal(report.source.semantic.status, "not_reviewed");
  assert.equal(report.structure.status, "passed");
  assert.equal(report.render.status, "passed");
  assert.equal(report.visual.status, "not_reviewed");
});

test("rejects a missing required region in a tampered skeleton", async () => {
  const { result, report } = await validate((html) => html.replace(' data-region="list"', ""));
  assert.equal(result.code, 1);
  assert.ok(report.errors.some((error) => error.code === "REQUIRED_REGION"));
});

test("rejects embedded layout CSS that differs despite an unchanged declared hash", async () => {
  const { result, report } = await validate((html) => html.replace("/* Material Continuum stable layouts v1.", "/* Material Continuum changed layouts v1."));
  assert.equal(result.code, 1);
  assert.ok(report.errors.some((error) => error.code === "CSS_CONTENT"));
});

test("rejects tampered material CSS and any additional style channel", async () => {
  const material = await validate((html) => html.replace("/* BEGIN DESIGN TOKENS", "/* CHANGED DESIGN TOKENS"));
  assert.equal(material.result.code, 1);
  assert.ok(material.report.errors.some((error) => error.code === "MATERIAL_CSS_CONTENT"));
  const extra = await validate((html) => html.replace("</head>", "<style>.mc-page{font-size:1px}</style></head>"));
  assert.equal(extra.result.code, 1);
  assert.ok(extra.report.errors.some((error) => error.code === "EXTRA_STYLE"));
});

test("rejects reader-facing copy in the background underlay", async () => {
  const { result, report } = await validate((html) => html.replace('data-region="background" aria-hidden="true"></div>', 'data-region="background" aria-hidden="true">wrong layer</div>'));
  assert.equal(result.code, 1);
  assert.ok(report.errors.some((error) => error.code === "BACKGROUND_CONTENT"));
});

test("rejects a removed title and a layout root class mismatch", async () => {
  const noTitle = await validate((html) => html.replace(/<header class="mc-title-region"[\s\S]*?<\/header>/, ""));
  assert.equal(noTitle.result.code, 1);
  assert.ok(noTitle.report.errors.some((error) => error.code === "REQUIRED_REGION"));
  const wrongClass = await validate((html) => html.replace('class="mc-page mc-stable-list"', 'class="mc-page mc-stable-photo-led"'));
  assert.equal(wrongClass.result.code, 1);
  assert.ok(wrongClass.report.errors.some((error) => error.code === "LAYOUT_ROOT_CLASS"));
});

test("final-copy semantic text blocks must match the ledger verbatim and in order", async () => {
  const source = structuredClone(brief);
  source.sourceMode = "final-copy";
  source.sourceLedger = [{ sourceId: "s1", text: "Two steps\n\nPrepare\n\nGather the material before starting.\n\nReview\n\nCheck the result against the source." }];
  const valid = await validate(undefined, source);
  assert.equal(valid.result.code, 0, valid.result.stderr);
  const changed = await validate((html) => html.replace("Check the result against the source.", "Check an altered claim."), source);
  assert.equal(changed.result.code, 1);
  assert.ok(changed.report.errors.some((error) => error.code === "FINAL_COPY_CHANGED"));
  const changedTitle = await validate((html) => html.replace("<span>Two steps</span>", "<span>Three steps</span>"), source);
  assert.equal(changedTitle.result.code, 1);
  assert.ok(changedTitle.report.errors.some((error) => error.code === "FINAL_COPY_CHANGED"));
  const extra = await validate((html) => html.replace("Check the result against the source.</p>", "Check the result against the source.</p><p>Inserted claim.</p>"), source);
  assert.equal(extra.result.code, 1);
  assert.ok(extra.report.errors.some((error) => error.code === "FINAL_COPY_EXTRA" || error.code === "FINAL_COPY_CHANGED"));
  const reversed = await validate((html) => html.replace("<h2>Prepare</h2>", "<h2>__swap__</h2>").replace("<h2>Review</h2>", "<h2>Prepare</h2>").replace("<h2>__swap__</h2>", "<h2>Review</h2>"), source);
  assert.equal(reversed.result.code, 1);
  assert.ok(reversed.report.errors.some((error) => error.code === "FINAL_COPY_ORDER" || error.code === "FINAL_COPY_CHANGED"));
});

test("final-copy typed blocks preserve type as well as exact text and order", async () => {
  const source = structuredClone(brief);
  source.sourceMode = "final-copy";
  source.sourceLedger = [
    { sourceId: "s1", type: "title", text: "Two steps" },
    { sourceId: "s2", type: "heading", text: "Prepare" },
    { sourceId: "s3", type: "paragraph", text: "Gather the material before starting." },
    { sourceId: "s4", type: "heading", text: "Review" },
    { sourceId: "s5", type: "paragraph", text: "Check the result against the source." },
  ];
  source.pages[0].sourceIds = ["s1", "s2", "s3", "s4", "s5"];
  const valid = await validate(undefined, source);
  assert.equal(valid.result.code, 0, valid.result.stderr);
  const wrongType = structuredClone(source);
  wrongType.sourceLedger[1].type = "paragraph";
  const invalid = await validate(undefined, wrongType);
  assert.equal(invalid.result.code, 1);
  assert.ok(invalid.report.errors.some((error) => error.code === "FINAL_COPY_TYPE"));
});

test("validates the exact eight-block five-page cover and continuation source sequence", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-validate-five-page-"));
  await writeFile(path.join(temp, "cover.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#ff5252"/></svg>');
  const entries = [
    ["p1", "title", "封面标题"], ["p2", "paragraph", "承接段落。"],
    ["p3", "title", "第三页"], ["p4", "paragraph", "第三页正文。"],
    ["p5", "title", "第四页"], ["p6", "paragraph", "第四页正文。"],
    ["p7", "title", "第五页"], ["p8", "paragraph", "第五页正文。"],
  ];
  const source = {
    schemaVersion: "1", sourceMode: "final-copy",
    sourceLedger: entries.map(([sourceId, type, text]) => ({ sourceId, type, text })),
    pages: [
      { id: "cover", layout: "photo-led", cover: true, purpose: "Cover", sourceIds: ["p1"], title: "封面标题", image: { src: "cover.svg", alt: "封面图" }, blocks: [], footer: "01 / 05" },
      { id: "continuation", layout: "reading", continuation: true, purpose: "Continue", sourceIds: ["p2"], blocks: [{ paragraphs: ["承接段落。"] }], footer: "02 / 05" },
      ...[["third", "p3", "第三页", "p4", "第三页正文。"], ["fourth", "p5", "第四页", "p6", "第四页正文。"], ["fifth", "p7", "第五页", "p8", "第五页正文。"]].map(([id, titleId, title, bodyId, body], index) => ({ id, layout: "reading", purpose: id, sourceIds: [titleId, bodyId], title, blocks: [{ paragraphs: [body] }], footer: `0${index + 3} / 05` })),
    ],
  };
  const input = path.join(temp, "brief.html");
  const reportPath = path.join(temp, "report.json");
  await writeFile(input, await renderBrief(source, { baseDir: temp, mode: "pages", ratio: "3:4" }));
  const result = await run([input, "--report", reportPath]);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.source.mechanicalCoverage.status, "passed");
  assert.equal(report.structure.status, "passed");
  assert.equal(report.render.status, "passed");
  assert.equal(report.render.inspections[0].pages.length, 5);
});

test("rejects letterboxed scene images and photo title overlap with reserved space only", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-scene-geometry-"));
  await writeFile(path.join(temp, "wide.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400"><rect width="1200" height="400" fill="#3f51b5"/></svg>');
  await writeFile(path.join(temp, "four-three.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#ff5252"/></svg>');
  const source = {
    schemaVersion: "1", sourceMode: "rough-material", sourceLedger: [{ sourceId: "s1", text: "Scene source" }],
    pages: [
      { id: "photo", layout: "photo-led", purpose: "Photo", sourceIds: ["s1"], title: "Photo", image: { src: "wide.svg", alt: "Wide scene", fit: "contain" }, blocks: [{ paragraphs: ["Body"] }] },
      { id: "narrative", layout: "narrative", purpose: "Narrative", sourceIds: ["s1"], title: "Narrative", image: { src: "four-three.svg", alt: "Four by three scene", fit: "contain" }, blocks: [{ paragraphs: ["Body"] }] },
    ],
  };
  const input = path.join(temp, "brief.html");
  const reportPath = path.join(temp, "report.json");
  await writeFile(input, await renderBrief(source, { baseDir: temp, mode: "pages", ratio: "3:4" }));
  const result = await run([input, "--report", reportPath]);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(result.code, 1);
  assert.equal(report.errors.filter((error) => error.code === "SCENE_IMAGE_LETTERBOX").length, 2);
  assert.ok(report.errors.some((error) => error.code === "PHOTO_TITLE_IMAGE_OVERLAP"));
  const photo = report.errors.find((error) => error.code === "SCENE_IMAGE_LETTERBOX" && error.pageId === "photo");
  const narrative = report.errors.find((error) => error.code === "SCENE_IMAGE_LETTERBOX" && error.pageId === "narrative");
  assert.ok(photo.painted.y > 100, JSON.stringify(photo));
  assert.ok(narrative.painted.x > 50, JSON.stringify(narrative));
});

test("rejects long unbreakable text that overflows a checked region", async () => {
  const word = "unbreakable".repeat(400);
  const { result, report } = await validate((html) => html.replace("Gather the material before starting.", word));
  assert.equal(result.code, 1);
  assert.ok(report.errors.some((error) => error.code === "REGION_OVERFLOW" || error.code === "CONTENT_OUTSIDE_PAGE"));
});

test("rejects regressions in registered header, reading, icon, and list geometry", async () => {
  const source = structuredClone(brief);
  source.pages = [
    { id: "header", layout: "sections", purpose: "Check header", sourceIds: ["s1"], title: "Two-line\nheader", sections: [{ heading: "A", paragraphs: ["Copy"], icon: "description" }, { heading: "B", paragraphs: ["Copy"], icon: "description" }] },
    brief.pages[0],
    { ...brief.pages[0], id: "list-footer", footer: "Footer" },
    { id: "reading", layout: "reading", purpose: "Check reading", sourceIds: ["s1"], title: "Reading", footer: "Footer", blocks: [{ paragraphs: ["Compact prose."] }] },
  ];
  const { result, report } = await validate((html) => html.replace("</head>", `<style>
    .mc-header { min-height: 100px !important; padding-block: 0 !important; }
    .mc-list-item:last-child { border-bottom: 1px solid black !important; }
    .mc-stable-reading { padding-top: 72px !important; }
    .mc-stable-reading .mc-article-sheet { min-height: 1350px !important; }
    .mc-stable-list .mc-list-sheet { min-height: 1350px !important; }
    .mc-section-visual.mc-visual-icon { width: 270px !important; height: 210px !important; }
  </style></head>`), source);
  assert.equal(result.code, 1);
  for (const code of ["HEADER_INSET", "LIST_TERMINAL_DIVIDER", "READING_CROSS_BOUNDARY", "READING_FOOTER_CLEARANCE", "LIST_FOOTER_CLEARANCE", "ICON_SLOT_SCALE"]) assert.ok(report.errors.some((error) => error.code === code), code);
});

test("a missing browser is a failed render check, never a skipped pass", async () => {
  const files = await fixture();
  const result = await run([files.input, "--report", files.report], { MC_CHROMIUM_PATH: path.join(files.input, "missing-browser") });
  assert.equal(result.code, 2);
  const report = JSON.parse(await readFile(files.report, "utf8"));
  assert.equal(report.render.status, "failed");
  assert.equal(report.visual.status, "not_reviewed");
});

test("rejects noncanonical theme metadata and a missing leading card marker", async () => {
  const source = structuredClone(brief);
  source.theme = "E-owl";
  source.pages[0].kicker = "Review notes";
  const { result, report } = await validate((html) => html
    .replace('<body data-theme="E-owl"', '<body data-theme="B"')
    .replace('<span class="mc-reading-accent mc-reading-accent-dot" aria-hidden="true"></span>', ""), source);
  assert.equal(result.code, 1, result.stderr);
  assert.ok(report.errors.some((error) => error.code === "THEME_ID"));
  assert.ok(report.errors.some((error) => error.code === "THEME_READING_MARKER"));
});

test("checks actual dark-paper, marker and emphasis colors even when theme tokens are present", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-theme-validation-"));
  await writeFile(path.join(temp, "art.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 720"><rect width="1080" height="720" fill="#303030"/></svg>');
  const source = { ...structuredClone(brief), theme: "D-dark", pages: [
    { id: "story", layout: "narrative", purpose: "Explain a relationship", sourceIds: ["s1"], title: "Organize ideas", image: { src: "art.svg", alt: "Neutral scene" }, blocks: [{ paragraphs: ["A short explanation."] }], emphasis: "Read / Compare / Refine" },
    { id: "reading", layout: "reading", purpose: "Read the reasoning", sourceIds: ["s1"], kicker: "Notes", title: "Give reading room", blocks: [{ paragraphs: ["A complete paragraph remains legible on the dark paper."] }] },
  ] };
  const input = path.join(temp, "brief.html"), reportPath = path.join(temp, "report.json");
  const clean = await renderBrief(source, { baseDir: temp });
  await writeFile(input, clean);
  const baseline = await run([input, "--report", reportPath]);
  assert.equal(baseline.code, 0, baseline.stderr);
  const baselineReport = JSON.parse(await readFile(reportPath, "utf8"));
  assert.ok(baselineReport.render.inspections[0].theme.checkedColorRoles >= 5);
  await writeFile(input, clean.replace("</head>", `<style>
    .mc-article-sheet p { color: #212121 !important; }
    .mc-reading-accent-dot { background: #FFDE03 !important; }
    .mc-narrative-emphasis { color: #0336FF !important; font-size: 18px !important; }
  </style></head>`));
  const result = await run([input, "--report", reportPath]);
  assert.equal(result.code, 1, result.stderr);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  for (const role of ["onSurface", "readingMarker", "emphasisText"]) assert.ok(report.errors.some((error) => error.code === "THEME_ROLE_COLOR" && error.role === role), role);
  assert.ok(report.errors.some((error) => error.code === "THEME_EMPHASIS_SIZE"));
});
