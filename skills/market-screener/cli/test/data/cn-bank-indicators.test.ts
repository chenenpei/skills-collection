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
import { fetchDisclosureTexts, mergeBankScrapeSources } from "../../src/data/cn/bank-indicators/fetch.js";
import {
  extractPdfUrlFromDetailHtml,
  parseSinaBulletinList,
  pickAnnualReportBulletin,
  resolveSinaUrl,
  scoreAnnualReportTitle,
} from "../../src/data/cn/bank-indicators/discover.js";
import {
  deriveBankDisclosureFiscalYear,
  parseFunnelQuarter,
} from "../../src/data/cn/bank-indicators/fiscal-year.js";
import type { BankBulletinEntry } from "../../src/data/cn/bank-indicators/types.js";

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

const SINA_HOST = "http://vip.stock.finance.sina.com.cn";

const sampleEntry: BankBulletinEntry = {
  ticker: "600036",
  fiscalYear: 2024,
  name: "招商银行2024年度报告",
  sinaUrl:
    "http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?stockid=600036&id=10806393",
  pdfUrl:
    "http://file.finance.sina.com.cn/211.154.219.97:9494/MRGG/CNSESH_STOCK/2025/2025-3/2025-03-26/10806393.PDF",
  pdfTier: "sse_mirror_pdf",
};

const LIST_HTML = `
2025-03-29&nbsp;<a target='_blank' href='/corp/view/vCB_AllBulletinDetail.php?stockid=601398&id=10826973'>工商银行2024年度报告</a><br>
2025-03-28&nbsp;<a target='_blank' href='/corp/view/vCB_AllBulletinDetail.php?stockid=601398&id=10826900'>工商银行2024年度报告摘要</a><br>
2024-03-28&nbsp;<a target='_blank' href='/corp/view/vCB_AllBulletinDetail.php?stockid=601398&id=9000001'>工商银行2023年度报告</a><br>
`;

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

describe("fetchDisclosureTexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sina html text and pdf text", async () => {
    const entry = {
      ...sampleEntry,
      sinaUrl: "http://example.com/corp/view/vCB_AllBulletinDetail.php?stockid=600036&id=1",
    };
    const { sinaText, pdfText } = await fetchDisclosureTexts(entry);
    expect(sinaText).toContain("不良贷款率0.95%");
    expect(pdfText).toContain("资本充足率");
  });
});

describe("discoverBankBulletin helpers", () => {
  it("scores and picks FY annual report from Sina list HTML", () => {
    expect(scoreAnnualReportTitle("工商银行2024年度报告", 2024)).toBe(2);
    expect(scoreAnnualReportTitle("工商银行2024年度报告摘要", 2024)).toBe(0);

    const rows = parseSinaBulletinList(LIST_HTML);
    const picked = pickAnnualReportBulletin(rows, 2024);
    expect(picked?.href).toContain("id=10826973");
  });

  it("resolves relative Sina URLs and extracts PDF links", () => {
    expect(
      resolveSinaUrl(SINA_HOST, "/corp/view/vCB_AllBulletinDetail.php?stockid=601398&id=1")
    ).toContain("601398");
    expect(
      extractPdfUrlFromDetailHtml(
        '<a href="http://static.cninfo.com.cn/finalpage/2025-03-29/1222948910.PDF">pdf</a>'
      )
    ).toContain("1222948910.PDF");
  });
});

describe("deriveBankDisclosureFiscalYear", () => {
  it("parses funnel quarter", () => {
    expect(parseFunnelQuarter("2026-Q1")).toEqual({ year: 2026, q: 1 });
    expect(() => parseFunnelQuarter("2026Q1")).toThrow(/Invalid funnel quarter/);
  });

  it("derives FY from quarter and wall-clock now", () => {
    expect(
      deriveBankDisclosureFiscalYear("2026-Q1", new Date("2026-06-27T12:00:00Z"))
    ).toBe(2025);
    expect(
      deriveBankDisclosureFiscalYear("2026-Q1", new Date("2026-02-15T12:00:00Z"))
    ).toBe(2024);
    expect(
      deriveBankDisclosureFiscalYear("2024-Q2", new Date("2026-06-27T12:00:00Z"))
    ).toBe(2023);
  });
});
