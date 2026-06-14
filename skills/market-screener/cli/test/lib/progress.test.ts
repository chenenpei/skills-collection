import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgressLogger } from "../../src/lib/progress.js";

describe("createProgressLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes phase and warn lines to stderr", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const progress = createProgressLogger({ prefix: "test" });
    progress.phase("loading");
    progress.warn("something odd");

    expect(stderr).toHaveBeenCalledWith("[test] loading");
    expect(stderr).toHaveBeenCalledWith("[test] warn: something odd");
  });

  it("throttles intermediate ticks but always prints the final tick", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const progress = createProgressLogger({ prefix: "test", throttleMs: 5000 });
    progress.tick(100, 1000, "enrichment");
    progress.tick(150, 1000, "enrichment");
    progress.tick(1000, 1000, "enrichment");

    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenNthCalledWith(1, "[test] enrichment: 100/1000 (10.0%)");
    expect(stderr).toHaveBeenNthCalledWith(2, "[test] enrichment: 1000/1000 (100.0%)");
  });
});
