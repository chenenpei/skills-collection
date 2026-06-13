# 使用示例

## 个股 Lite

```text
用 stock-analysis-audit 对 Microsoft 做 Lite 初筛，报告用中文。
```

合格输出应包含：

- 公司身份确认
- 数据质量与缺失项
- 商业模式和 lifecycle
- 财务快照
- 估值与机会成本
- 利润池摧毁检查
- 市场可能误解什么
- 初步裁决
- `Structured Summary`

示例摘要：

```markdown
## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_medium | Medium |
| business_archetype | archetype_toll_road | 收费公路型 |
| final_verdict | verdict_watchlist | 观察名单 |
```

## 个股 Deep

```text
用 stock-analysis-audit 对 Adobe 做 Deep 股票审计，重点看 FCF 质量、SBC、估值和 AI 风险。
```

Deep 输出除 Lite 内容外，还应包含：

- 5-10 年跨周期财务表
- 行业适配指标
- 隐藏上行证据清单
- M/N 投资类型判定
- 护城河和管理层审计
- Red team and inversion
- Action framework
- Falsification

## ETF / 基金 Lite

```text
用 stock-analysis-audit 对 SMH 做 Lite ETF 审计，重点看估值、增长归因和同类基金比较。
```

合格输出应包含：

- fund wrapper
- portfolio exposure
- top holdings and growth attribution
- peer fund comparison
- bull-side misunderstanding
- bear-side hidden re-pricing
- exposure-level profit-pool destruction
- fund-specific risks
- `Structured Summary`

示例摘要：

```markdown
## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_medium | Medium |
| final_verdict | verdict_satellite_hold | Satellite Hold |
| portfolio_role | satellite | 卫星 |
```

## 基金对比

```text
用 stock-analysis-audit 对 SOXX 和 SMH 做基金工具对比，重点看费用、集中度、weighted forward P/E 和组合角色。
```

合格输出应明确：

- 两只基金追踪的指数是否不同
- 费用、AUM、流动性、top 10 权重
- weighted trailing / forward P/E 的来源
- 哪只更适合作为 core、satellite、tactical 或 avoid
