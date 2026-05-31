# stock-analysis-audit

证据优先的股票分析审计 Skill，包含 Agent 运行时说明、Chatbot 分阶段 prompt、母版规范与使用手册。

## 目录

| 路径 | 用途 |
|------|------|
| `SKILL.md` | Agent 加载入口 |
| `references/` | 数据纪律、工作流、分类规则、输出模板、工具策略 |
| `source/` | 母版完整规范（维护用，勿整段作 system prompt） |
| `chatbot/` | 无工具 Chatbot 分阶段投喂 prompt |
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
