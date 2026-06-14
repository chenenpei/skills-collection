import { describe, it, expect } from "vitest";
import { mapPool } from "../../src/lib/concurrency.js";

describe("mapPool", () => {
  it("limits concurrent executions", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return n * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
