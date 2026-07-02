import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveProxyUrl } from "../../lib/http-fetch.js";

const execFileAsync = promisify(execFile);

const YAHOO_UA = "Mozilla/5.0";
const FC_YAHOO_URL = "https://fc.yahoo.com";
const CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const SESSION_TTL_MS = 30 * 60 * 1000;
const CRUMB_RETRY_ATTEMPTS = 4;
const CRUMB_RETRY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type YahooSession = {
  jarPath: string;
  crumb: string;
  fetchedAt: number;
};

let cachedSession: YahooSession | undefined;

function curlResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
  } as Response;
}

const WRITE_OUT_MARKER = "\n__CURL_HTTP_CODE__:";

async function curlRequest(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    cookieJar?: string;
    discardBody?: boolean;
  }
): Promise<{ status: number; body: string }> {
  const args = ["-sS"];
  const env = { ...process.env };
  const proxy = resolveProxyUrl();
  if (proxy) {
    env.HTTPS_PROXY = proxy;
    env.HTTP_PROXY = proxy;
    env.https_proxy = proxy;
    env.http_proxy = proxy;
  }
  if (opts.cookieJar) {
    args.push("-b", opts.cookieJar, "-c", opts.cookieJar);
  }
  if (opts.discardBody) {
    args.push("-o", "/dev/null", "-w", "%{http_code}");
  } else {
    args.push("-w", `${WRITE_OUT_MARKER}%{http_code}`);
  }
  args.push("-X", opts.method ?? "GET");
  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    args.push("-H", `${key}: ${value}`);
  }
  if (opts.body !== undefined) {
    args.push("-d", opts.body);
  }
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 64 * 1024 * 1024,
    env,
  });

  if (opts.discardBody) {
    const status = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(status)) {
      throw new Error(`curl returned invalid status for ${url}`);
    }
    return { status, body: "" };
  }

  const markerAt = stdout.lastIndexOf(WRITE_OUT_MARKER);
  if (markerAt < 0) {
    throw new Error(`curl returned unexpected output for ${url}`);
  }
  const body = stdout.slice(0, markerAt);
  const status = Number.parseInt(stdout.slice(markerAt + WRITE_OUT_MARKER.length), 10);
  if (!Number.isFinite(status)) {
    throw new Error(`curl returned invalid status for ${url}`);
  }
  return { status, body };
}

async function fetchCrumbWithRetry(
  jarPath: string
): Promise<{ status: number; body: string }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < CRUMB_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(CRUMB_RETRY_MS * attempt);
    const res = await curlRequest(CRUMB_URL, {
      cookieJar: jarPath,
      headers: { "User-Agent": YAHOO_UA },
    });
    if (res.status >= 200 && res.status < 300 && res.body.trim()) {
      return res;
    }
    lastStatus = res.status;
    if (res.status !== 429) break;
  }
  throw new Error(`Yahoo crumb failed: ${lastStatus}`);
}

async function refreshYahooSession(): Promise<YahooSession> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yahoo-session-"));
  const jarPath = path.join(dir, "cookies.jar");

  const fc = await curlRequest(FC_YAHOO_URL, {
    cookieJar: jarPath,
    headers: { "User-Agent": YAHOO_UA },
    discardBody: true,
  });
  if (fc.status !== 404 && fc.status !== 200) {
    throw new Error(`Yahoo session bootstrap failed: ${fc.status}`);
  }

  const crumbRes = await fetchCrumbWithRetry(jarPath);
  const crumb = crumbRes.body.trim();
  if (!crumb) {
    throw new Error("Yahoo crumb empty");
  }

  cachedSession = { jarPath, crumb, fetchedAt: Date.now() };
  return cachedSession;
}

async function getYahooSession(): Promise<YahooSession> {
  if (cachedSession && Date.now() - cachedSession.fetchedAt < SESSION_TTL_MS) {
    return cachedSession;
  }
  return refreshYahooSession();
}

/**
 * Yahoo Finance rejects Node fetch fingerprints (HTTP 429 on crumb).
 * Use curl so live US universe loading works behind macOS system proxies.
 */
export async function yahooFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const { jarPath, crumb } = await getYahooSession();
  const url = new URL(input);
  url.searchParams.set("crumb", crumb);

  const headers: Record<string, string> = { "User-Agent": YAHOO_UA };
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((value, key) => {
      headers[key] = value;
    });
  }

  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body
        ? String(init.body)
        : undefined;

  const res = await curlRequest(url.toString(), {
    method: init?.method ?? "GET",
    headers,
    body,
    cookieJar: jarPath,
  });
  return curlResponse(res.status, res.body);
}

/** Test helper — reset in-memory session between cases. */
export function resetYahooSessionForTests(): void {
  cachedSession = undefined;
}
