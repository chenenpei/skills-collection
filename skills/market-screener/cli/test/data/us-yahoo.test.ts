import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUsYahooAdapter } from "../../src/data/us/quotes.js";
import { yahooFetch } from "../../src/data/us/yahoo-session.js";

vi.mock("../../src/data/us/yahoo-session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/us/yahoo-session.js")>();
  return {
    ...actual,
    yahooFetch: vi.fn(),
    resetYahooSessionForTests: vi.fn(),
  };
});

function mockScreenerResponse(quotes: unknown[], total?: number) {
  return {
    ok: true,
    json: async () => ({
      finance: {
        result: [
          {
            quotes,
            total: total ?? quotes.length,
          },
        ],
      },
    }),
  };
}

describe("createUsYahooAdapter", () => {
  beforeEach(() => {
    vi.mocked(yahooFetch).mockReset();
  });

  it("maps screener response to SecurityRecord shape", async () => {
    vi.mocked(yahooFetch).mockResolvedValue(
      mockScreenerResponse([
        {
          symbol: "AAPL",
          shortName: "Apple Inc.",
          longName: "Apple Inc.",
          marketCap: 3000000000000,
          currency: "USD",
          quoteType: "EQUITY",
          firstTradeDateMilliseconds: Date.now() - 20 * 365.25 * 24 * 60 * 60 * 1000,
        },
      ]) as Response
    );

    const adapter = createUsYahooAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["US"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.ticker).toBe("AAPL");
    expect(records[0]?.market).toBe("US");
    expect(records[0]?.companyName).toBe("Apple Inc.");
    expect(records[0]?.marketCap).toBe(3000000000000);
    expect(records[0]?.currency).toBe("USD");
    expect(records[0]?.status).toBe("active");
    expect(records[0]?.listingAgeYears).toBeCloseTo(20, 0);
  });

  it("paginates screener results until total is reached", async () => {
    vi.mocked(yahooFetch)
      .mockResolvedValueOnce(
        mockScreenerResponse(
          [
            { symbol: "AAPL", shortName: "Apple", marketCap: 3000, quoteType: "EQUITY" },
            { symbol: "MSFT", shortName: "Microsoft", marketCap: 2800, quoteType: "EQUITY" },
          ],
          3
        ) as Response
      )
      .mockResolvedValueOnce(
        mockScreenerResponse(
          [{ symbol: "GOOG", shortName: "Alphabet", marketCap: 2000, quoteType: "EQUITY" }],
          3
        ) as Response
      );

    const adapter = createUsYahooAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["US"]);

    expect(records.map((r) => r.ticker)).toEqual(["AAPL", "MSFT", "GOOG"]);
    expect(yahooFetch).toHaveBeenCalledTimes(2);
  });

  it("skips non-equity quotes", async () => {
    vi.mocked(yahooFetch).mockResolvedValue(
      mockScreenerResponse([
        { symbol: "SPY", shortName: "SPDR S&P 500", quoteType: "ETF", marketCap: 500000000000 },
        { symbol: "AAPL", shortName: "Apple", quoteType: "EQUITY", marketCap: 3000000000000 },
      ]) as Response
    );

    const adapter = createUsYahooAdapter({ cacheDir: "/tmp/screener-cache" });
    const records = await adapter.loadUniverse(["US"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.ticker).toBe("AAPL");
  });

  it("throws when screener request fails", async () => {
    vi.mocked(yahooFetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const adapter = createUsYahooAdapter({ cacheDir: "/tmp/screener-cache" });
    await expect(adapter.loadUniverse(["US"])).rejects.toThrow("Yahoo screener failed: 503");
  });
});
