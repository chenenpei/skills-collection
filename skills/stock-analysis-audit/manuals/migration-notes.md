# Migration Notes

本文说明如何从原始母版 prompt 拆分到 Prompt Kit。

## 原始母版

规范源文件（本 kit 内 canonical 副本）：

```text
source/stock-analysis-audit-prompt.md
```

本 skill 已并入 `skills-collection` 的 `skills/stock-analysis-audit/`。若桌面或 home 仍有独立的 `stock-analysis-prompt-kit` 副本，请以仓库内 `source/` 为准，避免多处各自修改导致漂移。

母版包含：

- 角色设定
- 最小输入与默认值
- 证券类型识别与分流规则
- 公司识别规则
- 基金 / ETF 识别规则
- 数据规则
- 个股分析工作流
- 基金 / ETF 分析工作流
- 个股投资类型判定
- 护城河和管理层审计
- 估值与机会成本
- 被误解资产审计与基金双向误解检查
- 逆向排雷
- 个股最终裁决
- 基金 / ETF 工具角色裁决
- 输出模板
- 风格规则

## 拆分逻辑

### Chatbot 版本

目标：让无工具或弱工具模型通过多轮对话完成工作流。

拆分方式：

- 全局规则进入 `chatbot/00-system-prompt.md`
- 证券识别进入 `chatbot/01-security-identification.md`
- 个股默认初筛进入 `chatbot/02-lite-screening.md`
- 基金默认初筛进入 `chatbot/02-lite-fund-screening.md`
- 个股无数据场景进入 `chatbot/03-data-intake.md`
- 基金无数据场景进入 `chatbot/03-fund-data-intake.md`
- 跨周期财务进入 `chatbot/04-cross-cycle-financial-audit.md`
- 护城河、管理层、能力圈进入 `chatbot/05-business-quality-and-moat.md`
- 估值和机会成本进入 `chatbot/06-valuation-and-opportunity-cost.md`
- 逆向排雷、分类和裁决进入 `chatbot/07-red-team-and-verdict.md`
- 基金 Deep 组合结构进入 `chatbot/04-fund-portfolio-anatomy.md`
- 基金 Deep 增长归因和同类比较进入 `chatbot/05-fund-growth-peer-comparison.md`
- 基金 Deep 暴露层误解检查进入 `chatbot/06-fund-exposure-misunderstanding.md`
- 基金 Deep 红队和裁决进入 `chatbot/07-fund-red-team-and-verdict.md`

### Agent Skill 版本

目标：让工具丰富的 Agent 主动执行工作流。

拆分方式：

- 触发条件和执行总则进入本目录 `SKILL.md`
- 数据纪律进入 `references/data-contract.md`
- 个股 Lite/Deep 流程进入 `references/workflow.md`
- 基金 / ETF Lite/Deep 流程进入 `references/fund-workflow.md`
- 个股 M/N 分类规则进入 `references/classification-rules.md`
- 个股输出结构进入 `references/output-templates.md`
- 基金 / ETF 输出结构进入 `references/fund-output-templates.md`
- 工具顺序和停止条件进入 `references/tool-policy.md`

## 有意修改

- 不再把完整审计流程塞进 system prompt。
- 不再要求用户一开始输入交易市场、指数、分析模式等完整参数。
- 默认 Lite 初筛。
- 默认基准为纳斯达克 100、中证红利和相关 10 年期国债收益率。
- 证券身份不明确时先停止追问。
- 增加“被误解资产审计”作为逆向排雷的对称补充：逆向排雷用于从正面投资假设中寻找反证；被误解资产审计用于从负面市场叙事中寻找未充分反映的资产、业务分类错配和新利润池。
- 在被误解资产审计下加入“证据清单”：净利润与经营现金流背离、逆周期回购、新增长驱动的早期定量证据、下行周期中的竞争格局集中效应，以及核心问题属于周期性压力还是结构性损伤。
- 增加基金 / ETF 分流：基金作为组合暴露工具审计，不使用个股 M/N 分类、公司护城河评分或公司管理层评分。
- 基金 / ETF 同时执行 Bull-side debunking 与 Bear-side hidden re-pricing，避免只拆乐观叙事或只拆悲观叙事。
- Agent Skill 版本假设可用工具，但仍要求数据不足时停止或降级。
- Chatbot 版本不假设联网，明确要求用户补数据。

