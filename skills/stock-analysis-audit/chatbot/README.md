# Chatbot 版本使用手册

这套 prompt 面向传统 Chatbot：工具有限、可能没有联网、不能可靠自动拉取财务数据。

## 推荐用法

1. 把 `00-system-prompt.md` 作为 system prompt 或会话开场规则。
2. 用 `01-company-identification.md` 先确认分析对象。
3. 默认使用 `02-lite-screening.md` 做初筛。
4. 如果模型无法联网或数据不足，使用 `03-data-intake.md` 让模型告诉你最小数据需求。
5. 当你提供了足够数据后，再按需投喂：
   - `04-cross-cycle-financial-audit.md`
   - `05-business-quality-and-moat.md`
   - `06-valuation-and-opportunity-cost.md`
   - `07-red-team-and-verdict.md`

## Lite 初筛流程

适合快速判断是否值得继续研究。

推荐顺序：

```text
00-system-prompt.md
01-company-identification.md
02-lite-screening.md
```

如果模型提示数据不足，则插入：

```text
03-data-intake.md
```

## Deep 深度审计流程

适合你愿意手动提供财报数据和指数数据时使用。

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

## 关键提醒

- 不要让无联网模型“动态查询”。如果它没有工具，应让它明确要求你提供数据。
- 不要一次性投喂所有阶段 prompt。分阶段运行能减少幻觉和格式疲劳。
- 如果公司身份存在歧义，必须先停住确认。
- 如果关键数据缺失，最终结论不得高于“观察名单”。

## 适合场景

- ChatGPT 普通对话
- Claude 普通对话
- Gemini 普通对话
- 没有联网、没有财务 API、没有文件工具的模型

## 不适合场景

- 需要自动检索财报、行情、指数数据的完整工作流
- 需要自动生成可复核数据表的严肃投资研究
- 需要一次性产出 Deep 报告

这些场景更适合使用本 skill 目录下的 `SKILL.md`（通过 `stock-analysis-audit` 触发）。
