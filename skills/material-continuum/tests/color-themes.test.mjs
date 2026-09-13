import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTheme, THEME_IDS, themeCss, syncThemeCss } from "../scripts/color-themes.mjs";
import { renderBrief } from "../scripts/render-brief.mjs";

const reading = { id: "reading", layout: "reading", purpose: "Read a point.", sourceIds: ["s1"], kicker: "Notes", title: "A title", blocks: [{ paragraphs: ["Body text."] }] };
const brief = (theme, page = reading) => ({ schemaVersion: "1", sourceMode: "rough-material", theme, sourceLedger: [{ sourceId: "s1", text: "Source" }], pages: [page] });

test("seven production themes resolve independently; legacy names are supported aliases", () => {
  assert.deepEqual(THEME_IDS, ["A", "B-bright", "C-bright", "D-light", "D-dark", "E-owl", "F-slate"]);
  assert.equal(resolveTheme().id, "A");
  assert.equal(resolveTheme("B").id, "B-bright");
  assert.equal(resolveTheme("C2").id, "C-bright");
  assert.throws(() => resolveTheme("unknown"), /input.theme/);
  const f = resolveTheme("F-slate").roles;
  assert.equal(f.displayField, "#202033");
  assert.equal(f.coloredHeading, "#202033");
  assert.equal(f.emphasisText, "#FF0266");
  assert.equal(f.readingMarker, "#FFDE03");
  assert.equal(f.coverAccent, "#FFDE03");
  assert.equal(resolveTheme("E-owl").roles.emphasisText, resolveTheme("E-owl").roles.readingMarker);
  assert.equal(resolveTheme("D-dark").roles.surface, "#242424");
  assert.equal(resolveTheme("D-dark").roles.onSurface, "#FAFAFA");
});

test("every theme produces standalone HTML with current, renderer-owned CSS", async () => {
  await syncThemeCss({ check: true });
  const material = await readFile(new URL("../assets/material.css", import.meta.url), "utf8");
  assert.ok(material.includes(themeCss()));
  for (const name of [...THEME_IDS, "B", "C2"]) {
    const html = await renderBrief(brief(name));
    assert.ok(html.includes(`data-theme="${resolveTheme(name).id}"`));
    assert.ok(html.includes(`<style id="mc-material-css">${material}</style>`));
    assert.equal((html.match(/<style\b/g) ?? []).length, 2);
    assert.doesNotMatch(html, /<link\b|\sstyle="/);
    assert.match(html, /mc-reading-accent mc-reading-accent-dot/);
  }
});

test("narrative emphasis is a separate plain-text role and is rejected on other layouts", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mc-theme-"));
  await writeFile(path.join(temp, "art.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  const page = { ...reading, layout: "narrative", id: "narrative", image: { src: "art.svg", alt: "Artwork" }, emphasis: "Literal <em> & words" };
  const html = await renderBrief(brief("E-owl", page), { baseDir: temp });
  assert.match(html, /<p class="mc-narrative-emphasis">Literal &lt;em&gt; &amp; words<\/p>/);
  assert.match(html, /\.mc-stable-narrative \.mc-body-region p \{ color: var\(--ink\)/);
  assert.match(html, /\.mc-narrative-emphasis \{ color: var\(--emphasis-text\)/);
  await assert.rejects(renderBrief(brief("A", { ...reading, emphasis: "Unsupported" })), /unknown field "emphasis"/);
  await assert.rejects(renderBrief(brief("A", { ...page, emphasis: "x".repeat(161) })), /too long/);
});

test("heading, field, marker, and graphic roles cannot silently collapse together", async () => {
  const css = await readFile(new URL("../assets/page-layouts.css", import.meta.url), "utf8");
  assert.match(css, /\.mc-reading-accent \{[^}]*background: var\(--reading-marker\)/);
  assert.match(css, /\.mc-column h2 \{ color: var\(--heading\)/);
  assert.match(css, /\.mc-title-sheet \.mc-page-title \{ color: var\(--display-heading\)/);
  assert.doesNotMatch(css, /\.mc-section-row:nth-child\(2\).*background: var\(--accent\)/);
  assert.match(css, /\.mc-narrative-emphasis \{ font-size: 24px/);
});
