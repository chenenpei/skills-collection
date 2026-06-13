# Agent 使用指南

`stock-analysis-audit` 面向有工具能力的 Agent。Agent 应主动识别证券、收集数据、交叉验证、计算指标、执行 workflow，并在数据不足或身份不清时停止追问。

## 推荐触发语

```text
用 stock-analysis-audit 对 Microsoft 做 Lite 初筛，报告用中文。
```

```text
用 stock-analysis-audit 对 NVDA 做 Deep 股票审计，重点看估值、护城河和机会成本。
```

```text
用 stock-analysis-audit 对 SMH 做 Lite ETF 审计，重点看估值、增长归因和同类基金比较。
```

```text
用 stock-analysis-audit 对 SOXX 和 SMH 做基金工具对比。
```

## 质量检查

个股合格输出应满足：

- 先确认公司身份、Ticker、上市地、交易货币和 share-class 风险
- 每个关键数字有日期、期间、货币、来源和口径
- 不把低估值直接当作安全边际
- 不把好公司直接当作好股票
- 在积极裁决前完成利润池摧毁检查
- 在 Reject / Value Trap 之前完成被误解资产检查
- Deep 报告包含 M/N 投资类型判定
- 最终包含 `Structured Summary`

ETF / 基金合格输出应满足：

- 先确认 fund name、ticker、issuer、tracked index 或 mandate、expense ratio 和 peer fund
- 不把基金当经营公司填写收入、净利润、OCF、Capex、FCF、ROE 或 ROIC
- 明确 wrapper、portfolio exposure、underlying holdings 三层
- forward P/E 标注为 issuer-disclosed、third-party disclosed、calculated 或 N/A
- 同时完成 Bull-side Misunderstanding 与 Bear-side Hidden Re-pricing
- 至少比较一个 peer fund 和一个 broad benchmark
- 最终裁决描述基金作为工具的角色，而非底层行业质量
- 最终包含 `Structured Summary`

## 概念速查

完整定义见 `CONTEXT.md`。

| 层级 | 示例 slug | 中文 |
|------|-----------|------|
| Business archetype | `archetype_toll_road` | 收费公路型 |
| Investment classification | `classification_cigar_butt` | 烟蒂型低估资产 |
| Company verdict | `verdict_watchlist` | 观察名单 |
| Fund verdict | `verdict_satellite_hold` | Satellite Hold |
| Lifecycle | `lifecycle_evidence_established` | 证据确立期 |

不要混淆三层：

- Business archetype 是商业模式/资产特性
- Investment classification 是 Deep 个股 M/N 分类
- Final verdict 是最终裁决

## 迁移校验清单

大改 `spec/` 时至少检查：

- Sector Adjustments 六类指标仍完整
- `classification.md` 五类 A-E 仍包含 Necessary conditions、Supporting evidence、Veto conditions
- 基金 growth attribution 公式仍存在
- 基金三层模型仍存在
- `templates-company.md` 与 `templates-fund.md` 都包含 `Structured Summary`
- `SKILL.md` lazy-load 路径仍指向新 `spec/` 文件
