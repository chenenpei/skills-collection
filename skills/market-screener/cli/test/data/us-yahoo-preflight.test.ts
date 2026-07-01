import { beforeEach, describe, expect, it, vi } from "vitest";
import { yahooFetch } from "../../src/lib/yahoo-session.js";
import { probeYahooFinance } from "../../src/data/us/yahoo-preflight.js";

vi.mock("../../src/lib/yahoo-session.js", () => ({
  yahooFetch: vi.fn(),
}));

function yahooQuoteResponse(price: number): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      quoteResponse: {
        result: [{ symbol: "AAPL", regularMarketPrice: price, marketCap: 3_000_000_000_000 }],
      },
    }),
  } as Response;
}

describe("probeYahooFinance", () => {
  beforeEach(() => {
    vi.mocked(yahooFetch).mockReset();
  });

  it("passes when Yahoo returns a usable quote", async () => {
    vi.mocked(yahooFetch).mockResolvedValue(yahooQuoteResponse(210.12));

    await expect(probeYahooFinance()).resolves.toBeUndefined();

    expect(yahooFetch).toHaveBeenCalledWith(
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL"
    );
  });

  it("reports cloud-IP style session bootstrap 429 as an operational block", async () => {
    vi.mocked(yahooFetch).mockRejectedValue(new Error("Yahoo session bootstrap failed: 429"));

    await expect(probeYahooFinance()).rejects.toThrow(/host\/IP may be blocked by Yahoo CDN/);
  });

  it("reports crumb 429 as an operational block", async () => {
    vi.mocked(yahooFetch).mockRejectedValue(new Error("Yahoo crumb failed: 429"));

    await expect(probeYahooFinance()).rejects.toThrow(/Set HTTPS_PROXY to a non-cloud exit/);
  });

  it("fails when the quote probe returns no usable price", async () => {
    vi.mocked(yahooFetch).mockResolvedValue(yahooQuoteResponse(0));

    await expect(probeYahooFinance()).rejects.toThrow(
      "Yahoo preflight failed: quote probe returned no usable AAPL price"
    );
  });

  it("reports quote endpoint HTTP 429 as an operational block", async () => {
    vi.mocked(yahooFetch).mockResolvedValue({ ok: false, status: 429 } as Response);

    await expect(probeYahooFinance()).rejects.toThrow(/host\/IP may be blocked by Yahoo CDN/);
  });

  it("fails when the Yahoo quote endpoint returns a non-OK response", async () => {
    vi.mocked(yahooFetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(probeYahooFinance()).rejects.toThrow(
      "Yahoo preflight failed: quote probe returned HTTP 503"
    );
  });
});
