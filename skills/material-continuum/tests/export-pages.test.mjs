import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/export-pages.mjs", import.meta.url));

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("exports .mc-page elements in DOM order with exact dimensions", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-export-ok-"));
  const input = path.join(temp, "input.html");
  const out = path.join(temp, "out");
  await writeFile(
    input,
    `<!doctype html><style>
      * { box-sizing: border-box } html, body { margin: 0 } body { background: #ccc }
      .mc-page { width: 320px; height: 240px; overflow: hidden; background: white; position: relative }
      .bleed { position: absolute; inset: -20px; background: radial-gradient(circle, #f00, transparent); }
      .copy { position: relative; width: 250px; height: 100px; }
    </style>
    <section class="mc-page" data-page-id="cover"><div class="bleed" aria-hidden="true"></div><div class="copy" data-mc-check>Cover</div></section>
    <section class="mc-page" id="details"><div class="copy" data-mc-check>Details</div></section>`,
  );

  const result = await run([input, "--out", out, "--width", "320", "--height", "240", "--scale", "2"]);
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.screenshots.map(({ filename, pageId, width, height }) => ({ filename, pageId, width, height })),
    [
      { filename: "01.png", pageId: "cover", width: 640, height: 480 },
      { filename: "02.png", pageId: "details", width: 640, height: 480 },
    ],
  );
});

test("fails before publishing PNGs when a checked region overflows", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-export-overflow-"));
  const input = path.join(temp, "input.html");
  const out = path.join(temp, "out");
  await writeFile(
    input,
    `<!doctype html><style>
      * { box-sizing: border-box } html, body { margin: 0 }
      .mc-page { width: 320px; height: 240px; overflow: hidden }
      .copy { width: 120px; height: 24px; overflow: hidden; white-space: nowrap }
    </style><main class="mc-page"><div id="copy" class="copy" data-mc-check="x">This sentence cannot fit in its box.</div></main>`,
  );

  const result = await run([input, "--out", out, "--width", "320", "--height", "240"]);
  assert.equal(result.code, 1);
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.ok(report.errors.some((error) => error.code === "CHECK_OVERFLOW" && error.target === "#copy"));
  await assert.rejects(readFile(path.join(out, "01.png")));
});

test("reports a missing image asset and does not publish a partial export", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-export-asset-"));
  const input = path.join(temp, "input.html");
  const out = path.join(temp, "out");
  await writeFile(
    input,
    `<!doctype html><style>html, body { margin: 0 } .mc-page { width: 320px; height: 240px }</style>
    <main class="mc-page"><img src="missing.png" alt="Required product photo"></main>`,
  );

  const result = await run([input, "--out", out, "--width", "320", "--height", "240"]);
  assert.equal(result.code, 1);
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  assert.ok(report.errors.some((error) => error.code === "ASSET_REQUEST_FAILED" || error.code === "IMAGE_FAILED"));
  await assert.rejects(readFile(path.join(out, "01.png")));
});

test("web mode captures fixed desktop and mobile viewports", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-export-web-"));
  const input = path.join(temp, "input.html");
  const out = path.join(temp, "out");
  await writeFile(
    input,
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>
      * { box-sizing: border-box } html, body { margin: 0; max-width: 100%; overflow-x: clip }
      main { width: 100%; min-height: 1600px; padding: 2rem; display: flex; flex-direction: column }
      footer { margin-top: auto }
    </style><main data-mc-check><h1>Responsive page</h1><p>Fits both viewports.</p><footer>Below-fold ending</footer></main>`,
  );

  const result = await run([input, "--out", out, "--web"]);
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.screenshots.map(({ filename, width, height, viewport }) => ({ filename, width, height, viewport })),
    [
      { filename: "desktop.png", width: 1440, height: 1600, viewport: { width: 1440, height: 900 } },
      { filename: "mobile.png", width: 390, height: 1600, viewport: { width: 390, height: 844 } },
    ],
  );
});

test("web mode checks marked overflow below the initial viewport", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-export-web-overflow-"));
  const input = path.join(temp, "input.html");
  const out = path.join(temp, "out");
  await writeFile(
    input,
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>
      html, body { margin: 0; overflow-x: clip }
      .spacer { height: 1000px }
      .checked { width: 280px; overflow: hidden; white-space: nowrap }
      .wide { width: 600px }
    </style><div class="spacer"></div><div class="checked" data-mc-check="x"><div class="wide">Below-fold content that exceeds its checked region</div></div>`,
  );

  const result = await run([input, "--out", out, "--web"]);
  assert.equal(result.code, 1);
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  assert.ok(report.errors.some((error) => error.code === "CHECK_OVERFLOW"));
  await assert.rejects(readFile(path.join(out, "manifest.json")));
});

test("an unexpected rerun failure invalidates stale success and preserves unrelated PNGs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-export-reuse-"));
  const input = path.join(temp, "input.html");
  const out = path.join(temp, "out");
  await mkdir(out);
  await writeFile(input, `<!doctype html><style>html,body{margin:0}.mc-page{width:320px;height:240px}</style><main class="mc-page">Valid</main>`);
  await writeFile(path.join(out, "01.png"), "old owned export");
  await writeFile(path.join(out, "99.png"), "unrelated png");
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, screenshots: [{ filename: "01.png" }] }),
  );

  const result = await run(
    [input, "--out", out, "--width", "320", "--height", "240"],
    { MC_CHROMIUM_PATH: path.join(temp, "browser-does-not-exist") },
  );
  assert.equal(result.code, 2);
  await assert.rejects(readFile(path.join(out, "manifest.json")));
  assert.equal(await readFile(path.join(out, "01.png"), "utf8"), "old owned export");
  assert.equal(await readFile(path.join(out, "99.png"), "utf8"), "unrelated png");
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.errors[0].code, "EXPORT_ERROR");
});
