# Market Screener 结果转述指南

本文件约束 Agent 如何转述 `screener run`、Deep/Lite 审计、`audit-summary.yaml` 和 `landmines.yaml` 的结果。它不是 CLI 规则；CLI 的实际写入逻辑以源码和相关命令实现为准。

## 输出原则

- 先说明运行输入：`quarter`、`markets`、`adapter`、输出目录、数据时间或缓存来源。
- 区分 CLI 输出、Deep/Lite 审计判断和 Agent 解释。
- 不补造 CLI 输出文件没有的字段。
- 不把 Lite 结果直接写成 landmine 候选，除非用户同季追加 Deep。
- 如果数据缺失、adapter 降级、缓存继承或 `data_confidence` 较低，必须明确说明。

## 推荐回答结构

1. 运行摘要：说明本次读取或生成了哪些市场、季度和输出文件。
2. 候选概览：按市场列出候选数量、deferred 数量、主要通过模板和明显异常。
3. Deep / Lite 进展：说明 Deep 报告、Lite 报告和 `audit-summary.yaml` 的状态。
4. Landmine 状态：如果存在 `landmines.yaml`，说明它包含价格观察计算结果。
5. 风险和缺口：列出数据质量、路由不确定、fallback、缺失字段和需要人工复核的地方。

## CLI 输出文件

| 输出文件 | 文件名 | Agent 转述方式 |
|----------|----------|----------------|
| candidates | `candidates.yaml` | 每市场 Deep 主队列，最多 20 个；不要称为“最值得买” |
| deferred | `deferred.yaml` | 通过漏斗但未进入主队列；可作为观察名单 |
| excluded | `excluded.yaml` | enrichment 后被共享 Kill Gate 排除 |
| prefilter_excluded | `prefilter-excluded.yaml` | live adapter 下 quote prefilter 跳过且未 enrichment 的标的 |
| routing_diagnostics | `routing-diagnostics.yaml` | 路由方式、模板分布和 fallback 诊断 |
| funnel_diagnostics | `funnel-diagnostics.yaml` | 漏斗阶段统计、剔除原因和模板通过率 |
| audit_summary | `audit-summary.yaml` | Deep/Lite 后的定性汇总，由 Agent 生成 |
| landmines | `landmines.yaml` | 价格观察计算结果 |

## 必须保留的字段含义

`candidates.yaml` 与 `deferred.yaml` 中的以下字段含义稳定，Agent 可以引用：

| 字段 | 含义 |
|------|------|
| `rank` | 同市场、同输出文件内排序，不是跨市场综合排名 |
| `ticker` / `market` | 标的代码与市场 |
| `company_name` | 公司名 |
| `routed_templates` | 被路由到的行业模板 |
| `routing_method` | `gics`、`cn_industry_map`、`industry_proxy` 或 `fallback` |
| `routing_confidence` | 路由置信度 |
| `passed_track` | `quality` 或 `mispricing` |
| `winning_template` | 实际赢得席位的模板 |
| `seat_source` | 席位来源 |
| `metric_snapshot` | 漏斗指标快照，必须经 Deep 交叉验证 |
| `data_confidence` | 数据置信度 |
| `audit_hints` | 传给 Deep/Lite 的提示，不是最终结论 |

## `audit-summary.yaml`

Agent 生成 `audit-summary.yaml` 时使用以下顶层键：

```yaml
quarter: YYYY-QN
deep_limit_per_market: 20
shortlist_for_landmine: []
rejected_after_deep: []
deferred_lite_screened: []
deep_deferred: []
quarter_diff_lite: []
```

约束：

- `shortlist_for_landmine` 只接收 Deep 结论。
- `deferred_lite_screened` 记录 Lite 结果和 `promote_next_quarter`。
- `deep_deferred` 记录本季未 Lite 的 deferred 条目。
- `quarter_diff_lite` 只记录用户点名或季度差异触发的临时 Lite。

## `landmines.yaml`

Agent 转述 `landmines.yaml` 时必须包含：

- `ticker`
- `market`
- `landmine_price`
- `currency`
- `formula_slug`
- `passed_track`
- `fair_value_reference`
- `current_price`

## 禁止输出

- 不写“已挂单”。
- 不把 `candidates.yaml` 描述为买入清单。
- 不隐藏 `routing_confidence: low`、fallback 或低置信度数据。
