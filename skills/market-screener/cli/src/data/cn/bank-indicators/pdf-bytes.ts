import { httpFetch } from "../../../lib/http-fetch.js";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

/** True when the buffer starts with a PDF magic header. */
export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-";
}

/** Download a disclosure URL and return bytes only when the payload is a real PDF. */
export async function fetchDisclosurePdfBytes(url: string): Promise<Buffer | undefined> {
  try {
    const res = await httpFetch(url, { headers: HEADERS });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return isPdfBuffer(buf) ? buf : undefined;
  } catch {
    return undefined;
  }
}
