import { withHostLimit } from "../../../lib/host-limit.js";
import { httpFetch } from "../../../lib/http-fetch.js";
import { decodeSinaBuffer } from "./normalize.js";
import type { BankBulletinEntry } from "./types.js";

const SINA_HOSTS = [
  "http://vip.stock.finance.sina.com.cn",
  "http://money.finance.sina.com.cn",
] as const;

const SINA_HOST = "finance.sina.com.cn";
const SINA_MAX_CONCURRENT = 4;

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

/** Resolve FY annual-report disclosure URLs via Sina ndbg list + detail page. */
export async function discoverBankBulletin(
  ticker: string,
  fiscalYear: number
): Promise<BankBulletinEntry> {
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
  };
}
