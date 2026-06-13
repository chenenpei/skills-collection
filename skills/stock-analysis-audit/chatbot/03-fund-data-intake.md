# 03 Fund Data Intake Prompt

用于无联网或弱工具 Chatbot。目标是让模型不要编造 ETF / 基金数据，而是先向用户索取可分析的最小数据。

## Prompt

你现在没有可靠的数据检索能力。请不要编造任何基金、持仓、估值、增长、tracking 或 peer 数据。

我要分析的基金是：

- Fund / Ticker：`[填写]`
- Fund type：`[ETF / index fund / active fund / other pooled vehicle]`
- 分析模式：`[Lite / Deep]`
- 用户想获得的暴露：`[可选]`

请先告诉我为了继续分析，最少需要我提供哪些数据。请按“必须提供”和“可选增强”区分，不要一次索要过多无关数据。

## 最小数据清单

### Lite Fund 必须提供

- 基金身份：fund full name、Ticker、上市地、交易货币、issuer / sponsor。
- 基金类型：ETF、index fund、active fund、closed-end fund 或其他。
- Index tracked 或 active mandate。
- 最近 fact sheet 或 holdings 的日期。
- NAV / market price。
- AUM。
- Expense ratio。
- Number of holdings。
- Top 10 holdings and weights。
- Sector / country weights。
- Closest peer fund 至少一个。
- Broad benchmark 至少一个。
- Portfolio trailing P/E，如可得。
- Portfolio forward P/E，如可得；必须标注来源。

### Lite Fund 可选增强

- Distribution yield。
- Premium / discount to NAV。
- Tracking difference。
- Average daily volume 或 bid-ask spread。
- Beta vs benchmark。
- Weighted NTM earnings growth estimate。
- Rebalance / reconstitution notes。

### Deep Fund 额外需要

- Index methodology document 或 active mandate details。
- Top 10-20 holdings 的 trailing P/E、forward P/E、NTM earnings growth。
- Peer fund 的 fee、AUM、holdings concentration、valuation、tracking、liquidity。
- Broad benchmark valuation and performance。
- Risk-free-rate data。
- Distribution and tax notes，如相关。
- Active fund 的 manager tenure、active share、turnover、long-term excess return evidence，如相关。

## 输出格式

```markdown
## 无法继续分析的原因

## 必须补充的数据

| 数据项 | 为什么必须 | 可接受口径 |
|---|---|---|

## 可选增强数据

| 数据项 | 用途 |
|---|---|

## 最小可继续条件

提供哪些数据后，可以继续 Lite / Deep？
```

## 禁止

- 不要编造 fund wrapper、holdings、valuation 或 growth 数据。
- 不要用单一持仓数据替代组合层数据。
- 不要在 weighted forward P/E 缺失且影响裁决时强行给出积极结论。
