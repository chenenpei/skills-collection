import { describe, it, expect } from "vitest";
import { parseEastMoneyIndustry } from "../../src/adapters/cn/eastmoney-industry.js";

describe("parseEastMoneyIndustry", () => {
  it("prefers BOARD_NAME_LEVEL then EM2016", () => {
    expect(
      parseEastMoneyIndustry({
        BOARD_NAME_LEVEL: "食品饮料-白酒Ⅱ-白酒Ⅲ",
        EM2016: "食品饮料-饮料-白酒",
      })
    ).toBe("食品饮料-白酒Ⅱ-白酒Ⅲ");
  });

  it("falls back to EM2016 when BOARD_NAME_LEVEL is empty", () => {
    expect(
      parseEastMoneyIndustry({
        BOARD_NAME_LEVEL: "",
        EM2016: "食品饮料-饮料-白酒",
      })
    ).toBe("食品饮料-饮料-白酒");
  });
});
