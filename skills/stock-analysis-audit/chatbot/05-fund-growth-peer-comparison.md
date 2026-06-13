# 05 Fund Growth and Peer Comparison Prompt

用于 ETF / 基金 Deep 流程：做组合增长归因、同类基金比较和广义基准机会成本比较。

## Prompt

请基于前面完成的 fund identification、wrapper audit 和 holdings anatomy，完成增长归因与同类基金比较。不要直接给最终裁决，除非数据不足以继续。

Fund / Ticker：`[填写]`

已完成材料：

```text
[粘贴前面步骤的关键结论、持仓表、估值数据、peer data]
```

## 分析任务

1. 估算 portfolio weighted NTM earnings growth，如无法估算，说明缺失项。
2. 区分增长来源：
   - 少数龙头贡献
   - 广泛持仓扩散
   - 周期恢复
   - 估值扩张
   - 会计或一次性因素
3. 识别 drag names：高权重但低增长、高估值或周期下行的持仓。
4. 与至少一个 closest peer fund 比较费用、AUM、流动性、tracking、集中度、组合估值、组合增长和指数方法。
5. 与 broad benchmark 和相关 10 年期国债收益率比较机会成本。
6. 说明该基金更像 core、satellite、tactical 还是 avoid 的候选，但不要输出最终裁决。

## 输出模板

```markdown
## Weighted Growth Attribution

| Source | Evidence | Portfolio-level impact | Confidence |
|---|---|---|---|

## Leader Contribution vs Drag Names

| Holding / group | Weight | Growth role | Valuation role | Notes |
|---|---:|---|---|---|

## Peer Fund Comparison

| Metric | Target fund | Peer fund | Better tool | Notes |
|---|---:|---:|---|---|

## Broad Benchmark and Risk-Free-Rate Comparison

| Alternative | Role | Relative advantage | Relative risk |
|---|---|---|---|

## Interim Tool Role

- Current best role candidate：
- Evidence supporting that role：
- Evidence against that role：
- Data still needed：
```

## 禁止

- 不要用一个龙头公司的增速外推整个基金。
- 不要只比较过去收益率，忽略费用、估值、集中度和 tracking。
- 不要把 peer fund 当成装饰；最终裁决必须依赖真实 peer comparison。
