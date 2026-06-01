# Agent Skill 使用手册

本手册说明如何在 Cursor 或通用 Agent 中使用股票分析审计 Skill。

## 核心思路

Agent 和传统 Chatbot 的区别在于：Agent 可以使用工具。它不应该只复述 prompt，而应该主动完成工作流：

1. 识别公司和证券。
2. 使用工具查找财报、行情和指数数据。
3. 交叉验证关键数字。
4. 计算 FCF Yield、Earnings Yield、EV/FCF 等指标。
5. 在数据不足或身份不明时停止并追问。
6. 根据 Lite 或 Deep 模板输出结论。

## 安装

本 skill 位于 `skills-collection` 仓库：

```text
skills/stock-analysis-audit/
```

在目标项目目录安装：

```bash
npx skills add https://github.com/chenenpei/skiils-collection --skill stock-analysis-audit -y
```

已克隆仓库时：

```bash
npx skills add . --skill stock-analysis-audit -y
```

也可复制到 Cursor 个人 skill 目录（不要放到 Cursor 内置 `skills-cursor` 目录）：

```text
~/.cursor/skills/stock-analysis-audit/
```

## 推荐触发语

Lite：

```text
用 stock-analysis-audit 对 Apple 做 Lite 初筛。
```

Deep：

```text
用 stock-analysis-audit 对 NVDA 做 Deep 股票审计，重点看估值、护城河和机会成本。
```

只看某一部分：

```text
用 stock-analysis-audit 只检查 Adobe 的 FCF 质量和估值机会成本。
```

## Skill 内部文件职责

- `SKILL.md`：触发条件、默认行为、执行顺序、何时追问。
- `references/data-contract.md`：数据口径、来源、N/A、质量评分。
- `references/workflow.md`：Lite 和 Deep 的流程。
- `references/classification-rules.md`：M/N 投资类型判定规则。
- `references/output-templates.md`：Lite 和 Deep 输出模板。
- `references/tool-policy.md`：工具使用顺序、交叉验证、停止条件。

## 检查 Agent 输出质量

合格输出应满足：

- 先确认公司身份和证券。
- 每个关键数字有日期、口径和来源。
- 不把 FCF Yield、股息率、盈利收益率混为一个指标。
- 数据不足时明确降级或停止。
- 最终裁决只能从五档中选一个。
- 给出支持证据、反对证据、证伪指标和重新审计触发条件。

## 什么时候不要让 Agent 继续

- 它开始编造财务数据。
- 它没有引用来源却声称“最新数据显示”。
- 它在公司身份不确定时继续分析。
- 它只讲假设，没有计算机会成本。
- 它给出高 conviction 结论，但没有能力圈和逆向风险检查。

## 建议工作方式

Lite 可以一轮完成。Deep 建议分阶段执行：

1. 身份识别与数据计划
2. 跨周期财务审计
3. 护城河和管理层
4. 估值与机会成本
5. 逆向排雷和最终裁决

这种方式比一次性生成长报告更可靠。
