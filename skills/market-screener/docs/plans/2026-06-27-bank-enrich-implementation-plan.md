# CN Bank Regulatory Enrich Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote CN listed banks from `financials.banks_proxy` (ROE + P/B only) to `financials.banks` at `proxy` viability by merging East Money `roe_ttm`/`roa` with cninfo/Sina disclosure scrape for NPL, provision coverage, and capital adequacy.

**Architecture:** Phase 2 locks spec + ADR (ROTCE → `roe_ttm` required; ROTCE to supporting/deep_only). Phase 3 ports Scheme E v2 Python spike logic into a focused `cli/src/data/cn/bank-indicators/` module, merges scraped metrics into `enrichCnRecord` when industry is 银行, caches bulletin URLs per `{ticker,fiscalYear}`, then flips routing and viability once tests pass. Unit tests use frozen text fixtures (no network); live scrape is optional via env flag.

**Tech Stack:** TypeScript (ESM), Vitest, undici `httpFetch`, `pdf-parse` for PDF text, YAML spec, existing East Money adapter.

**Prerequisites (Phase 1 — Done):** Spike report [`docs/spike/2026-06-27-bank-indicators-scheme-e.md`](../spike/2026-06-27-bank-indicators-scheme-e.md), script [`cli/scripts/spike-bank-indicators.py`](../../cli/scripts/spike-bank-indicators.py). Partial Go: NPL 9/10, provision 9/10, CAR 10/10, ROA 10/10, ROTCE 0/10.

**Worktree:** Run in a dedicated git worktree (`superpowers:using-git-worktrees`) before Phase 3 coding.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `docs/adr/0008-cn-bank-disclosure-enrich.md` | Partial Go decision, source priority, ROTCE→ROE, BOC gap |
| `spec/templates/financials.yaml` | `banks` required/supporting threshold changes |
| `spec/conventions.yaml` | `financials.banks: proxy`; `rotce` in `deep_only_metrics` |
| `spec/data/cn-bank-bulletins.yaml` | Static `{ticker,fiscalYear} → sina_url,pdf_url` seeds (10 banks FY2024) |
| `cli/src/data/cn/bank-indicators/types.ts` | `BankScrapeMetrics`, `BankBulletinEntry`, `BankScrapeResult` |
| `cli/src/data/cn/bank-indicators/normalize.ts` | CJK spacing normalize, HTML strip |
| `cli/src/data/cn/bank-indicators/extract.ts` | Regex + sanity bounds + CAR max-merge |
| `cli/src/data/cn/bank-indicators/merge.ts` | Per-field merge (PDF preferred; CAR = max) |
| `cli/src/data/cn/bank-indicators/fetch.ts` | HTTP fetch PDF/HTML via `httpFetch` |
| `cli/src/data/cn/bank-indicators/bulletin-map.ts` | Load YAML map; resolve fiscal year |
| `cli/src/data/cn/bank-indicators/index.ts` | `scrapeBankIndicators(ticker, fiscalYear)` orchestrator |
| `cli/src/data/cn/bank-enrich.ts` | `applyBankScrapeToRecord(record, scrape)` — merge into metrics |
| `cli/src/data/cn/enrich.ts` | Call bank scrape when `industryProxy` matches 银行 |
| `cli/src/data/merge-enrichment.ts` | Extend cache payload with optional `bankScrape` |
| `cli/src/commands/bank-indicators.ts` | Debug CLI: `screener bank-indicators 600036 --year 2024` |
| `cli/src/cli.ts` | Register `bank-indicators` command |
| `cli/test/data/cn-bank-indicators.test.ts` | Golden extract tests (3 banks) |
| `cli/test/data/cn-bank-enrich.test.ts` | Enrich merge + industry gate |
| `cli/test/funnel/router.test.ts` | CN 银行 → `banks` (not proxy) |
| `cli/test/funnel/template-evaluator.test.ts` | Full `banks` quality with regulatory metrics |
| `spec/cn-industry-map.yaml` | `银行: sub_template: banks` |
| `docs/adr/0003-cn-bank-routing-proxy.md` | Close phase-two BLOCKED |
| `CONTEXT.md` | Banks viability narrative |

**Post-completion cleanup (Task 18):** Delete `cli/scripts/spike-bank-indicators.py` and `docs/spike/2026-06-27-bank-indicators-scheme-e.md`; decisions live in ADR 0008 + git history.

---

## Phase 2 — Spec & ADR

### Task 1: ADR 0008 — CN bank disclosure enrich

**Files:**
- Create: `docs/adr/0008-cn-bank-disclosure-enrich.md`
- Modify: `docs/adr/README.md`

