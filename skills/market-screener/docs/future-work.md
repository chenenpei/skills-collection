# market-screener 后续工作

本文件只记录未实现、未排期或需要项目管理者后续规划的工作。当前可执行事实以 `cli/`、`spec/`、`SKILL.md` 和 ADR 当前状态为准。

## 未实现命令

- `screener alert`：基于 `landmines.yaml` 和实时价格生成到价提醒文件。当前仍使用券商提醒和人工复核，不生成 `alerts.yaml`，也不会自动下单。
- `screener schedule --year YYYY`：按 `spec/schedule.yaml` 打印年度季度运行日期。当前日期规则由 Agent 按 `schedule.yaml` 人工解析。

## 数据源与指标覆盖

- 美股银行监管指标补全：研究 SEC / 监管披露中可稳定提取的 NPL、capital adequacy、ROTCE、NIM 或等价指标，再决定是否接入漏斗。
- 保险模板量化：评估 combined ratio、solvency ratio / RBC、embedded value、loss ratio volatility、investment yield 等指标是否有稳定免费数据源；在数据源不足前保持 `quant_too_hard`。
- A 股银行 `full` viability：补强 `npl_ratio_yoy_change`、NIM、图像表 ROA 等覆盖率；覆盖率足够前继续保持 proxy viability。
- 全行业覆盖目标：长期让 `market-screener` 覆盖 `stock-analysis-audit` 的主要行业块；新增行业前必须先有可执行数据源和可解释的模板规则。

## 维护规则

- 已被代码实现、已被后续 ADR 修正、或决定不做且没有防误导价值的条目，不进入本文件。
- 一项工作完成后，从本文件删除，并在对应 ADR、spec、README 或 agent guide 中更新当前事实。
- 本文件不替代 ADR。需要解释“为什么这样做”的长期决策，仍写 ADR；本文件只保留规划队列。
