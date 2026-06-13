# stock-analysis-audit

证据优先的证券分析审计 Skill，覆盖单一公司股票、ETF、指数基金、主动基金和其他 pooled fund vehicles，包含 Agent 运行时说明、Chatbot 分阶段 prompt、母版规范与使用手册。

## 目录

| 路径 | 用途 |
|------|------|
| `SKILL.md` | Agent 加载入口 |
| `references/data-contract.md` | 个股与基金数据纪律 |
| `references/workflow.md`、`references/output-templates.md`、`references/classification-rules.md` | 个股 workflow、输出模板与 M/N 分类 |
| `references/fund-workflow.md`、`references/fund-output-templates.md` | ETF / 基金 workflow 与输出模板 |
| `references/tool-policy.md` | 工具策略、分流和停止条件 |
| `source/` | 母版完整规范（维护用，勿整段作 system prompt） |
| `chatbot/` | 无工具 Chatbot 个股与基金分阶段 prompt |
| `manuals/` | 使用手册、示例、迁移说明 |

更完整的 kit 说明见 [PROMPT-KIT.md](PROMPT-KIT.md)。

## 安装

在目标项目目录：

```bash
npx skills add https://github.com/chenenpei/skiils-collection --skill stock-analysis-audit -y
```

已克隆 `skills-collection` 时：

```bash
npx skills add . --skill stock-analysis-audit -y
```

Cursor 个人 skill 目录（可选）：

```bash
cp -R skills/stock-analysis-audit ~/.cursor/skills/stock-analysis-audit
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
