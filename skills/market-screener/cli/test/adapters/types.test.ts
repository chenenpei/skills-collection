import { describe, it, expect } from "vitest";
import { createFixtureAdapter } from "../../src/adapters/fixture.js";

describe("MarketDataAdapter enrichRecords", () => {
  it("fixture adapter enrichRecords is optional no-op", async () => {
    const adapter = createFixtureAdapter();
    const universe = await adapter.loadUniverse(["CN"]);
    expect(universe.length).toBeGreaterThan(0);

    if (!adapter.enrichRecords) {
      expect(universe[0].metrics.roe_5y_avg?.value).toBeDefined();
      return;
    }

    const enriched = await adapter.enrichRecords(universe, {
      quarter: "2026-Q1",
      cacheDir: "/tmp/screener-test-cache",
      concurrency: 4,
    });
    expect(enriched[0].metrics.roe_5y_avg?.value).toBeDefined();
  });
});
