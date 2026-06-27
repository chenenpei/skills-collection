import { PDFParse } from "pdf-parse";
import { httpFetch } from "../../../lib/http-fetch.js";
import {
  decodeResponseBuffer,
  decodeSinaBuffer,
  normalizeCjkText,
  stripHtml,
} from "./normalize.js";
import type { BankBulletinEntry, BankScrapeField, BankScrapeMetrics } from "./types.js";

export const PDF_MAX_PAGES = 20;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

const SCRAPE_FIELDS: BankScrapeField[] = [
  "npl_ratio",
  "provision_coverage",
  "capital_adequacy",
  "nim",
  "roa",
];

export function mergeBankScrapeSources(
  sina: BankScrapeMetrics,
  pdf: BankScrapeMetrics
): BankScrapeMetrics {
  const out: BankScrapeMetrics = {};
  for (const key of SCRAPE_FIELDS) {
    const s = sina[key];
    const p = pdf[key];
    if (key === "capital_adequacy") {
      const vals = [s, p].filter((v): v is number => v !== undefined);
      if (vals.length) out[key] = Math.max(...vals);
    } else {
      const val = p ?? s;
      if (val !== undefined) out[key] = val;
    }
  }
  return out;
}

async function pdfToText(pdfBytes: Buffer, maxPages: number = PDF_MAX_PAGES): Promise<string> {
  const parser = new PDFParse({ data: pdfBytes });
  try {
    const parsed = await parser.getText({ first: maxPages });
    return parsed.text ?? "";
  } finally {
    await parser.destroy();
  }
}

export async function fetchDisclosureTexts(entry: BankBulletinEntry): Promise<{
  sinaText: string;
  pdfText: string;
}> {
  const [htmlRes, pdfRes] = await Promise.all([
    httpFetch(entry.sinaUrl, { headers: HEADERS }),
    httpFetch(entry.pdfUrl, { headers: HEADERS }),
  ]);
  const htmlRaw = Buffer.from(await htmlRes.arrayBuffer());
  const html = normalizeCjkText(
    stripHtml(
      entry.sinaUrl.includes("sina.com.cn")
        ? decodeSinaBuffer(htmlRaw)
        : decodeResponseBuffer(htmlRaw)
    )
  );
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  const pdfText = normalizeCjkText(await pdfToText(pdfBuf));
  return { sinaText: html, pdfText };
}
