# 06 Fund Exposure Misunderstanding Prompt

用于 ETF / 基金 Deep 流程：在底层暴露层面执行 profit-pool destruction check，并做 Bull-side 与 Bear-side 对称误解审计。

## Prompt

请基于前面完成的基金身份、组合结构、加权估值、增长归因和同类比较，完成暴露层误解检查。不要把基金当作经营公司分析。

Fund / Ticker：`[填写]`

已完成材料：

```text
[粘贴前面步骤的关键结论、持仓表、估值、增长归因、peer comparison]
```

## 分析任务

1. Exposure-Level Profit-Pool Destruction Check：
   - 底层行业或资产类别的利润池由什么驱动？
   - 谁不靠该利润池赚钱但能摧毁它？
   - 监管、技术替代、产能、价格战、平台方、供应链或宏观变量是否正在改变利润池？
   - 这些风险是否已经出现在领先指标中？
2. Bull-side Misunderstanding：
   - 市场或用户的乐观叙事是什么？
   - 该叙事是否只在少数龙头持仓成立？
   - 组合层加权估值与加权增长是否支持该叙事？
   - P/E 下降是否来自盈利真实增长，还是来自周期顶部、一次性利润或会计口径？
3. Bear-side Hidden Re-pricing Check：
   - 市场或用户的悲观叙事是什么？
   - 该叙事是否忽略组合盈利追赶、周期恢复、指数方法变化、持仓结构变化、成本下降或需求扩散？
   - 是否存在组合层早期证据，而不是单一持仓故事？
   - 如果悲观叙事错了，最可能错在哪里？
4. Evidence Balance：
   - 哪边证据更强？
   - 哪个事实最可能推翻当前判断？

## 输出模板

```markdown
## Exposure-Level Profit-Pool Destruction Check

| Mechanism | Evidence | Leading indicator | Severity |
|---|---|---|---|

## Bull-side Misunderstanding

- Bull narrative：
- Portfolio-level evidence supporting it：
- Portfolio-level evidence against it：
- Verdict on bull narrative：

## Bear-side Hidden Re-pricing Check

- Bear narrative：
- Hidden re-pricing evidence：
- Evidence still missing：
- Verdict on bear narrative：

## Evidence Balance

- Stronger side：
- Most important falsification metric：
- Implication for fund role：
```

## 禁止

- 不要只做 Bull-side 或只做 Bear-side。
- 不要把单一持仓的好消息或坏消息当成组合层结论。
- 不要用行业口号替代组合层数据。
