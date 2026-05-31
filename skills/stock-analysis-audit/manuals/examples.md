# Examples

下面是两种最小使用示例。示例只展示调用方式，不包含真实投资结论。

## 示例 1：Chatbot Lite 初筛

### 第一步：设置 system

复制：

```text
chatbot/00-system-prompt.md
```

作为 system prompt，或作为会话第一条消息。

### 第二步：识别公司

复制：

```text
chatbot/01-company-identification.md
```

把关键词替换为：

```text
Microsoft
```

期望模型输出：

```markdown
## 公司识别结果

- 识别对象：Microsoft Corporation
- Ticker：MSFT
- 主要上市地：Nasdaq
- 交易货币：USD
- 主营业务：软件、云计算、生产力工具、企业服务与游戏等
- 潜在歧义：无重大歧义
- 识别置信度：High
```

### 第三步：Lite 初筛

复制：

```text
chatbot/02-lite-screening.md
```

把公司填为：

```text
Microsoft / MSFT
```

如果模型无法联网，它应停止并要求你提供数据，而不是编造数字。

## 示例 2：Agent Skill Lite

对 Cursor 或通用 Agent 说：

```text
用 stock-analysis-audit 对 Microsoft 做 Lite 初筛。
```

期望 Agent：

1. 读取 skill。
2. 识别 Microsoft / MSFT / Nasdaq / USD。
3. 使用工具查找财务、估值和指数机会成本数据。
4. 输出 Lite 模板。
5. 如果数据不足，标注 `N/A` 并降级结论。

## 示例 3：Agent Skill Deep

对 Agent 说：

```text
用 stock-analysis-audit 对 Adobe 做 Deep 股票审计，重点看 FCF 质量、SBC、估值和 AI 风险。
```

期望 Agent 分阶段完成：

1. 公司识别和数据质量说明。
2. 5-10 年财务表。
3. SaaS/软件行业指标。
4. 投资类型判定。
5. 护城河、管理层和能力圈。
6. 估值与机会成本。
7. 逆向排雷与最终裁决。

如果一次输出过长，可以要求：

```text
先只完成 Deep 的前两步：公司识别和跨周期财务表。
```

## 示例 4：无联网模型的数据补充

如果 Chatbot 无法联网，使用：

```text
chatbot/03-data-intake.md
```

模型应返回最小数据需求。你可以粘贴类似：

```markdown
| 年份 | 收入 | 净利润 | 经营现金流 | Capex | FCF | ROE/ROIC | 稀释股数 | 净现金/净债务 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2020 |  |  |  |  |  |  |  |  |
| 2021 |  |  |  |  |  |  |  |  |
| 2022 |  |  |  |  |  |  |  |  |
| 2023 |  |  |  |  |  |  |  |  |
| 2024 |  |  |  |  |  |  |  |  |
```
