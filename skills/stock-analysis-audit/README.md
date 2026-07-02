# stock-analysis-audit

证据优先的证券分析审计技能，覆盖单一公司股票、ETF、指数基金、主动基金和其他集合投资工具。

目标不是证明某个标的值得买，而是判断：

- 个股是否值得承担单一个股集中风险，而不是选择指数或无风险资产
- 基金是否是获得目标暴露的合理工具，而不是选择同类基金、广义基准或现金类资产

所有结论仅用于研究辅助，不构成投资建议。

## 目录结构

| 路径 | 用途 |
|------|------|
| `SKILL.md` | Agent 加载入口 |
| `CONTEXT.md` | 概念词典：裁决、投资类型、生命周期、商业原型、审计术语 |
| `spec/` | Agent 运行时规范，英文维护 |
| `chatbot/` | 无工具 Chatbot 分阶段提示词，英文维护 |
| `docs/` | 中文使用手册和示例 |

`spec/` 文件职责：

| 文件 | 职责 |
|------|------|
| `index.md` | 维护索引和运行时加载地图 |
| `gates.md` | 停止、降级、防跳步与共享审计流程 |
| `data.md` | 数据口径、来源优先级、交叉验证和计算公式 |
| `workflow-company.md` | 个股 Lite（轻量审计）/ Deep（深度审计）流程 |
| `workflow-fund.md` | ETF / 基金 Lite（轻量审计）/ Deep（深度审计）流程 |
| `classification.md` | 个股 Deep M/N 投资类型判定 |
| `templates-company.md` | 个股输出模板 |
| `templates-fund.md` | ETF / 基金输出模板 |

## 安装

在目标项目目录：

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill stock-analysis-audit -y
```

已克隆 `skills-collection` 时：

```bash
npx skills add . --skill stock-analysis-audit -y
```

## 触发示例

```text
用 stock-analysis-audit 对 Microsoft 做 Lite 初筛。
```

```text
用 stock-analysis-audit 对 NVDA 做 Deep 股票审计。
```

```text
用 stock-analysis-audit 对 SMH 做 Lite ETF 审计，重点看估值、增长归因和同类基金比较。
```

```text
用 stock-analysis-audit 对 SOXX 和 SMH 做基金工具对比。
```

## 输出语言

运行时规范使用英文维护，但最终报告语言不锁死：

- 默认跟随用户提问语言
- 用户显式指定语言时优先
- 财务指标缩写保留标准写法，例如 P/E、FCF、ROE、AUM
- 报告末尾包含 `Structured Summary`，用稳定 slug 保证可审计

示例：

```markdown
## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_medium | Medium |
| business_archetype | archetype_toll_road | 收费公路型 |
| investment_classification | classification_quality_at_reasonable_price | 合理价格的高质量公司 |
| final_verdict | verdict_watchlist | 观察名单 |
```

## 文档

- `docs/agent-guide.md`：Agent 使用与质量检查
- `docs/chatbot-guide.md`：Chatbot 分阶段使用
- `docs/examples.md`：中文触发示例和输出质量说明
