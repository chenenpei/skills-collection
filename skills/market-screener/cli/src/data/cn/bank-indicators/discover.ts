import { withHostLimit } from "../../../lib/host-limit.js";
import { httpFetch } from "../../../lib/http-fetch.js";
import { fetchDisclosurePdfBytes } from "./pdf-bytes.js";
import { decodeSinaBuffer } from "./normalize.js";
import type { BankBulletinEntry } from "./types.js";

const SINA_HOSTS = [
  "http://vip.stock.finance.sina.com.cn",
  "http://money.finance.sina.com.cn",
] as const;

const SINA_HOST = "finance.sina.com.cn";
const SINA_MAX_CONCURRENT = 4;
const CNINFO_QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const BULLETIN_ROW =
  /(\d{4}-\d{2}-\d{2})&nbsp;<a[^>]+href=['"]([^'"]+)['"][^>]*>([^<]+)<\/a>/gi;

const PDF_URL =
  /https?:\/\/(?:file\.finance\.sina\.com\.cn|static\.cninfo\.com\.cn|disc\.static\.szse\.cn)[^"'>\s]+\.PDF/gi;

export type SinaBulletinCandidate = {
  date: string;
  href: string;
  title: string;
  score: number;
};

type CninfoAnnouncement = {
  announcementTitle?: string;
  adjunctUrl?: string;
};

export type CninfoAnnualReportCandidate = {
  name: string;
  pdfUrl: string;
  sourceTier: "cninfo";
};

type ExchangeDisclosureRow = { title?: string; url?: string };

export type ExchangeAnnualReportCandidate = {
  name: string;
  pdfUrl: string;
  sourceTier: "sse" | "szse";
};

export function scoreAnnualReportTitle(title: string, fiscalYear: number): number {
  const yearStr = String(fiscalYear);
  if (!title.includes(yearStr)) return 0;
  if (!/(年度报告|年报)/.test(title)) return 0;
  if (/摘要|半年|一季|三季|英文|更正|补充|取消|提示性|摘要版|H股/.test(title)) return 0;
  if (title.includes("年度报告")) return 2;
  if (title.includes("年报")) return 1;
  return 0;
}

export function parseSinaBulletinList(html: string): SinaBulletinCandidate[] {
  const out: SinaBulletinCandidate[] = [];
  for (const match of html.matchAll(BULLETIN_ROW)) {
    out.push({
      date: match[1]!,
      href: match[2]!,
      title: match[3]!.trim(),
      score: 0,
    });
  }
  return out;
}

export function pickAnnualReportBulletin(
  rows: SinaBulletinCandidate[],
  fiscalYear: number
): SinaBulletinCandidate | undefined {
  const scored = rows
    .map((row) => ({ ...row, score: scoreAnnualReportTitle(row.title, fiscalYear) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return scored[0];
}

export function resolveSinaUrl(host: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `${host}${href}`;
  return `${host}/${href}`;
}

function inferPdfTier(pdfUrl: string): BankBulletinEntry["pdfTier"] {
  if (pdfUrl.includes("static.cninfo.com.cn")) return "cninfo_pdf";
  if (pdfUrl.includes("disc.static.szse.cn")) return "szse_disclosure_pdf";
  return "sse_mirror_pdf";
}

export function extractPdfUrlFromDetailHtml(html: string): string | undefined {
  const matches = html.match(PDF_URL);
  if (!matches?.length) return undefined;
  return matches[0]!;
}

function disclosurePublishYear(fiscalYear: number): number {
  return fiscalYear + 1;
}

export function buildCninfoAnnouncementUrl(ticker: string, fiscalYear: number): string {
  return `${CNINFO_QUERY_URL}?${cninfoAnnouncementParams(ticker, fiscalYear).toString()}`;
}

function cninfoAnnouncementParams(ticker: string, fiscalYear: number): URLSearchParams {
  return new URLSearchParams({
    stock: ticker,
    searchkey: `${fiscalYear} 年度报告`,
    category: "category_ndbg_szsh",
    pageNum: "1",
    pageSize: "30",
    column: "szse",
    tabName: "fulltext",
  });
}

export function parseCninfoAnnouncements(body: {
  announcements?: CninfoAnnouncement[];
}): CninfoAnnualReportCandidate[] {
  return (body.announcements ?? [])
    .filter((row) => row.announcementTitle && row.adjunctUrl)
    .map((row) => ({
      name: String(row.announcementTitle),
      pdfUrl: `http://static.cninfo.com.cn/${String(row.adjunctUrl).replace(/^\/+/, "")}`,
      sourceTier: "cninfo" as const,
    }));
}

export function pickCninfoAnnualReport(
  rows: CninfoAnnualReportCandidate[],
  fiscalYear: number
): CninfoAnnualReportCandidate | undefined {
  return rows.find((row) => scoreAnnualReportTitle(row.name, fiscalYear) > 0);
}

export function inferExchangeSourceTier(ticker: string): "sse" | "szse" {
  return ticker.startsWith("6") ? "sse" : "szse";
}

export function buildSseDisclosureUrl(ticker: string, fiscalYear: number): string {
  const publishYear = disclosurePublishYear(fiscalYear);
  const params = new URLSearchParams({
    isPagination: "true",
    productId: ticker,
    keyWord: "",
    securityType: "0101,120100,020100,020200,120200",
    reportType2: "DQBG",
    reportType: "YEARLY",
    beginDate: `${publishYear}-01-01`,
    endDate: `${publishYear}-12-31`,
    "pageHelp.pageSize": "25",
    "pageHelp.pageNo": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.cacheSize": "1",
    "pageHelp.endPage": "5",
  });
  return `https://query.sse.com.cn/security/stock/queryCompanyBulletin.do?${params.toString()}`;
}

export function buildSzseDisclosureRequest(
  ticker: string,
  fiscalYear: number
): {
  url: string;
  body: {
    seDate: [string, string];
    channelCode: ["fixed_disc"];
    bigCategoryId: ["010301"];
    stock: [string];
    pageSize: 30;
    pageNum: 1;
  };
} {
  const publishYear = disclosurePublishYear(fiscalYear);
  return {
    url: "https://www.szse.cn/api/disc/announcement/annList",
    body: {
      seDate: [`${publishYear}-01-01`, `${publishYear}-12-31`],
      channelCode: ["fixed_disc"],
      bigCategoryId: ["010301"],
      stock: [ticker],
      pageSize: 30,
      pageNum: 1,
    },
  };
}

export function parseExchangeDisclosureRows(
  rows: ExchangeDisclosureRow[],
  ticker: string
): ExchangeAnnualReportCandidate[] {
  const sourceTier = inferExchangeSourceTier(ticker);
  return rows
    .filter((row) => row.title && row.url)
    .map((row) => ({
      name: String(row.title),
      pdfUrl: String(row.url),
      sourceTier,
    }));
}

export function pickExchangeAnnualReport(
  rows: ExchangeAnnualReportCandidate[],
  fiscalYear: number
): ExchangeAnnualReportCandidate | undefined {
  return rows.find((row) => scoreAnnualReportTitle(row.name, fiscalYear) > 0);
}

async function fetchText(url: string): Promise<string> {
  return withHostLimit(SINA_HOST, SINA_MAX_CONCURRENT, async () => {
    const res = await httpFetch(url, { headers: HEADERS });
    const buf = Buffer.from(await res.arrayBuffer());
    return decodeSinaBuffer(buf);
  });
}

async function loadSinaBulletinList(ticker: string): Promise<{
  host: string;
  rows: SinaBulletinCandidate[];
}> {
  let best: { host: string; rows: SinaBulletinCandidate[] } | undefined;

  for (const host of SINA_HOSTS) {
    const listUrl = `${host}/corp/go.php/vCB_Bulletin/stockid/${ticker}/page_type/ndbg.phtml`;
    try {
      const html = await fetchText(listUrl);
      const rows = parseSinaBulletinList(html);
      if (!best || rows.length > best.rows.length) {
        best = { host, rows };
      }
    } catch {
      continue;
    }
  }

  if (!best?.rows.length) {
    throw new Error(`No Sina annual-report bulletin list for ticker ${ticker}`);
  }
  return best;
}

async function discoverCninfoBulletin(
  ticker: string,
  fiscalYear: number
): Promise<BankBulletinEntry | undefined> {
  const res = await httpFetch(CNINFO_QUERY_URL, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "http://www.cninfo.com.cn/",
    },
    body: cninfoAnnouncementParams(ticker, fiscalYear).toString(),
  });
  if (!res.ok) return undefined;
  const candidate = pickCninfoAnnualReport(parseCninfoAnnouncements(await res.json()), fiscalYear);
  if (!candidate) return undefined;
  return {
    ticker,
    fiscalYear,
    name: candidate.name,
    pdfUrl: candidate.pdfUrl,
    pdfTier: "cninfo_pdf",
    sourceTier: "cninfo",
  };
}

async function discoverExchangeBulletin(
  ticker: string,
  fiscalYear: number
): Promise<BankBulletinEntry | undefined> {
  let rows: ExchangeAnnualReportCandidate[];
  if (inferExchangeSourceTier(ticker) === "sse") {
    const res = await httpFetch(buildSseDisclosureUrl(ticker, fiscalYear), {
      headers: {
        ...HEADERS,
        Referer: `https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml?productId=${ticker}`,
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { result?: Array<{ TITLE?: string; URL?: string }> };
    rows = parseExchangeDisclosureRows(
      (body.result ?? []).map((row) => ({
        title: row.TITLE,
        url: row.URL ? `https://static.sse.com.cn${row.URL}` : undefined,
      })),
      ticker
    );
  } else {
    const req = buildSzseDisclosureRequest(ticker, fiscalYear);
    const res = await httpFetch(req.url, {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "application/json",
        Origin: "https://www.szse.cn",
        Referer: "https://www.szse.cn/disclosure/listed/fixed/index.html",
        "X-Request-Type": "ajax",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(req.body),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: Array<{ title?: string; attachPath?: string }> };
    rows = parseExchangeDisclosureRows(
      (body.data ?? []).map((row) => ({
        title: row.title,
        url: row.attachPath ? `https://disc.static.szse.cn${row.attachPath}` : undefined,
      })),
      ticker
    );
  }
  const candidate = pickExchangeAnnualReport(rows, fiscalYear);
  if (!candidate) return undefined;
  return {
    ticker,
    fiscalYear,
    name: candidate.name,
    pdfUrl: candidate.pdfUrl,
    pdfTier: candidate.sourceTier === "szse" ? "szse_disclosure_pdf" : "sse_mirror_pdf",
    sourceTier: candidate.sourceTier,
  };
}

async function discoverSinaBulletin(ticker: string, fiscalYear: number): Promise<BankBulletinEntry> {
  const { host, rows } = await loadSinaBulletinList(ticker);
  const picked = pickAnnualReportBulletin(rows, fiscalYear);
  if (!picked) {
    throw new Error(`No ${fiscalYear} annual report bulletin on Sina for ${ticker}`);
  }

  const sinaUrl = resolveSinaUrl(host, picked.href);
  const detailHtml = await fetchText(sinaUrl);
  const pdfUrl = extractPdfUrlFromDetailHtml(detailHtml);
  if (!pdfUrl) {
    throw new Error(`No PDF link on Sina bulletin detail for ${ticker} FY${fiscalYear}`);
  }

  return {
    ticker,
    fiscalYear,
    name: picked.title,
    sinaUrl,
    pdfUrl,
    pdfTier: inferPdfTier(pdfUrl),
    sourceTier: "sina_ndbg",
  };
}

/** Resolve FY annual-report disclosure URLs: cninfo → exchange → Sina fallback. */
export async function discoverBankBulletin(
  ticker: string,
  fiscalYear: number
): Promise<BankBulletinEntry> {
  const attempts: Array<() => Promise<BankBulletinEntry | undefined>> = [
    () => discoverCninfoBulletin(ticker, fiscalYear),
    () => discoverExchangeBulletin(ticker, fiscalYear),
    async () => discoverSinaBulletin(ticker, fiscalYear),
  ];

  let lastError: Error | undefined;
  for (const attempt of attempts) {
    let entry: BankBulletinEntry | undefined;
    try {
      entry = await attempt();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    if (!entry) continue;
    if (await fetchDisclosurePdfBytes(entry.pdfUrl)) return entry;
  }

  throw (
    lastError ??
    new Error(`No readable disclosure PDF for ${ticker} FY${fiscalYear}`)
  );
}
