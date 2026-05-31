# Chatbot 使用手册

本手册说明如何在传统 Chatbot 中使用股票分析 prompt 包。适用对象包括没有工具、没有联网或金融数据能力有限的模型。

## 核心思路

传统 Chatbot 不应被要求“一次性完成完整股票审计”。更稳妥的方式是：

1. 用短 system prompt 固定纪律。
2. 分阶段投喂 user prompt。
3. 由用户提供模型无法可靠获取的数据。
4. 每一步只解决一个问题。
5. 数据不足时停住，不让模型编造。

## 最短 Lite 流程

适合快速判断是否值得继续研究。

1. 把 `chatbot/00-system-prompt.md` 放入 system prompt，或作为第一条消息发给模型。
2. 复制 `chatbot/01-company-identification.md`，填入公司关键词。
3. 公司识别确认后，复制 `chatbot/02-lite-screening.md`。
4. 如果模型说数据不足，复制 `chatbot/03-data-intake.md`，让它列出最小数据需求。

## Deep 流程

适合你愿意手动整理财务数据时使用。

推荐顺序：

```text
00-system-prompt.md
01-company-identification.md
03-data-intake.md
04-cross-cycle-financial-audit.md
05-business-quality-and-moat.md
06-valuation-and-opportunity-cost.md
07-red-team-and-verdict.md
```

## 何时停止

遇到以下情况时，不要继续让模型输出结论：

- 公司身份不明确。
- 模型无法说明数据来源。
- 模型把缺失数据当成事实。
- 关键数据口径混乱，例如 TTM、年度、季度混用。
- 模型给出“值得买”之类结论，但没有机会成本对比。

## 用户应提供什么数据

如果模型没有联网能力，至少提供：

- 公司全名、Ticker、上市地、交易货币
- 最近一年或 TTM 的收入、净利润、经营现金流、Capex、FCF
- 当前市值、企业价值或可计算这些指标的数据
- 最近一期净现金或净债务
- 相关 10 年期国债收益率
- 纳斯达克 100 和中证红利的可比数据

Deep 审计应尽量提供 5-10 年历史财务数据。

## 推荐实践

- 每轮只投喂一个阶段 prompt。
- 每一步完成后先人工检查数字和口径，再进入下一步。
- 对无联网模型，不要使用“动态查询”“实时检索”这类要求。
- 把最终裁决当作研究框架，不要当作投资建议。