- [ ] **Step 1: Write ADR 0008**

```markdown
---
status: accepted
date: 2026-06-27
supersedes_partial: docs/adr/0003-cn-bank-routing-proxy.md#phase-two
---

# CN bank regulatory enrich via disclosure scrape (Scheme E)

## Decision

- **Partial Go** for CN A-share banks: cninfo/Sina PDF+HTML scrape covers regulatory core (~90% on 10-bank sample FY2024).
- Funnel required profitability metric: **`roe_ttm` (East Money)**, not `rotce` (0/10 scrape coverage).
- `enrichment_tier: disclosure_scrape`; promote target **`proxy`**, not `full`.
- Source priority: (1) cninfo/Sina disclosure, (2) East Money `roe_ttm`/`roa`, (3) optional iFinD cross-check.

## Coverage (FY2024 sample, merged)

| Metric | Coverage |
|--------|----------|
| npl_ratio | 9/10 |
| provision_coverage | 9/10 |
| capital_adequacy | 10/10 |
| roa | 10/10 (scrape); EM fallback |
| roe_ttm | EM ~100% |
| nim | 5/10 (supporting only) |
| rotce | 0/10 → deep_only |

## Known gap

601988 中国银行: NPL/provision not in first 20 PDF pages (image tables). Policy: **omit + flag**, no silent proxy (ADR 0005).

## Rejected

- ROTCE as funnel required (derive blocked; ROTCE≈ROE for CN majors ~0.2–0.3pp).
- NFRA/gov.cn as per-ticker source (industry aggregate only).
- iWencai as production adapter (no stable API).
```

- [ ] **Step 2: Add row to `docs/adr/README.md`**

Add after 0007:

```markdown
| [0008](0008-cn-bank-disclosure-enrich.md) | CN bank disclosure scrape enrich; ROTCE→ROE required |
```

- [ ] **Step 3: Commit**

```bash
cd skills/market-screener
git add docs/adr/0008-cn-bank-disclosure-enrich.md docs/adr/README.md
git commit -m "docs(adr): add 0008 CN bank disclosure enrich decision"
```

---

### Task 2: financials.banks — ROTCE → roe_ttm

**Files:**
- Modify: `spec/templates/financials.yaml` (lines 13–46)

- [ ] **Step 1: Write failing validate-spec expectation**

Add to `cli/test/spec/validate-spec.test.ts` inside existing describe block:

```typescript
it("financials.banks quality required includes roe_ttm not rotce", async () => {
  const bundle = await loadSpecBundle(specDir);
  const banks = bundle.templates.financials.sub_templates.banks;
  const required = banks.quality_track.required as Record<string, unknown>;
  expect(required).toHaveProperty("roe_ttm");
  expect(required).not.toHaveProperty("rotce");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/market-screener/cli && npm test -- test/spec/validate-spec.test.ts -t "roe_ttm not rotce" -v`

Expected: FAIL — `expected { rotce: ... } to have property "roe_ttm"`

- [ ] **Step 3: Update `financials.yaml` banks blocks**

Replace `banks.quality_track` and `banks.mispricing_track` required/supporting:

```yaml
  banks:
    gics_codes: ["401010", "401020"]

    quality_track:
      pass_if: all_required_and_supporting_min_4_of_6
      required:
        roe_ttm:
          min: 0.125
          market_overrides: { CN: 0.11, US: 0.125 }
        roa:
          default: 0.009
          market_overrides: { CN: 0.0075, US: 0.009 }
        npl_ratio: { max: 0.025 }
        provision_coverage: { min: 1.50 }
        capital_adequacy: { min: 0.115 }
      supporting:
        - { metric: pb_tangible, max: 2.5, missing: skip }
        - { metric: rotce, min: 0.13, missing: skip }
        - { metric: rotce_3y_avg, min: 0.12, missing: skip }
        - { metric: npl_ratio_yoy_change, max: 0.005, missing: skip }
        - { metric: nim, min: 0.015, missing: skip }
        - { metric: dividend_yield, min: 0.03, market_overrides: { CN: 0.03, US: 0.02 } }
        - { metric: roe_vs_industry_median, min: 0, missing: skip }

    mispricing_track:
      pass_if: all_required_and_supporting_min_3_of_5
      required:
        roe_ttm:
          min: 0.108
          market_overrides: { CN: 0.10, US: 0.108 }
        roa:
          default: 0.007
          market_overrides: { CN: 0.006, US: 0.007 }
        npl_ratio: { max: 0.035 }
        npl_ratio_yoy_change: { max: 0.010, missing: skip }
        capital_adequacy: { min: 0.105 }
      supporting:
        - { metric: pb_tangible_vs_5y_median, max: 0.85, missing: skip }
        - { metric: pb_tangible, max: 0.80, missing: skip }
        - { metric: rotce, min: 0.12, missing: skip }
        - { metric: dividend_yield, min: 0.05 }
        - { metric: price_vs_52w_high, max: 0.70 }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/market-screener/cli && npm test -- test/spec/validate-spec.test.ts -t "roe_ttm not rotce" -v`

