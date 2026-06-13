# 01 Security Identification Prompt

用于传统 Chatbot 的第一步：识别用户想分析的证券，并决定后续走个股路径还是基金 / ETF 路径。

## Prompt

请根据我提供的关键词识别证券。关键词如下：

`[在这里填入公司名、Ticker、ETF 名称、基金简称、业务关键词或暴露关键词]`

请先完成证券识别，不要直接进入财务分析、估值分析或基金裁决。

## 识别任务

请输出：

1. 最可能的证券名称
2. Ticker
3. 证券类型：single company / ETF / index fund / active fund / other pooled vehicle / unclear
4. 主要上市地
5. 主要交易货币
6. 如果是单一公司：主营业务一句话说明，ADR、双重上市、A/H 股、share class 或同名公司风险
7. 如果是 ETF / 基金：issuer / sponsor、tracked index 或 active mandate、expense ratio、closest peer fund candidates
8. 识别置信度：High / Medium / Low

## 停止条件

如果存在多个可能对象，请不要继续分析。请列出候选项，并让我选择。

如果证券代码、上市地、share class、fund wrapper、tracked index 或证券类型无法可靠确认，请只提出一个最关键的问题，不要生成财务分析。

## 输出格式

```markdown
## 证券识别结果

- 识别对象：
- Ticker：
- 证券类型：
- 主要上市地：
- 交易货币：
- 单一公司信息：
  - 主营业务：
  - 潜在歧义：
- ETF / 基金信息：
  - Issuer / sponsor：
  - Index tracked / mandate：
  - Expense ratio：
  - Closest peer fund candidates：
- 识别置信度：

## 下一步

如果识别置信度为 High，请说明后续应进入哪条路径：

- single company → `02-lite-screening.md`
- ETF / fund → `02-lite-fund-screening.md`

如果识别置信度不是 High，请说明需要我确认的最小信息。
```

## 禁止

- 在无确认标的的情况下编造财报、估值、持仓或基金数据。
- 把 ETF / 基金误当成经营公司分析。
- 一次提出多个追问。
