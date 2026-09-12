import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashFile, readJsonLines, writeJsonLines, createProgressLogger, mapPool, withHostLimit } from "../src/shared/runtime.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

describe("JSON Lines archive IO", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-jsonl-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes sequential records, returns their byte hash, and reads multibyte records", async () => {
    const file = path.join(dir, "records.jsonl");
    const records = [{ ticker: "600519", name: "贵州茅台" }, { ticker: "AAPL", note: "🍎" }];
    const expectedBytes = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");

    await expect(writeJsonLines(file, records)).resolves.toBe(expectedHash);
    await expect(hashFile(file)).resolves.toBe(expectedHash);

    const read: unknown[] = [];
    for await (const record of readJsonLines(file, expectedHash)) read.push(record);
    expect(read).toEqual(records);
  });

  it("writes an empty archive as an empty file", async () => {
    const file = path.join(dir, "empty.jsonl");
    const expectedHash = createHash("sha256").digest("hex");
    await expect(writeJsonLines(file, [])).resolves.toBe(expectedHash);
    await expect(fs.readFile(file)).resolves.toEqual(Buffer.alloc(0));
    await expect(hashFile(file)).resolves.toBe(expectedHash);
    const records: unknown[] = [];
    for await (const record of readJsonLines(file, expectedHash)) records.push(record);
    expect(records).toEqual([]);
  });

  it("does not overwrite an existing archive", async () => {
    const file = path.join(dir, "existing.jsonl");
    await fs.writeFile(file, '{"existing":true}\n');
    await expect(writeJsonLines(file, [{ replacement: true }])).rejects.toMatchObject({ code: "EEXIST" });
    await expect(fs.readFile(file, "utf8")).resolves.toBe('{"existing":true}\n');
  });

  it("rejects a hash that does not match the consumed archive bytes", async () => {
    const file = path.join(dir, "tampered.jsonl");
    const expectedHash = await writeJsonLines(file, [{ ticker: "AAPL" }]);
    await fs.appendFile(file, '{"ticker":"MSFT"}\n');

    const consume = async () => {
      for await (const _record of readJsonLines(file, expectedHash)) {
        // fully consume so integrity verification runs
      }
    };
    await expect(consume()).rejects.toThrow(/hash/i);
  });

  it.each([
    ["blank line", '{"ok":true}\n\n'],
    ["invalid JSON", '{not-json}\n'],
    ["missing final newline", '{"ok":true}'],
  ])("rejects %s", async (_label, contents) => {
    const file = path.join(dir, "invalid.jsonl");
    await fs.writeFile(file, contents);
    const consume = async () => {
      for await (const _record of readJsonLines(file)) {
        // consume
      }
    };
    await expect(consume()).rejects.toBeInstanceOf(Error);
  });

  it("handles one record larger than a stream chunk", async () => {
    const file = path.join(dir, "large.jsonl");
    const record = { payload: "中".repeat(100_000) };
    await writeJsonLines(file, [record]);
    const received: unknown[] = [];
    for await (const value of readJsonLines(file)) received.push(value);
    expect(received).toEqual([record]);
  });

  it("closes the reader when a consumer stops early", async () => {
    const file = path.join(dir, "early-return.jsonl");
    // Leave more than a stream chunk unread, so EOF cannot close it for us.
    await writeJsonLines(file, [{ record: 1 }, { payload: "x".repeat(200_000) }]);
    for await (const _record of readJsonLines(file)) break;

    const stream = vi.mocked(createReadStream).mock.results[0].value;
    expect(stream.readableEnded).toBe(false);
    expect(stream.closed).toBe(true);
  });

  it("keeps already written records when serialization fails", async () => {
    const file = path.join(dir, "partial.jsonl");
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(writeJsonLines(file, [{ record: 1 }, circular])).rejects.toThrow();
    await expect(fs.readFile(file, "utf8")).resolves.toBe('{"record":1}\n');
  });
});

describe("createProgressLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes phase and warn lines to stderr", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const progress = createProgressLogger({ prefix: "test" });
    progress.phase("loading");
    progress.warn("something odd");

    expect(stderr).toHaveBeenCalledWith("[test] loading");
    expect(stderr).toHaveBeenCalledWith("[test] warn: something odd");
  });

  it("throttles intermediate ticks but always prints the final tick", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const progress = createProgressLogger({ prefix: "test", throttleMs: 5000 });
    progress.tick(100, 1000, "enrichment");
    progress.tick(150, 1000, "enrichment");
    progress.tick(1000, 1000, "enrichment");

    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenNthCalledWith(1, "[test] enrichment: 100/1000 (10.0%)");
    expect(stderr).toHaveBeenNthCalledWith(2, "[test] enrichment: 1000/1000 (100.0%)");
  });
});

describe("mapPool", () => {
  it("stops starting requests after a fatal error and drains those already running", async () => {
    const gate = Promise.withResolvers<void>();
    const starts: number[] = [];
    let settled = false;
    const failure = new Error("fatal storage failure");
    const pending = mapPool([1, 2, 3, 4], 2, async (id) => {
      starts.push(id);
      if (id === 1) throw failure;
      await gate.promise;
    }).then(() => undefined, error => { settled = true; return error; });
    await new Promise<void>(resolve => setImmediate(resolve));
    const settledBeforeDrain = settled;
    gate.resolve();
    expect(await pending).toBe(failure);
    expect(settledBeforeDrain).toBe(false);
    expect(starts).toEqual([1, 2]);
  });

  it("limits concurrent executions", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return n * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("reports progress after each completed item", async () => {
    const seen: Array<[number, number]> = [];

    const results = await mapPool([1, 2, 3], 2, async (n) => n * 2, (done, total) => {
      seen.push([done, total]);
    });

    expect(results).toEqual([2, 4, 6]);
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("withHostLimit", () => {
  it("reserves a released slot for an already queued request", async () => {
    const firstGate = Promise.withResolvers<void>();
    const laterGate = Promise.withResolvers<void>();
    const requests: Promise<void>[] = [];
    const starts: number[] = [];
    let active = 0, peak = 0;
    const run = async (id: number, gate: Promise<void>) => {
      starts.push(id);
      peak = Math.max(peak, ++active);
      await gate;
      active--;
    };
    requests.push(withHostLimit("handoff.test", 1, async () => {
      await run(1, firstGate.promise);
      // A new caller arrives after release but before the queued waiter resumes.
      queueMicrotask(() => queueMicrotask(() => {
        requests.push(withHostLimit("handoff.test", 1, () => run(3, laterGate.promise)));
      }));
    }));
    requests.push(withHostLimit("handoff.test", 1, () => run(2, laterGate.promise)));
    firstGate.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    laterGate.resolve();
    await Promise.all(requests);
    expect(peak).toBe(1);
    expect(starts).toEqual([1, 2, 3]);
  });

  it("caps concurrent executions per host", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        withHostLimit("example.com", 2, async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
        })
      )
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
