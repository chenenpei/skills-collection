import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import {
  findEnrichCacheGapTickers,
  isEnrichCacheGap,
  listEnrichCacheGaps,
  readCache,
  writeCache,
} from "../../src/lib/cache.js";

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

  describe("enrich cache gap", () => {
    it("treats missing file as gap", async () => {
      expect(await isEnrichCacheGap(dir, "2026-Q1", "CN", "MISSING")).toBe(true);
    });

    it("treats empty annualRows as gap", async () => {
      await writeCache(dir, "2026-Q1", "CN", "EMPTY", { annualRows: [] });
      expect(await isEnrichCacheGap(dir, "2026-Q1", "CN", "EMPTY")).toBe(true);
    });

    it("treats valid annualRows as not a gap", async () => {
      await writeCache(dir, "2026-Q1", "CN", "OK", {
        annualRows: [{ year: 2024, revenue: 100 }],
      });
      expect(await isEnrichCacheGap(dir, "2026-Q1", "CN", "OK")).toBe(false);
    });

    it("treats corrupt JSON as gap", async () => {
      const file = path.join(dir, "2026-Q1", "CN", "BAD.json");
      await fsPromises.mkdir(path.dirname(file), { recursive: true });
      await fsPromises.writeFile(file, "{not-json", "utf8");
      expect(await isEnrichCacheGap(dir, "2026-Q1", "CN", "BAD")).toBe(true);
    });

    it("findEnrichCacheGapTickers merges missing files and empty annualRows", async () => {
      await writeCache(dir, "2026-Q1", "CN", "EMPTY", { annualRows: [] });
      await writeCache(dir, "2026-Q1", "CN", "OK", {
        annualRows: [{ year: 2024, revenue: 1 }],
      });

      const gaps = await findEnrichCacheGapTickers(
        ["MISSING", "EMPTY", "OK"],
        dir,
        "2026-Q1",
        "CN"
      );
      expect(gaps.sort()).toEqual(["EMPTY", "MISSING"]);
    });

    it("listEnrichCacheGaps returns count and capped samples", async () => {
      await writeCache(dir, "2026-Q1", "CN", "A", { annualRows: [] });
      await writeCache(dir, "2026-Q1", "CN", "B", { annualRows: [] });

      const result = await listEnrichCacheGaps(["A", "B", "C"], dir, "2026-Q1", "CN", 1);
      expect(result.count).toBe(3);
      expect(result.samples).toHaveLength(1);
    });
  });
});
