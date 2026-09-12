/**
 * CLI 运行支持：统一数据目录、代理请求、并发限制、流式文件读写与进度输出。
 * 此处处理运行机制；财务口径、来源解析和筛选参数分别由业务模块负责。
 */
import path from "node:path";
import PQueue from "p-queue";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { type Market } from "./financial-model.js";

// src/shared/runtime.ts 与 dist/shared/runtime.js 距 CLI 包根目录都是两层。
export const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_POLICY_DIR = path.join(CLI_ROOT, "src", "policy");
export const DEFAULT_FIXTURES_DIR = path.join(CLI_ROOT, "test", "fixtures");
// Keep reusable data outside the skill. A standalone installation can override this root.
export const DEFAULT_DATA_DIR = path.resolve(
  process.env.SCREENER_DATA_DIR ??
    path.join(CLI_ROOT, "..", "..", "..", ".scratch", "market-screener"),
);
export const DEFAULT_CACHE_DIR = path.join(DEFAULT_DATA_DIR, "cache");
export const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_DATA_DIR, "runs");

let cachedProxy: ProxyAgent | undefined;
let cachedProxyUrl: string | undefined;

/** Read HTTPS/HTTP proxy from env (Node fetch ignores these by default). */
export function resolveProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  );
}

function proxyAgent(url: string): ProxyAgent {
  if (cachedProxy && cachedProxyUrl === url) return cachedProxy;
  cachedProxyUrl = url;
  cachedProxy = new ProxyAgent(url);
  return cachedProxy;
}

/** Network fetch that honors HTTPS_PROXY / HTTP_PROXY via undici. */
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) {
    return fetch(input, init);
  }

  const res = await undiciFetch(input, {
    ...init,
    dispatcher: proxyAgent(proxyUrl),
  } as Parameters<typeof undiciFetch>[1]);

  return res as unknown as Response;
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  const total = items.length;
  let failure: { error: unknown } | undefined;

  async function worker(): Promise<void> {
    while (!failure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
        completed += 1;
        onProgress?.(completed, total);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  // On a fatal error, stop new work and drain active requests/writes before
  // returning control to callers that may close or remove the run directory.
  await Promise.all(workers);
  if (failure) throw failure.error;
  return results;
}

const queues = new Map<string, PQueue>();

/** One FIFO queue per host; callers use the same limit for a given host. */
export async function withHostLimit<T>(
  host: string,
  maxConcurrent: number,
  fn: () => Promise<T>,
): Promise<T> {
  let queue = queues.get(host);
  if (!queue) {
    queue = new PQueue({ concurrency: maxConcurrent });
    queues.set(host, queue);
  }
  return queue.add(fn);
}

type JsonLineItems = AsyncIterable<unknown> | Iterable<unknown>;

async function closeReadStream(stream: ReturnType<typeof createReadStream>): Promise<void> {
  if (stream.closed) return;
  stream.destroy();
  if (!stream.closed) {
    await new Promise<void>((resolve) => stream.once("close", resolve));
  }
}

async function writeAll(
  file: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, null);
    if (bytesWritten === 0) throw new Error("Could not write JSON Lines record");
    hash.update(bytes.subarray(offset, offset + bytesWritten));
    offset += bytesWritten;
  }
}

/** Returns the SHA-256 of the raw bytes in a file without loading it into memory. */
export async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  try {
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await closeReadStream(stream);
  }
}

/**
 * Parses a newline-terminated JSON Lines archive sequentially.
 * Its optional hash is checked only after the caller has consumed the entire archive.
 */
export async function* readJsonLines(file: string, expectedHash?: string): AsyncGenerator<unknown> {
  const stream = createReadStream(file);
  const decoder = new StringDecoder("utf8");
  const hash = createHash("sha256");
  let pending = "";
  let endedWithNewline = false;
  let sawBytes = false;

  try {
    for await (const chunk of stream) {
      sawBytes = true;
      hash.update(chunk);
      pending += decoder.write(chunk);
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        endedWithNewline = true;
        if (line.length === 0) throw new Error("JSON Lines archive contains an empty line");
        yield JSON.parse(line) as unknown;
      }
      if (pending.length > 0) endedWithNewline = false;
    }

    pending += decoder.end();
    if (pending.length !== 0 || (sawBytes && !endedWithNewline)) {
      throw new Error("JSON Lines archive must end with a newline");
    }
    const actualHash = hash.digest("hex");
    if (expectedHash !== undefined && actualHash !== expectedHash) {
      throw new Error("JSON Lines archive hash does not match expected hash");
    }
  } finally {
    await closeReadStream(stream);
  }
}

/** Writes a new JSON Lines archive and returns the SHA-256 of its raw bytes. */
export async function writeJsonLines(file: string, items: JsonLineItems): Promise<string> {
  const handle = await open(file, "wx");
  const hash = createHash("sha256");
  try {
    for await (const item of items) {
      const bytes = Buffer.from(`${JSON.stringify(item)}\n`, "utf8");
      await writeAll(handle, bytes, hash);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export function parseMarkets(raw: string): { marketScope: Market | "CN,US"; markets: Market[] } {
  const normalized = raw.replace(/\s+/g, "").toUpperCase();
  if (normalized === "CN") return { marketScope: "CN", markets: ["CN"] };
  if (normalized === "US") return { marketScope: "US", markets: ["US"] };
  if (normalized === "CN,US" || normalized === "US,CN") {
    return { marketScope: "CN,US", markets: ["CN", "US"] };
  }
  throw new Error(`Invalid --markets value: ${raw}. Expected CN, US, or CN,US.`);
}

export function parseMarket(raw: string): Market {
  const market = raw.toUpperCase();
  if (market === "CN" || market === "US") return market;
  throw new Error(`Invalid --market value: ${raw}. Expected CN or US.`);
}

/** Progress and warnings go to stderr so stdout stays clean for piping. */
export interface ProgressLogger {
  phase(message: string): void;
  warn(message: string): void;
  tick(done: number, total: number, label?: string): void;
}

export interface ProgressLoggerOptions {
  prefix?: string;
  /** Minimum ms between non-final tick lines (final tick always prints). */
  throttleMs?: number;
}

export function createProgressLogger(opts: ProgressLoggerOptions = {}): ProgressLogger {
  const prefix = opts.prefix ?? "screener";
  const throttleMs = opts.throttleMs ?? 5000;
  let lastTickAt = Number.NEGATIVE_INFINITY;

  return {
    phase(message: string): void {
      console.error(`[${prefix}] ${message}`);
    },
    warn(message: string): void {
      console.error(`[${prefix}] warn: ${message}`);
    },
    tick(done: number, total: number, label = "progress"): void {
      const now = Date.now();
      const isDone = done >= total;
      if (!isDone && now - lastTickAt < throttleMs && done % 100 !== 0) return;
      lastTickAt = now;
      const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
      console.error(`[${prefix}] ${label}: ${done}/${total} (${pct}%)`);
    },
  };
}

export function pct(count: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

export function sortedEntries(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
