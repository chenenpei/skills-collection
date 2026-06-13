# 07 Fund Red Team and Verdict Prompt

用于 ETF / 基金 Deep 流程的最终 red team、组合角色判定和基金裁决。

## Prompt

请基于前面已经完成的 fund identification、wrapper audit、portfolio anatomy、weighted valuation、growth attribution、peer comparison 和 symmetric misunderstanding audit，进行最终基金裁决。

Fund / Ticker：`[填写]`

已完成材料：

```text
[粘贴前面几步的关键结论、表格和数据]
```

## 分析任务

1. 先列出 3-5 个会让该基金作为工具失效的机制，而不是普通价格波动。
2. 检查 wrapper 风险：费用、tracking、流动性、premium / discount、税务、结构、杠杆 / 反向属性、发行方或清盘风险。
3. 检查 portfolio risk：集中度、行业周期、估值、盈利增长过度依赖少数持仓、指数方法导致的拥挤或再平衡风险。
4. 检查 peer risk：是否存在费用更低、tracking 更好、暴露更精准、估值更合理或流动性更好的替代基金。
5. 回顾 Bull-side Misunderstanding 与 Bear-side Hidden Re-pricing，说明哪边证据更强。
6. 判断最合适的组合角色：core、satellite、tactical 或 avoid。
7. 输出最终 fund verdict、证伪指标和重新审计触发条件。

## 基金最终裁决

只能选择一个：

- Reject
- Watchlist
- Satellite Hold
- Core Hold
- Tactical Only

如果数据质量为 Low，最终裁决不得高于 Watchlist。

## 输出模板

```markdown
## Final Fund Verdict

- Final verdict：
- Confidence：
- Data quality：
- Best portfolio role：

## Key Supporting Evidence

1.
2.
3.

## Key Opposing Evidence

1.
2.
3.

## Red-Team Risks

| Risk | Evidence | Falsification metric | Re-audit trigger |
|---|---|---|---|

## Peer and Benchmark Decision

- Closest peer fund used：
- Broad benchmark used：
- Is this fund a better tool than the peer? Why / why not：
- Is this fund a better tool than the broad benchmark for the desired exposure? Why / why not：

## Closing Rules

1. Does the verdict apply to the fund as a tool, not the underlying industry alone?
2. Was portfolio forward P/E issuer-disclosed or calculated?
3. Were bullish growth claims validated at portfolio level?
4. Were bearish narratives tested for hidden re-pricing evidence?
5. Which peer fund and broad benchmark were used?
6. What is the best portfolio role: core, satellite, tactical, or avoid?

## Final Three Questions

1. Is this fund a better tool than the relevant peer fund and broad benchmark for the exposure the user wants?
2. Which fact is most likely to overturn the conclusion?
3. If not using it now, what should change before re-audit?
```

## 禁止

- 不要使用个股 verdict labels，例如 High Conviction Candidate。
- 不要把基金裁决写成底层行业一定值得买。
- 不要忽略 peer fund 和 broad benchmark。
