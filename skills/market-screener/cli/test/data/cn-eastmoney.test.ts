import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCnEastMoneyAdapter } from "../../src/data/cn/quotes.js";

describe("createCnEastMoneyAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps quote response to SecurityRecord shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            diff: [
              {
                f12: "600519",
                f14: "贵州茅台",
                f20: 2000000000000,
                f116: 7300,
                f127: "active",
              },
            ],
          },
        }),
      })
    );

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["CN"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.ticker).toBe("600519");
    expect(records[0]?.market).toBe("CN");
    expect(records[0]?.companyName).toBe("贵州茅台");
    expect(records[0]?.marketCap).toBe(2000000000000);
    expect(records[0]?.currency).toBe("CNY");
    expect(records[0]?.status).toBe("active");
    expect(records[0]?.listingAgeYears).toBeCloseTo(7300 / 365, 5);
  });

  it("parses ST status from f127", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            diff: [
              {
                f12: "000001",
                f14: "*ST 示例",
                f20: 500000000,
                f127: "ST",
              },
            ],
          },
        }),
      })
    );

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["CN"]);

    expect(records[0]?.status).toBe("ST");
  });

  it("paginates until all rows are loaded", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      f12: String(600000 + i),
      f14: `Stock ${i}`,
      f20: 5_000_000_000,
      f116: 2000,
      f127: "active",
    }));
    const page2 = [
      { f12: "600519", f14: "贵州茅台", f20: 2_000_000_000_000, f116: 7300, f127: "active" },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        const pn = new URL(url).searchParams.get("pn");
        if (pn === "1") {
          return {
            ok: true,
            json: async () => ({ data: { total: 101, diff: page1 } }),
          };
        }
        if (pn === "2") {
          return {
            ok: true,
            json: async () => ({ data: { total: 101, diff: page2 } }),
          };
        }
        return { ok: true, json: async () => ({ data: { total: 101, diff: [] } }) };
      })
    );

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["CN"]);

    expect(records).toHaveLength(101);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(records.at(-1)?.ticker).toBe("600519");
  });
});