## 术语统一

保留：

- 投资类型判定
- 一票否决
- 观察名单
- 中期估值修复机会
- 合理价格的高质量公司
- 高 conviction 候选
- Reject
- Watchlist
- Satellite Hold
- Core Hold
- Tactical Only
- Bull-side debunking
- Bear-side hidden re-pricing

避免：

- 生造的分类术语
- 省略动作对象的指数替代表达
- 省略决策建议对象的配置表达
- 没有完整动作对象的省略句

## 后续维护建议

1. 先在 `source/stock-analysis-audit-prompt.md` 中确定规则变更。
2. 再同步到对应运行时产物：

- 修改分类阈值：同步 `chatbot/07-red-team-and-verdict.md` 与 `references/classification-rules.md`。
- 修改输出模板：同步 `chatbot/02-lite-screening.md`、`chatbot/07-red-team-and-verdict.md` 与 `references/output-templates.md`。
- 修改数据纪律：同步 `chatbot/00-system-prompt.md`、`chatbot/03-data-intake.md` 与 `references/data-contract.md`。
- 修改被误解资产审计：同步 `source/stock-analysis-audit-prompt.md`、`references/workflow.md`、`references/classification-rules.md`、`references/output-templates.md`、`chatbot/02-lite-screening.md` 与 `chatbot/07-red-team-and-verdict.md`。

## Sync Matrix

| 变更类型 | 必同步文件 |
|---|---|
| 规则 / 原则（任意） | `source/stock-analysis-audit-prompt.md` |
| 个股 workflow / 被误解资产 | `references/workflow.md`、`references/output-templates.md`、`references/classification-rules.md`、`chatbot/02-lite-screening.md`、`chatbot/07-red-team-and-verdict.md` |
| 基金 workflow / Growth Attribution / Misunderstanding | `references/fund-workflow.md`、`references/fund-output-templates.md`、`SKILL.md`、`chatbot/02-lite-fund-screening.md`、`chatbot/06-fund-exposure-misunderstanding.md`、`chatbot/07-fund-red-team-and-verdict.md` |
| 数据口径（含 Fund Metrics） | `references/data-contract.md`、`chatbot/03-data-intake.md`、`chatbot/03-fund-data-intake.md` |
| 工具 / 数据源顺序 | `references/tool-policy.md` 作为入口；`references/fund-workflow.md` 的 `Source Preference (Fund Version)` 作为基金细节真相源 |
| 使用说明 / 示例 | `README.md`、`PROMPT-KIT.md`、`manuals/*`、`manuals/examples.md`、`chatbot/README.md` |

## Consistency Checklist

维护完成后至少检查：

1. `source/stock-analysis-audit-prompt.md` 是否包含 Security Type Branch、Fund Verdict、Bull-side 与 Bear-side 对称检查。
2. `SKILL.md` 是否把 ETF / 基金路径导向 `fund-workflow.md` 和 `fund-output-templates.md`，并禁止使用个股 classification 作为基金裁决。
3. `references/tool-policy.md` 是否只做入口分流，并将基金数据源细节指向 `fund-workflow.md`。
4. Chatbot fund Lite 输出是否包含 Bull-side Misunderstanding 与 Bear-side Hidden Re-pricing Check。
5. 文档示例是否同时覆盖个股（如 MSFT）和基金 / ETF（如 SMH）。
6. “最终裁决只能从五档中选一个”等表述是否明确区分个股五档与基金五档。
