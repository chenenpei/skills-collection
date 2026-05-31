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
- 公司识别规则
- 数据规则
- 分析工作流
- 投资类型判定
- 护城河和管理层审计
- 估值与机会成本
- 被误解资产审计
- 逆向排雷
- 最终裁决
- 输出模板
- 风格规则

## 拆分逻辑

### Chatbot 版本

目标：让无工具或弱工具模型通过多轮对话完成工作流。

拆分方式：

- 全局规则进入 `chatbot/00-system-prompt.md`
- 公司识别进入 `chatbot/01-company-identification.md`
- 默认初筛进入 `chatbot/02-lite-screening.md`
- 无数据场景进入 `chatbot/03-data-intake.md`
- 跨周期财务进入 `chatbot/04-cross-cycle-financial-audit.md`
- 护城河、管理层、能力圈进入 `chatbot/05-business-quality-and-moat.md`
- 估值和机会成本进入 `chatbot/06-valuation-and-opportunity-cost.md`
- 逆向排雷、分类和裁决进入 `chatbot/07-red-team-and-verdict.md`

### Agent Skill 版本

目标：让工具丰富的 Agent 主动执行工作流。

拆分方式：

- 触发条件和执行总则进入本目录 `SKILL.md`
- 数据纪律进入 `references/data-contract.md`
- Lite/Deep 流程进入 `references/workflow.md`
- M/N 分类规则进入 `references/classification-rules.md`
- 输出结构进入 `references/output-templates.md`
- 工具顺序和停止条件进入 `references/tool-policy.md`

## 有意修改

- 不再把完整审计流程塞进 system prompt。
- 不再要求用户一开始输入交易市场、指数、分析模式等完整参数。
- 默认 Lite 初筛。
- 默认基准为纳斯达克 100、中证红利和相关 10 年期国债收益率。
- 公司身份不明确时先停止追问。
- 增加“被误解资产审计”作为逆向排雷的对称补充：逆向排雷用于从好故事里找坏事实；被误解资产审计用于从坏叙事里找隐藏资产、旧标签错配和新利润池。
- 在被误解资产审计下加入“铁证清单”：现金流-利润剪刀差、逆周期回购、新增长曲线定量火苗、行业寒冬清场效应，以及核心伤口是癌症还是感冒。
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
