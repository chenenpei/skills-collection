# market-screener 后续工作

本文件只记录未实现、未排期或需要项目管理者后续规划的工作。当前可执行事实以 `cli/`、`spec/`、`SKILL.md`、`docs/agent-guide.md` 和 ADR 当前状态为准。

已决定不做且没有防误导价值的命令不进入本文件。

## 数据源与指标覆盖

- 美股银行监管指标补全：研究 SEC / 监管披露中可稳定提取的 NPL、capital adequacy、ROTCE、NIM 或等价指标，再决定是否接入漏斗。
- 保险模板量化：评估 combined ratio、solvency ratio / RBC、embedded value、loss ratio volatility、investment yield 等指标是否有稳定免费数据源；在数据源不足前保持 `quant_too_hard`。
- A 股银行 `full` viability：补强 `npl_ratio_yoy_change`、NIM、图像表 ROA 等覆盖率；覆盖率足够前继续保持 proxy viability。
- 全行业覆盖目标：长期让 `market-screener` 覆盖 `stock-analysis-audit` 的主要行业块；新增行业前必须先有可执行数据源和可解释的模板规则。
- 行业专属剔除规则：未来可以实现 `sector_kill_gates`，但需要先补齐可稳定获取的行业数据、明确各行业触发条件，并用历史样本验证误杀率。当前 CLI 只执行全局剔除规则和模板阈值筛选，不把模板中的行业专属剔除规则作为机器规则。

### 行业专属剔除规则候选

这些规则只作为未来实现候选，不属于当前机器规范。

| 行业 | 规则 | 条件 | 备注 |
| --- | --- | --- | --- |
| 消费 | `channel_stuffing` | `inventory_yoy_minus_revenue_yoy_gt_0.15_for_2_years` | 库存增长持续高于收入增长。 |
| 消费 | `margin_collapse` | `gross_margin_yoy_decline_gt_0.08` | 毛利率明显下滑。 |
| 消费 | `same_store_collapse` | `same_store_sales_yoy_lt_neg_0.05_for_2_periods` | 仅在同店销售数据可得时使用。 |
| 周期 | `peak_cycle_trap` | `trailing_pe_lt_8_and_operating_margin_gt_p75_10y` | 低市盈率叠加高位利润率，疑似周期顶部。 |
| 周期 | `peak_margin_trap` | `operating_margin_gt_p90_10y_and_revenue_yoy_lt_0` | 利润率处于历史高位但收入转弱。 |
| 周期 | `balance_sheet_stress` | `net_debt_to_ebitda_gt_4.0` | 杠杆压力过高。 |
| 周期 | `capacity_peak` | `capacity_utilization_gt_0.90` | 仅在产能利用率数据可得时使用。 |
| 医疗 | `margin_collapse` | `gross_margin_yoy_decline_gt_0.10` | 毛利率明显下滑。 |
| 医疗 | `revenue_collapse` | `revenue_3y_cagr_lt_neg_0.10` | 三年收入复合增速显著为负。 |
| 制造 | `capex_burn` | `capex_to_revenue_gt_0.25_and_fcf_negative_3y` | 高资本开支叠加连续自由现金流为负。 |
| 制造 | `customer_concentration` | `top_customer_concentration_gt_0.50` | 仅在客户集中度数据可得时使用。 |
| 制造 | `inventory_bloat` | `inventory_yoy_minus_revenue_yoy_gt_0.20_for_2_years` | 库存增长持续显著高于收入增长。 |
| 科技与软件 | `revenue_collapse` | `revenue_yoy_lt_neg_0.10_for_2_quarters` | 收入连续两个季度明显下滑。 |
| 科技与软件 | `gross_margin_erosion` | `gross_margin_yoy_decline_gt_0.10` | 毛利率明显恶化。 |
| 科技与软件 | `extreme_dilution` | `share_dilution_3y_gt_0.25` | 三年股本稀释过高。 |
| 金融 | `npl_spike` | `npl_ratio_yoy_change_gt_0.02` | 不良率同比上升过快。 |
| 金融 | `capital_breach` | `capital_adequacy_lt_0.08` | 资本充足率低于候选阈值。 |
| 金融 | `roe_collapsing` | `roe_ttm_lt_0.05_and_roe_3y_avg_lt_0.08` | 当期和三年平均 ROE 均偏弱。 |

## 维护规则

- 已被代码实现、已被后续 ADR 修正、或决定不做且没有防误导价值的条目，不进入本文件。
- 一项工作完成后，从本文件删除，并在对应 ADR、spec、README 或 agent guide 中更新当前事实。
- 本文件不替代 ADR。需要解释“为什么这样做”的长期决策，仍写 ADR；本文件只保留规划队列。