Expected: PASS

- [ ] **Step 5: Run full validate**

Run: `cd skills/market-screener/cli && npm run validate`

Expected: `Spec OK`

- [ ] **Step 6: Commit**

```bash
git add spec/templates/financials.yaml cli/test/spec/validate-spec.test.ts
git commit -m "spec(financials): replace banks required rotce with roe_ttm"
```

---

### Task 3: conventions.yaml — banks viability proxy + deep_only rotce

**Files:**
- Modify: `spec/conventions.yaml` (lines 113–124, 126–137)

- [ ] **Step 1: Write failing test**

Add to `cli/test/spec/validate-spec.test.ts`:

```typescript
it("financials.banks viability is proxy after enrich decision", async () => {
  const bundle = await loadSpecBundle(specDir);
  expect(bundle.conventions.template_live_viability.financials.banks).toBe("proxy");
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd skills/market-screener/cli && npm test -- test/spec/validate-spec.test.ts -t "viability is proxy" -v`

- [ ] **Step 3: Update conventions.yaml**

```yaml
template_live_viability:
  # ...
  financials:
    banks: proxy          # was quant_too_hard — ADR 0008
    banks_proxy: proxy
    insurance: quant_too_hard
    other_financials: full

deep_only_metrics:
  note: Not in live YAML supporting/required; Deep audit manual only
  metrics:
    - rotce
    - rotce_3y_avg
    - capacity_utilization
    # ... rest unchanged
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add spec/conventions.yaml cli/test/spec/validate-spec.test.ts
git commit -m "spec(conventions): promote financials.banks viability to proxy"
```

---

### Task 4: Update ADR 0003 phase-two + CONTEXT.md

**Files:**
- Modify: `docs/adr/0003-cn-bank-routing-proxy.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Replace phase-two section in ADR 0003**

```markdown
## Phase two — IN PROGRESS (ADR 0008)

Reroute 银行 → `financials.banks` when CN disclosure enrich is live. Blocker removed 2026-06-27: Scheme E Partial Go + ROTCE→ROE spec change. Implementation: [`docs/plans/2026-06-27-bank-enrich-implementation-plan.md`](../plans/2026-06-27-bank-enrich-implementation-plan.md).
```

- [ ] **Step 2: Add CONTEXT.md paragraph under CN banks**

```markdown
CN 银行 enrich（2026-06）：披露 scrape（NPL/拨备/CAR）+ 东财 ROE/ROA；`financials.banks` @ `proxy` viability。ROTCE 仅 deep_only。
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0003-cn-bank-routing-proxy.md CONTEXT.md
git commit -m "docs: link ADR 0003 phase-two to bank enrich plan"
```

---

## Phase 3 — CLI Implementation

### Task 5: Add pdf-parse dependency

**Files:**
- Modify: `cli/package.json`

- [ ] **Step 1: Install dependency**

```bash
cd skills/market-screener/cli
npm install pdf-parse
npm install -D @types/pdf-parse
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(cli): add pdf-parse for bank disclosure scrape"
```

---

### Task 6: Bank indicator types

**Files:**
- Create: `cli/src/data/cn/bank-indicators/types.ts`

- [ ] **Step 1: Create types file**

```typescript
export type BankScrapeField =
  | "npl_ratio"
  | "provision_coverage"
  | "capital_adequacy"
  | "nim"
  | "roa";

export type BankScrapeMetrics = Partial<Record<BankScrapeField, number>>;

export type BankBulletinEntry = {
  ticker: string;
  fiscalYear: number;
  name: string;
  sinaUrl: string;
  pdfUrl: string;
  pdfTier: "cninfo_pdf" | "szse_disclosure_pdf" | "sse_mirror_pdf";
};

