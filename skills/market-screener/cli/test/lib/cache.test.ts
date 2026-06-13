import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCache, writeCache } from "../../src/lib/cache.js";

describe("cache", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "screener-cache-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads JSON by quarter/market/ticker", async () => {
    const payload = { revenue: 100, roe: 0.15 };
    await writeCache(dir, "2026-Q1", "CN", "600519", payload);
    const got = await readCache<typeof payload>(dir, "2026-Q1", "CN", "600519");
    expect(got).toEqual(payload);
  });

  it("returns null on cache miss", async () => {
    const got = await readCache(dir, "2026-Q1", "CN", "NOPE");
    expect(got).toBeNull();
  });
});
