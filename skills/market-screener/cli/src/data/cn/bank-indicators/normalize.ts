export function decodeResponseBuffer(buf: Buffer): string {
  for (const enc of ["utf-8", "gbk", "gb2312"] as const) {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      continue;
    }
  }
  return buf.toString("utf8");
}

/** Sina Finance bulletin pages are GBK; UTF-8-first decoding mojibakes titles. */
export function decodeSinaBuffer(buf: Buffer): string {
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return decodeResponseBuffer(buf);
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
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
