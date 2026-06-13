import { describe, it, expect } from "vitest";
import { parseTickerMap } from "../../src/data/us/sec.js";
import { parseSubmissionsIndustry } from "../../src/data/us/sec.js";

describe("SEC adapters", () => {
  it("parses company_tickers.json", () => {
    const map = parseTickerMap({
      "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    });
    expect(map.get("AAPL")).toBe("0000320193");
  });

  it("parses sicDescription from submissions", () => {
    expect(
      parseSubmissionsIndustry({ sicDescription: "Electronic Computers", sic: "3571" })
    ).toBe("Electronic Computers");
  });
});