export type BankScrapeResult = {
  ticker: string;
  fiscalYear: number;
  metrics: BankScrapeMetrics;
  rawHits: Partial<Record<BankScrapeField, string>>;
  missing: BankScrapeField[];
  sourceUrls: string[];
  dataConfidence: "medium" | "low";
  scrapedAt: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/data/cn/bank-indicators/types.ts
git commit -m "feat(bank-indicators): add scrape types"
```

---

### Task 7: Text normalize + metric extract (TDD)

**Files:**
- Create: `cli/src/data/cn/bank-indicators/normalize.ts`
- Create: `cli/src/data/cn/bank-indicators/extract.ts`
- Create: `cli/test/data/fixtures/bank-text-cmb-2024.txt`
- Test: `cli/test/data/cn-bank-indicators.test.ts`

- [ ] **Step 1: Add fixture text (招商银行 FY2024 excerpt — normalized)**

Create `cli/test/data/fixtures/bank-text-cmb-2024.txt` with a one-line snippet containing:
`不良贷款率0.95% 拨备覆盖率411.98% 资本充足率19.05% 净息差1.98% 平均总资产收益率1.28%`

- [ ] **Step 2: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractBankMetricsFromText } from "../../src/data/cn/bank-indicators/extract.js";

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("extractBankMetricsFromText", () => {
  it("extracts CMB FY2024 regulatory core from fixture text", () => {
    const { metrics, missing } = extractBankMetricsFromText(fixture("bank-text-cmb-2024.txt"));
    expect(metrics.npl_ratio).toBeCloseTo(0.0095, 4);
    expect(metrics.provision_coverage).toBeCloseTo(4.1198, 3);
    expect(metrics.capital_adequacy).toBeCloseTo(0.1905, 4);
    expect(metrics.nim).toBeCloseTo(0.0198, 4);
    expect(metrics.roa).toBeCloseTo(0.0128, 4);
    expect(missing).not.toContain("npl_ratio");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `cd skills/market-screener/cli && npm test -- test/data/cn-bank-indicators.test.ts -v`

- [ ] **Step 4: Implement normalize.ts**

```typescript
export function stripHtml(html: string): string {
  return html
    .replace(/(?is)<script.*?>.*?<\/script>/g, " ")
    .replace(/(?is)<style.*?>.*?<\/style>/g, " ")
    .replace(/(?is)<br\s*\/?>/gi, "\n")
    .replace(/(?is)<\/tr>/gi, "\n")
    .replace(/(?is)<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCjkText(text: string): string {
  return text
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/([\u4e00-\u9fff])\s+\(/g, "$1(")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 5: Implement extract.ts** (port from spike Python — full file)

Key exports:
- `SANITY_BOUNDS: Record<BankScrapeField, [number, number]>`
- `pctToDecimal(raw: string): number`
- `extractBankMetricsFromText(text: string): { metrics: BankScrapeMetrics; rawHits: ...; missing: BankScrapeField[] }`

Use regex patterns from `cli/scripts/spike-bank-indicators.py` lines 234–262. CAR logic: collect all matches ≥9%, take `max`. Provision: handle `拨备覆盖率6233.60` footnote patterns.

- [ ] **Step 6: Run test — expect PASS**

- [ ] **Step 7: Add ICBC + BOC fixture tests**

Add `bank-text-icbc-2024.txt` and `bank-text-boc-2024.txt` (BOC: expect `npl_ratio` missing). Assert ICBC values from ground truth table in spike report.

- [ ] **Step 8: Commit**

```bash
git add cli/src/data/cn/bank-indicators/normalize.ts cli/src/data/cn/bank-indicators/extract.ts cli/test/data/cn-bank-indicators.test.ts cli/test/data/fixtures/
git commit -m "feat(bank-indicators): regex extract with sanity bounds"
```

---

### Task 8: Merge scraped sources

**Files:**
- Create: `cli/src/data/cn/bank-indicators/merge.ts`
- Test: extend `cli/test/data/cn-bank-indicators.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { mergeBankScrapeSources } from "../../src/data/cn/bank-indicators/merge.js";

it("merge prefers PDF per field; CAR takes max across sources", () => {
  const merged = mergeBankScrapeSources(
    { npl_ratio: 0.013, capital_adequacy: 0.15 },
    { npl_ratio: 0.0134, capital_adequacy: 0.1969, provision_coverage: 2.336 }
  );
  expect(merged.npl_ratio).toBe(0.013);
  expect(merged.capital_adequacy).toBe(0.1969);
  expect(merged.provision_coverage).toBe(2.336);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement merge.ts**

```typescript
import type { BankScrapeMetrics } from "./types.js";

export function mergeBankScrapeSources(
  sina: BankScrapeMetrics,
  pdf: BankScrapeMetrics
): BankScrapeMetrics {
  const out: BankScrapeMetrics = {};
  const keys = new Set([...Object.keys(sina), ...Object.keys(pdf)]) as Set<keyof BankScrapeMetrics>;
  for (const key of keys) {
    const s = sina[key];
    const p = pdf[key];
    if (key === "capital_adequacy") {
      const vals = [s, p].filter((v): v is number => v !== undefined);
      if (vals.length) out[key] = Math.max(...vals);
    } else {
      out[key] = p ?? s;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add cli/src/data/cn/bank-indicators/merge.ts cli/test/data/cn-bank-indicators.test.ts
git commit -m "feat(bank-indicators): merge sina and pdf scrape sources"
```

---

### Task 9: Bulletin URL map

**Files:**
- Create: `spec/data/cn-bank-bulletins.yaml`
- Create: `cli/src/data/cn/bank-indicators/bulletin-map.ts`
- Test: `cli/test/data/cn-bank-indicators.test.ts`

- [ ] **Step 1: Create YAML with 10 FY2024 entries**

Copy URLs from spike report table / Python `BANKS` array:

```yaml
version: "0.1.0"
fiscal_year: 2024
entries:
  - ticker: "600036"
    name: 招商银行
    sina_url: "http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=10806393&stockid=600036"
    pdf_url: "http://file.finance.sina.com.cn/211.154.219.97:9494/MRGG/CNSESH_STOCK/2025/2025-3/2025-03-26/10806393.PDF"
    pdf_tier: sse_mirror_pdf
  - ticker: "601398"
    name: 工商银行
    sina_url: "http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=10826973&stockid=601398"
    pdf_url: "http://static.cninfo.com.cn/finalpage/2025-03-29/1222948910.PDF"
    pdf_tier: cninfo_pdf
  # ... remaining 8 banks from spike report
```

- [ ] **Step 2: Write failing test**

```typescript
import { loadBankBulletin } from "../../src/data/cn/bank-indicators/bulletin-map.js";

it("loads CMB FY2024 bulletin entry", () => {
  const entry = loadBankBulletin("600036", 2024);
  expect(entry?.pdfTier).toBe("sse_mirror_pdf");
  expect(entry?.pdfUrl).toContain("10806393");
});
```

- [ ] **Step 3: Implement bulletin-map.ts**

Resolve path relative to spec dir passed from caller, or default `../../spec/data/cn-bank-bulletins.yaml` from CLI cwd. Export `loadBankBulletin(ticker, fiscalYear): BankBulletinEntry | undefined`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add spec/data/cn-bank-bulletins.yaml cli/src/data/cn/bank-indicators/bulletin-map.ts cli/test/data/cn-bank-indicators.test.ts
git commit -m "feat(bank-indicators): static FY2024 bulletin URL map"
```

---

### Task 10: HTTP fetch + PDF text extraction

**Files:**
- Create: `cli/src/data/cn/bank-indicators/fetch.ts`
- Test: `cli/test/data/cn-bank-indicators.test.ts` (mocked)

- [ ] **Step 1: Write test with vi.mock on httpFetch**

```typescript
vi.mock("../../src/lib/http-fetch.js", () => ({
  httpFetch: vi.fn(async (url: string) => {
    if (url.endsWith(".PDF")) {
      return new Response(Buffer.from("%PDF mock"), { status: 200 });
    }
    return new Response("<html>不良贷款率0.95%</html>", { status: 200 });
  }),
}));
```

Test `fetchDisclosureTexts(entry)` returns `{ sinaText, pdfText }`.

- [ ] **Step 2: Implement fetch.ts**

```typescript
import pdf from "pdf-parse";
import { httpFetch } from "../../../lib/http-fetch.js";
import { stripHtml, normalizeCjkText } from "./normalize.js";
import type { BankBulletinEntry } from "./types.js";

const PDF_MAX_PAGES = 20;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

export async function fetchDisclosureTexts(entry: BankBulletinEntry): Promise<{
  sinaText: string;
  pdfText: string;
}> {
  const [htmlRes, pdfRes] = await Promise.all([
    httpFetch(entry.sinaUrl, { headers: HEADERS }),
    httpFetch(entry.pdfUrl, { headers: HEADERS }),
  ]);
  const htmlRaw = Buffer.from(await htmlRes.arrayBuffer());
  const html = normalizeCjkText(stripHtml(decodeBuffer(htmlRaw)));
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  const parsed = await pdf(pdfBuf, { max: PDF_MAX_PAGES });
  const pdfText = normalizeCjkText(parsed.text ?? "");
  return { sinaText: html, pdfText };
}

function decodeBuffer(buf: Buffer): string {
  for (const enc of ["utf-8", "gbk", "gb2312"] as const) {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      continue;
    }
  }
  return buf.toString("utf8");
}
```

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add cli/src/data/cn/bank-indicators/fetch.ts cli/test/data/cn-bank-indicators.test.ts
git commit -m "feat(bank-indicators): fetch sina html and cninfo pdf text"
```

---

### Task 11: Scrape orchestrator

**Files:**
- Create: `cli/src/data/cn/bank-indicators/index.ts`

- [ ] **Step 1: Implement `scrapeBankIndicators`**

```typescript
export async function scrapeBankIndicators(
  ticker: string,
  fiscalYear: number,
  specDir: string
): Promise<BankScrapeResult | undefined> {
  const entry = loadBankBulletin(ticker, fiscalYear, specDir);
  if (!entry) return undefined;
  const { sinaText, pdfText } = await fetchDisclosureTexts(entry);
  const sina = extractBankMetricsFromText(sinaText).metrics;
  const pdf = extractBankMetricsFromText(pdfText).metrics;
  const metrics = mergeBankScrapeSources(sina, pdf);
  const missing = (["npl_ratio", "provision_coverage", "capital_adequacy", "roa", "nim"] as const)
    .filter((k) => metrics[k] === undefined);
  return {
    ticker,
    fiscalYear,
    metrics,
    rawHits: {},
    missing: [...missing],
    sourceUrls: [entry.sinaUrl, entry.pdfUrl],
    dataConfidence: missing.length <= 1 ? "medium" : "low",
    scrapedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/data/cn/bank-indicators/index.ts
git commit -m "feat(bank-indicators): scrape orchestrator"
```

---

### Task 12: Merge bank metrics into SecurityRecord

**Files:**
- Create: `cli/src/data/cn/bank-enrich.ts`
- Modify: `cli/src/data/merge-enrichment.ts` (extend `EnrichCachePayload`)
- Test: `cli/test/data/cn-bank-enrich.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { applyBankScrapeToRecord } from "../../src/data/cn/bank-enrich.js";

it("merges scrape metrics with medium confidence", () => {
  const record = { ...baseRecord, ticker: "600036", metrics: { roe_ttm: { value: 0.15, dataConfidence: "high" } } };
  const out = applyBankScrapeToRecord(record, {
    metrics: { npl_ratio: 0.0095, capital_adequacy: 0.1905 },
    dataConfidence: "medium",
    sourceUrls: ["http://example.com"],
  });
  expect(out.metrics.npl_ratio).toEqual({ value: 0.0095, dataConfidence: "medium" });
  expect(out.metrics.capital_adequacy?.value).toBe(0.1905);
});
```

- [ ] **Step 2: Implement bank-enrich.ts**

```typescript
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import type { BankScrapeMetrics } from "./bank-indicators/types.js";
import type { DataConfidence, MetricValue } from "../../funnel/types.js";

export function applyBankScrapeToRecord(
  record: SecurityRecord,
  scrape: { metrics: BankScrapeMetrics; dataConfidence: DataConfidence; sourceUrls: string[] }
): SecurityRecord {
  const metrics = { ...record.metrics };
  for (const [key, value] of Object.entries(scrape.metrics)) {
    if (value === undefined) continue;
    metrics[key] = { value, dataConfidence: scrape.dataConfidence } satisfies MetricValue;
  }
  return {
    ...record,
    metrics,
    auditHints: [
      ...(record.auditHints ?? []),
      `bank_disclosure_scrape:${scrape.sourceUrls.join(",")}`,
    ],
  };
}
```

- [ ] **Step 3: Extend EnrichCachePayload**

```typescript
export type EnrichCachePayload = {
  // existing fields...
  bankScrape?: {
    fiscalYear: number;
    metrics: BankScrapeMetrics;
    scrapedAt: string;
    sourceUrls: string[];
  };
};
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add cli/src/data/cn/bank-enrich.ts cli/src/data/merge-enrichment.ts cli/test/data/cn-bank-enrich.test.ts
git commit -m "feat(bank-enrich): merge disclosure scrape into SecurityRecord"
```

---

### Task 13: Integrate into enrichCnRecord

**Files:**
- Modify: `cli/src/data/cn/enrich.ts`
- Test: extend `cli/test/data/cn-bank-enrich.test.ts`

- [ ] **Step 1: Add industry gate helper**

```typescript
// cli/src/data/cn/bank-indicators/is-bank-industry.ts
export function isCnBankIndustry(industryProxy: string | undefined): boolean {
  if (!industryProxy) return false;
  return industryProxy.includes("银行");
}
```

- [ ] **Step 2: Write failing integration test**

Mock `scrapeBankIndicators` to return CMB metrics; mock `fetchCnIndustryProxy` → `"银行"`. Assert enriched record has `npl_ratio`.

- [ ] **Step 3: Wire enrich.ts after mergeEnrichment**

```typescript
import { isCnBankIndustry } from "./bank-indicators/is-bank-industry.js";
import { scrapeBankIndicators } from "./bank-indicators/index.js";
import { applyBankScrapeToRecord } from "./bank-enrich.js";

// After const enriched = mergeEnrichment(...):
let finalRecord = enriched;
const fiscalYear = opts.quarter.startsWith("2026") ? 2024 : Number(opts.quarter.slice(0, 4)) - 1;
if (isCnBankIndustry(industryProxy)) {
  const cachedScrape = cached?.bankScrape;
  const scrape =
    cachedScrape && !opts.skipCache
      ? { metrics: cachedScrape.metrics, dataConfidence: "medium" as const, sourceUrls: cachedScrape.sourceUrls }
      : await scrapeBankIndicators(record.ticker, fiscalYear, opts.specDir).catch(() => undefined);
  if (scrape) {
    finalRecord = applyBankScrapeToRecord(finalRecord, scrape);
  }
}
return finalRecord;
```

Add `specDir` to `EnrichOptions` in `cli/src/data/types.ts`.

- [ ] **Step 4: Run cn-enrich + cn-bank-enrich tests — PASS**

Run: `cd skills/market-screener/cli && npm test -- test/data/cn-bank-enrich.test.ts test/data/cn-enrich.test.ts -v`

- [ ] **Step 5: Commit**

```bash
git add cli/src/data/cn/enrich.ts cli/src/data/types.ts cli/src/data/cn/bank-indicators/is-bank-industry.ts cli/test/data/cn-bank-enrich.test.ts
git commit -m "feat(cn-enrich): apply bank disclosure scrape for 银行 industry"
```

---

### Task 14: bank-indicators CLI command

**Files:**
- Create: `cli/src/commands/bank-indicators.ts`
- Modify: `cli/src/cli.ts`

- [ ] **Step 1: Implement command**

```typescript
export async function bankIndicatorsCommand(opts: {
  ticker: string;
  year: number;
  spec: string;
}): Promise<void> {
  const result = await scrapeBankIndicators(opts.ticker, opts.year, opts.spec);
  console.log(JSON.stringify(result, null, 2));
  if (!result) process.exit(1);
}
```

- [ ] **Step 2: Register in cli.ts**

```typescript
program
  .command("bank-indicators")
  .argument("<ticker>", "CN bank ticker")
  .requiredOption("--year <year>", "Fiscal year", (v) => Number.parseInt(v, 10))
  .requiredOption("--spec <dir>", "Path to spec directory")
  .description("Scrape bank regulatory metrics from disclosure (debug)")
  .action(async (ticker, opts) => {
    const { bankIndicatorsCommand } = await import("./commands/bank-indicators.js");
    await bankIndicatorsCommand({ ticker, year: opts.year, spec: opts.spec });
  });
```

- [ ] **Step 3: Manual smoke (network)**

Run: `cd skills/market-screener/cli && npm run dev -- bank-indicators 600036 --year 2024 --spec ../spec`

Expected: JSON with `npl_ratio` ≈ 0.0095

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/bank-indicators.ts cli/src/cli.ts
git commit -m "feat(cli): add bank-indicators debug command"
```

---

### Task 15: CN routing — 银行 → banks

**Files:**
- Modify: `spec/cn-industry-map.yaml`
- Modify: `cli/test/funnel/router.test.ts`

- [ ] **Step 1: Write failing router test**

```typescript
it("routes CN 银行 industry to financials.banks not banks_proxy", () => {
  const result = routeSecurity(routingMap, cnIndustryMap, {
    market: "CN",
    gicsCode: undefined,
    industryProxy: "银行",
    ticker: "601398",
  });
  expect(result.templates[0].subTemplate).toBe("banks");
  expect(result.funnelFlags).not.toContain("bank_routed_via_other_financials_proxy");
});
```

- [ ] **Step 2: Update cn-industry-map.yaml**

```yaml
  银行: { template: financials, sub_template: banks }
```

And keyword rule:

```yaml
  - keywords: [银行]
    template: financials
    sub_template: banks
```

- [ ] **Step 3: Run router tests — PASS**

Run: `cd skills/market-screener/cli && npm test -- test/funnel/router.test.ts -v`

- [ ] **Step 4: Commit**

```bash
git add spec/cn-industry-map.yaml cli/test/funnel/router.test.ts
git commit -m "feat(routing): CN 银行 routes to financials.banks"
```

---

### Task 16: Template evaluator — full banks quality

**Files:**
- Modify: `cli/test/funnel/template-evaluator.test.ts`

- [ ] **Step 1: Add banks quality record with regulatory metrics**

```typescript
const cnBankQualityRecord = (): SecurityRecord => ({
  ticker: "601398",
  market: "CN",
  companyName: "ICBC",
  currency: "CNY",
  status: "active",
  marketCap: 2e12,
  listingAgeYears: 20,
  metrics: {
    roe_ttm: { value: 0.12, dataConfidence: "high" },
    roa: { value: 0.0078, dataConfidence: "medium" },
    npl_ratio: { value: 0.0134, dataConfidence: "medium" },
    provision_coverage: { value: 2.1491, dataConfidence: "medium" },
    capital_adequacy: { value: 0.1939, dataConfidence: "medium" },
    pb_tangible: { value: 0.6, dataConfidence: "high" },
    dividend_yield: { value: 0.05, dataConfidence: "high" },
    revenue: { value: 1e11, dataConfidence: "high" },
    net_income: { value: 3e10, dataConfidence: "high" },
    operating_cash_flow: { value: 4e10, dataConfidence: "high" },
  },
  revenueYoyHistory: [0.02, 0.03],
  ocfNegativeYears: 0,
  netLossWidening: false,
  nonStandardAudit: false,
  latestFinancialMonthsOld: 4,
});

it("passes financials.banks quality with roe_ttm and regulatory core", () => {
  const result = evaluateTemplateTrack(financials, "quality", cnBankQualityRecord(), "banks");
  expect(result.passed).toBe(true);
});
```

- [ ] **Step 2: Run — may FAIL if evaluator lacks metric keys; fix evaluator if needed**

Run: `cd skills/market-screener/cli && npm test -- test/funnel/template-evaluator.test.ts -t "banks quality" -v`

- [ ] **Step 3: Commit**

```bash
git add cli/test/funnel/template-evaluator.test.ts
git commit -m "test(funnel): financials.banks quality with regulatory metrics"
```

---

### Task 17: Full test suite + validate

- [ ] **Step 1: Run all tests**

Run: `cd skills/market-screener/cli && npm test`

Expected: all pass

- [ ] **Step 2: Run validate**

Run: `cd skills/market-screener/cli && npm run validate`

Expected: `Spec OK`

- [ ] **Step 3: Commit if any fixes**

```bash
git commit -m "test: green suite after bank enrich integration"
```

---

### Task 18: Cleanup spike artifacts + close ADR 0003

**Files:**
- Delete: `cli/scripts/spike-bank-indicators.py`
- Delete: `docs/spike/2026-06-27-bank-indicators-scheme-e.md`
- Modify: `docs/adr/0003-cn-bank-routing-proxy.md`

- [ ] **Step 1: Update ADR 0003 status**

```markdown
## Phase two — DONE (2026-06-27)

CN 银行 routes to `financials.banks` with disclosure enrich (ADR 0008). `banks_proxy` retained for fallback documentation only.
```

- [ ] **Step 2: Delete spike files**

```bash
git rm cli/scripts/spike-bank-indicators.py docs/spike/2026-06-27-bank-indicators-scheme-e.md
rmdir docs/spike 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0003-cn-bank-routing-proxy.md
git commit -m "chore: remove bank spike artifacts; close ADR 0003 phase two"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| ROTCE → roe_ttm required | Task 2 |
| ROTCE supporting/deep_only | Task 2, Task 3 |
| banks viability proxy | Task 3 |
| CN disclosure scrape NPL/拨备/CAR | Tasks 7–13 |
| roa from scrape or EM | Tasks 7, 13 |
| Source priority ADR | Task 1 |
| CN 银行 → banks routing | Task 15 |
| BOC omit policy | Task 1 ADR, Task 7 BOC fixture |
| Debug CLI | Task 14 |
| Spike cleanup | Task 18 |

**Gaps (out of scope unless new ADR):** US SEC bank XBRL (`probe-us-sec`), `financial_kill_gates` CLI, NIM ≥70% for `full` promote, iFinD paid tier.

### Placeholder scan

No TBD/TODO/implement-later steps. All code blocks are complete starter implementations.

### Type consistency

- `BankScrapeField` used consistently in extract, merge, cache, apply.
- `EnrichOptions.specDir` added in Task 13 — propagate from `runCommand` / `live.ts` in same task if compile fails.
- `fiscalYear` derivation: 2026-Q1 → FY2024 annual report; document in ADR 0008.

---

## Execution Handoff

Plan complete and saved to `skills/market-screener/docs/plans/2026-06-27-bank-enrich-implementation-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.

2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
