# 02 Lite Fund Screening Prompt

用于传统 Chatbot 的 ETF / 基金默认初筛。适合快速判断该基金是否是获得目标暴露的合理工具。

## Prompt

请对以下 ETF / 基金进行 Lite 初筛：

- Fund / Ticker：`[填写基金名或 Ticker]`
- 已确认证券类型：`[ETF / index fund / active fund / other pooled vehicle]`
- 用户想获得的暴露：`[可选，例如半导体、纳斯达克 100、美国国债、黄金等]`
- 已知 peer fund：`[可选，例如 SOXX、VOO、IVV]`
- 用户能力圈说明：`[可选；如果没有，请在能力圈部分标记为信息不足]`

如果你没有联网能力，或无法可靠获得实时数据，请不要编造数据。请说明需要我补充哪些最小基金数据，或基于我已提供的数据做有限分析。

## Lite Fund 初筛任务

请按以下顺序输出：

1. One-Sentence Verdict
2. Fund Identification
3. Data Quality and Missing Items
4. Exposure Summary
5. Fund Wrapper Snapshot
6. Portfolio Anatomy
7. Weighted Valuation and Growth
8. Peer and Benchmark Comparison
9. Growth Attribution
10. Exposure-Level Profit-Pool Check
11. Bull-side Misunderstanding
12. Bear-side Hidden Re-pricing Check
13. Top Fund-Specific Risks
14. Preliminary Fund Verdict
15. Data Needed for Re-audit

## 必须检查

- Fund wrapper：NAV / market price、AUM、expense ratio、distribution yield、premium / discount、tracking difference、liquidity。
- Portfolio exposure：number of holdings、Top 5 / Top 10 weight、largest single-name weight、sector / country weights、weighted trailing P/E、weighted forward P/E、weighted NTM growth。
- Peer comparison：至少比较一个最接近的同类基金，并补充一个 broad benchmark。
- Weighted forward P/E 必须标注为 issuer-disclosed、third-party disclosed 或 calculated；如果 calculated，说明权重和估值来源。
- Bull-side：检验乐观叙事是否在组合层成立，而不是只在龙头持仓成立。
- Bear-side：检验悲观叙事是否忽略组合盈利追赶、周期恢复、暴露误解、指数方法变化或估值压缩后的再定价空间。

## 基金最终裁决

只能选择一个：

- Reject
- Watchlist
- Satellite Hold
- Core Hold
- Tactical Only

如果数据质量为 Low，最终裁决不得高于 Watchlist。

## 输出检查清单

报告结尾必须明确：

1. 裁决适用于基金作为工具，而不是底层行业本身。
2. weighted forward P/E 的来源或计算方式。
3. bullish growth claims 是否在组合层验证。
4. bearish narratives 是否经过 hidden re-pricing 检查。
5. 使用了哪个 peer fund 和 broad benchmark。
6. 最佳组合角色：core、satellite、tactical 或 avoid。

## 禁止

- 不要填写基金层面的公司收入、净利润、经营现金流、Capex、FCF、ROE 或 ROIC。
- 不要用一个龙头持仓的增长率代表基金组合增长。
- 不要把二手媒体 forward P/E 当成确定事实，除非有发行方披露或可复核的加权计算。
