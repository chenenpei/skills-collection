# 04 Fund Portfolio Anatomy Prompt

用于 ETF / 基金 Deep 流程：审计 fund wrapper、index methodology 或 active mandate，并建立组合结构与加权估值表。

## Prompt

请基于我提供的基金数据，完成基金组合结构审计。不要给最终裁决，除非数据不足以继续。

Fund / Ticker：`[填写]`

已提供数据：

```text
[粘贴 fact sheet、holdings、index methodology、peer data 或用户整理的数据]
```

## 分析任务

1. 确认 fund wrapper：基金类型、issuer、AUM、expense ratio、distribution yield、premium / discount、tracking difference、liquidity。
2. 确认 index methodology 或 active mandate：权重规则、再平衡频率、集中度限制、纳入 / 剔除规则。
3. 建立 holdings anatomy：至少 top 10；如数据足够，扩展到 top 20。
4. 计算或引用 portfolio weighted trailing P/E。
5. 计算或引用 portfolio weighted forward P/E。
6. 标注每个估值数据来源：issuer-disclosed / third-party disclosed / calculated。
7. 说明缺失数据如何影响后续增长归因和裁决。

## 输出模板

```markdown
## Wrapper Audit

| Metric | Value | Basis | Date | Source |
|---|---:|---|---|---|

## Index Methodology / Active Mandate

- Weighting scheme：
- Rebalance / reconstitution：
- Concentration limits：
- Inclusion / exclusion rules：
- Active mandate notes：

## Holdings Anatomy

| Holding | Weight | Sector / role | Trailing P/E | Forward P/E | NTM growth | Source |
|---|---:|---|---:|---:|---:|---|

## Weighted Valuation Calculation

- Weighted trailing P/E：
- Weighted forward P/E：
- Source type：
- Calculation notes：
- Missing data impact：
```

## 禁止

- 不要把基金当公司填收入、利润、FCF、ROE 或 ROIC。
- 不要用最大持仓估值替代组合加权估值。
- 不要在 forward P/E 来源不明时把它写成事实。
