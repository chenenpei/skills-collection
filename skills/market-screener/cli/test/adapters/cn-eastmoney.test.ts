import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCnEastMoneyAdapter } from "../../src/adapters/cn-eastmoney.js";

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

  it("returns empty array when CN is not requested", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createCnEastMoneyAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["US"]);

    expect(records).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
