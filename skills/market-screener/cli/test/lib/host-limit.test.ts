import { describe, it, expect } from "vitest";
import { withHostLimit } from "../../src/lib/host-limit.js";

describe("withHostLimit", () => {
  it("caps concurrent executions per host", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        withHostLimit("example.com", 2, async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
        })
      )
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
