import { PDFParse } from "pdf-parse";
import { httpFetch } from "../../../lib/http-fetch.js";
import { normalizeCjkText, stripHtml } from "./normalize.js";
import type { BankBulletinEntry } from "./types.js";

export const PDF_MAX_PAGES = 20;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

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
  const html = normalizeCjkText(stripHtml(decodeBuffer(htmlRaw)));
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  const pdfText = normalizeCjkText(await pdfToText(pdfBuf));
  return { sinaText: html, pdfText };
}
