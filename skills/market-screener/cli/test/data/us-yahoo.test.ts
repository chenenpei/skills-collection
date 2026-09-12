import { describe, it, expect, vi, beforeEach } from "vitest";
const curlExec = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFile: curlExec }));

import {
  createUsYahooAdapter,
  fetchUsQuoteSnapshot,
} from "../../src/us/sources/market-data.js";

const yahooFetch = vi.fn();

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
    yahooFetch.mockReset();
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

    const adapter = createUsYahooAdapter(yahooFetch);
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

    const adapter = createUsYahooAdapter(yahooFetch);
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

    const adapter = createUsYahooAdapter(yahooFetch);
    const records = await adapter.loadUniverse(["US"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.ticker).toBe("AAPL");
  });

  it("throws when screener request fails", async () => {
    vi.mocked(yahooFetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const adapter = createUsYahooAdapter(yahooFetch);
    await expect(adapter.loadUniverse(["US"])).rejects.toThrow("Yahoo screener failed: 503");
  });
});

describe("Yahoo session", () => {
  it("single-flights cold cookie and crumb bootstrap across concurrent quote requests", async () => {
    curlExec.mockImplementation((_file, args, _opts, callback) => {
      const url = args.at(-1) as string;
      if (url.startsWith("https://fc.yahoo.com")) {
        callback(null, { stdout: "404", stderr: "" });
        return;
      }
      if (url.startsWith("https://query1.finance.yahoo.com/v1/test/getcrumb")) {
        callback(null, { stdout: "crumb\n__CURL_HTTP_CODE__:200", stderr: "" });
        return;
      }
      callback(null, {
        stdout: JSON.stringify({
          quoteSummary: {
            result: [{ summaryDetail: { trailingPE: { raw: 20 }, dividendYield: { raw: 0.01 } } }],
          },
        }) + "\n__CURL_HTTP_CODE__:200",
        stderr: "",
      });
    });

    const [first, second] = await Promise.all([
      fetchUsQuoteSnapshot("AAPL"),
      fetchUsQuoteSnapshot("MSFT"),
    ]);

    expect(first).toMatchObject({ metrics: { pe_ttm: { value: 20 } }, dividendYield: 0.01 });
    expect(second).toMatchObject({ metrics: { pe_ttm: { value: 20 } }, dividendYield: 0.01 });
    expect(curlExec.mock.calls.filter(([, args]) => (args.at(-1) as string).startsWith("https://fc.yahoo.com"))).toHaveLength(1);
    expect(curlExec.mock.calls.filter(([, args]) => (args.at(-1) as string).includes("/v1/test/getcrumb"))).toHaveLength(1);
  });
});
