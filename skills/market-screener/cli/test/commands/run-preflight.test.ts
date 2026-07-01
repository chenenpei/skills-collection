import { beforeEach, describe, expect, it, vi } from "vitest";
import { probeYahooFinance } from "../../src/data/us/yahoo-preflight.js";
import { probeCnDatacenter } from "../../src/data/cn/eastmoney.js";
import { probeCnQuotes } from "../../src/data/cn/quotes.js";

const loadUniverse = vi.fn(async () => []);
const runFunnel = vi.fn(async () => ({
  candidateCount: 0,
  deferredCount: 0,
  excludedCount: 0,
}));

vi.mock("../../src/data/us/yahoo-preflight.js", () => ({
  probeYahooFinance: vi.fn(async () => undefined),
}));

vi.mock("../../src/data/cn/eastmoney.js", () => ({
  probeCnDatacenter: vi.fn(async () => undefined),
}));

vi.mock("../../src/data/cn/quotes.js", () => ({
  assertCnQuoteUniverseIntegrity: vi.fn(),
  probeCnQuotes: vi.fn(async () => undefined),
}));

vi.mock("../../src/data/registry.js", () => ({
  createAdapter: vi.fn(() => ({
    loadUniverse,
  })),
}));

vi.mock("../../src/spec/loader.js", () => ({
  loadSpecBundle: vi.fn(async () => ({
    killGates: {},
    index: {},
    templates: new Map(),
    routingMap: {},
    cnIndustryMap: {},
  })),
}));

vi.mock("../../src/funnel/run.js", () => ({
  runFunnel,
}));

describe("runCommand live preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadUniverse.mockResolvedValue([]);
    runFunnel.mockResolvedValue({
      candidateCount: 0,
      deferredCount: 0,
      excludedCount: 0,
    });
  });

  it("runs Yahoo preflight before a live US run", async () => {
    const { runCommand } = await import("../../src/commands/run.js");

    await runCommand({
      adapter: "live",
      markets: "US",
      quarter: "2026-Q2",
      output: "/tmp/screener-run-preflight",
      spec: "/tmp/spec",
    });

    expect(probeYahooFinance).toHaveBeenCalledTimes(1);
    expect(loadUniverse).toHaveBeenCalledTimes(1);
  });

  it("skips Yahoo preflight when skipPreflight is set", async () => {
    const { runCommand } = await import("../../src/commands/run.js");

    await runCommand({
      adapter: "live",
      markets: "US",
      quarter: "2026-Q2",
      output: "/tmp/screener-run-preflight",
      spec: "/tmp/spec",
      skipPreflight: true,
    });

    expect(probeYahooFinance).not.toHaveBeenCalled();
    expect(loadUniverse).toHaveBeenCalledTimes(1);
  });

  it("keeps existing CN preflight behavior for live CN runs", async () => {
    const { runCommand } = await import("../../src/commands/run.js");

    await runCommand({
      adapter: "live",
      markets: "CN",
      quarter: "2026-Q2",
      output: "/tmp/screener-run-preflight",
      spec: "/tmp/spec",
    });

    expect(probeCnDatacenter).toHaveBeenCalledTimes(1);
    expect(probeCnQuotes).toHaveBeenCalledTimes(1);
    expect(probeYahooFinance).not.toHaveBeenCalled();
  });

  it("runs CN and US preflight for combined live runs", async () => {
    const { runCommand } = await import("../../src/commands/run.js");

    await runCommand({
      adapter: "live",
      markets: "CN,US",
      quarter: "2026-Q2",
      output: "/tmp/screener-run-preflight",
      spec: "/tmp/spec",
    });

    expect(probeCnDatacenter).toHaveBeenCalledTimes(1);
    expect(probeCnQuotes).toHaveBeenCalledTimes(1);
    expect(probeYahooFinance).toHaveBeenCalledTimes(1);
  });
});
