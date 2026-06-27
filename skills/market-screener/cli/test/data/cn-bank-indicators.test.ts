import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../src/lib/http-fetch.js", () => ({
  httpFetch: vi.fn(async (url: string) => {
    if (url.endsWith(".PDF") || url.includes(".PDF")) {
      return new Response(Buffer.from("%PDF mock"), { status: 200 });
    }
    return new Response("<html>不良贷款率0.95%</html>", { status: 200 });
  }),
}));

vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: vi.fn(async () => ({ text: "资本充足率19.05% 拨备覆盖率411.98%" })),
    destroy: vi.fn(async () => {}),
  })),
}));

import { extractBankMetricsFromText } from "../../src/data/cn/bank-indicators/extract.js";
import { mergeBankScrapeSources } from "../../src/data/cn/bank-indicators/merge.js";
import { loadBankBulletin } from "../../src/data/cn/bank-indicators/bulletin-map.js";
import { fetchDisclosureTexts } from "../../src/data/cn/bank-indicators/fetch.js";

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

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

  it("extracts ICBC FY2024 regulatory core from fixture text", () => {
    const { metrics, missing } = extractBankMetricsFromText(fixture("bank-text-icbc-2024.txt"));
    expect(metrics.npl_ratio).toBeCloseTo(0.0134, 4);
    expect(metrics.provision_coverage).toBeCloseTo(2.1491, 3);
    expect(metrics.capital_adequacy).toBeCloseTo(0.1939, 4);
    expect(metrics.nim).toBeCloseTo(0.0123, 4);
    expect(metrics.roa).toBeCloseTo(0.0078, 4);
    expect(missing).not.toContain("npl_ratio");
  });

  it("flags missing npl_ratio for BOC gap fixture", () => {
    const { metrics, missing } = extractBankMetricsFromText(fixture("bank-text-boc-2024.txt"));
    expect(metrics.npl_ratio).toBeUndefined();
    expect(missing).toContain("npl_ratio");
    expect(metrics.provision_coverage).toBeCloseTo(2.094, 3);
    expect(metrics.capital_adequacy).toBeCloseTo(0.1876, 4);
    expect(metrics.nim).toBeCloseTo(0.014, 4);
    expect(metrics.roa).toBeCloseTo(0.0075, 4);
  });
});

describe("mergeBankScrapeSources", () => {
  it("merge prefers PDF per field; CAR takes max across sources", () => {
    const merged = mergeBankScrapeSources(
      { npl_ratio: 0.013, capital_adequacy: 0.15 },
      { npl_ratio: 0.0134, capital_adequacy: 0.1969, provision_coverage: 2.336 }
    );
    expect(merged.npl_ratio).toBe(0.0134);
    expect(merged.capital_adequacy).toBe(0.1969);
    expect(merged.provision_coverage).toBe(2.336);
  });
});

describe("loadBankBulletin", () => {
  it("loads CMB FY2024 bulletin entry", () => {
    const entry = loadBankBulletin("600036", 2024, SPEC_DIR);
    expect(entry?.pdfTier).toBe("sse_mirror_pdf");
    expect(entry?.pdfUrl).toContain("10806393");
    expect(entry?.sinaUrl).toContain("600036");
  });
});

describe("fetchDisclosureTexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sina html text and pdf text", async () => {
    const entry = loadBankBulletin("600036", 2024, SPEC_DIR)!;
    const { sinaText, pdfText } = await fetchDisclosureTexts(entry);
    expect(sinaText).toContain("不良贷款率0.95%");
    expect(pdfText).toContain("资本充足率");
  });
});
