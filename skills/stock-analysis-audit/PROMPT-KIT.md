# Stock Analysis Prompt Kit

本目录是 `skills-collection` 中的 **stock-analysis-audit** 技能包：母版规范 + Agent Skill + Chatbot 分阶段 prompt + 使用文档。

## 目录结构

- `SKILL.md` + `references/`：面向 Cursor / 通用 Agent 的运行时说明（通过 `npx skills add` 或复制到 `~/.cursor/skills/` 安装）。
- `source/stock-analysis-audit-prompt.md`：母版完整规范（阅读、改规则、diff；勿整段作 system prompt）。
- `chatbot/`：面向传统 Chatbot 的分阶段 user prompt。
- `manuals/`：使用手册、示例、迁移说明。

母版是规范全集；`SKILL.md` / `references/` 与 `chatbot/` 是从母版编译出的运行时子集。修改规则时建议先改 `source/`，再同步对应产物。详见 `manuals/migration-notes.md`。

## 选择哪一套

| 场景 | 使用 |
|------|------|
| 无工具 / 无联网 Chatbot | `chatbot/` |
| Cursor 或工具丰富的 Agent | `SKILL.md`（触发名 `stock-analysis-audit`） |

## 快速开始

**Chatbot**

1. 复制 `chatbot/00-system-prompt.md` 作为 system prompt。
2. 用 `chatbot/01-company-identification.md` 确认公司。
3. 用 `chatbot/02-lite-screening.md` 做默认初筛。

**Agent**

```bash
npx skills add . --skill stock-analysis-audit -y
```

或对 Agent 说：

```text
用 stock-analysis-audit 对 [公司] 做 Lite 初筛。
```

## 重要原则

- 不编造数据。
- 数据不足时停止、追问或降级。
- 不把低估值直接等同于安全边际。
- 不把公司质量直接等同于股票吸引力。
- 同时执行两类逆向：从好故事里找坏事实，也从坏叙事里找被市场误解的隐藏资产或新利润池。
- 被误解资产必须用硬证据验证：现金流-利润剪刀差、真实回购注销、segment/backlog/order 等定量火苗、行业清场效应，以及坏消息是癌症还是感冒。
- 最终结论仅用于研究辅助，不构成投资建议。
