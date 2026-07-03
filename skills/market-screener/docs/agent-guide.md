# Agent 使用指南 — Market Screener

本指南面向执行 **定量漏斗 -> 输出检查 -> 结果总结** 的 Agent。机器规则在 `spec/`；领域词汇在 `CONTEXT.md`。单票定性审计是可选下游，不是本 skill 的默认步骤。

`screener` CLI 位于 `cli/`，不会自动进入 `$PATH`。在 `cli/` 目录通过 `npm run dev -- <command>` 运行。

---

## 1. 运行前提

执行 CLI 前先确认以下输入：

- `quarter` 明确，例如 `2026-Q2`
- `markets` 明确，例如 `CN`、`US` 或 `CN,US`
- `adapter`，例如 `fixture` 或 `live`
- `output` 输出目录
- `spec` 规则目录，通常是 `../spec`

---

## 2. 定量筛选命令序列

### 2.1 运行定量漏斗

在 skill 目录下的 `cli/` 中执行（首次需 `npm install`）：

```bash
cd cli
npm run dev -- run \
  --markets CN,US \
  --quarter 2026-Q2 \
  --output ./funnel-output/ \
  --spec ../spec \
  --adapter fixture
```

- **`--adapter fixture`** — 离线测试数据，适合本地验证
- **`--adapter live`** — 使用东方财富、Yahoo、SEC 等在线数据源加载市场样本，先按状态、市值、上市年限做报价预筛，再对存活标的补全年报、行业和部分银行监管指标，需联网

**CN 在线预检：** `--adapter live` 默认先运行 CN 报价和数据中心预检；若锚点或报价完整性失败，会在补全前失败。`--skip-preflight` 仅用于排查数据源故障。

**降级在线跑批：** `--allow-degraded` 仅用于排查数据源故障。带有 `quote_degraded:*` audit hints 或低置信度报价指标的输出，不作为正式跑批结果。

**补全缓存：** `cli/data/cache/{quarter}/{CN|US}/{ticker}.json`。同季度重复跑会读缓存，显著缩短 CN 全市场耗时。空年报响应不写入缓存。

**CN 增量补全：** 只有源季度缓存已经包含最新指标来源和报价 schema 修正时，才可用 `--inherit-cache-from` 开启新季度。它不能替代当季报价刷新；正式确认前需检查 `quoteHistory` 包含目标季度。

**在线参数：**

- `--enrich-concurrency <n>` — 并行补全 ticker 数，默认 4
- `--skip-cache` — 忽略磁盘缓存，不读不写

**CN bank debug:** `npm run dev -- bank-indicators 600919 --year 2025` 会运行同一套披露发现和 PDF scrape，输出 NPL、拨备覆盖率、资本充足率、NIM、ROA 等银行监管指标；该命令不需要 `--spec`。

产出（每市场）：

- `CN/candidates.yaml` — 选入队列，最多 20
- `CN/deferred.yaml` — 通过漏斗但未选入队列，最多 20
- `CN/excluded.yaml` — 对已补全样本应用共享剔除规则后的排除结果
- `CN/prefilter-excluded.yaml` — 仅在线运行：报价预筛跳过、未补全的标的
- `CN/routing-diagnostics.yaml` — 路由方式、模板分布和 fallback 诊断
- `CN/funnel-diagnostics.yaml` — 漏斗阶段统计、剔除原因和模板通过率
- `US/` 同上

禁止 Agent 自行调用东方财富、Yahoo、SEC API 重实现漏斗逻辑；数据拉取由 CLI adapter 负责。

### 2.2 可选 CLI 后续命令

**解释单个标的：**

```bash
cd cli
npm run dev -- explain 600519 \
  --market CN \
  --fixture test/fixtures/universe-cn.json \
  --spec ../spec
```

**统计漏斗剔除原因：**

```bash
cd cli
npm run dev -- filter-breakdown \
  --output ./funnel-output \
  --quarter 2026-Q2 \
  --markets CN
```

**生成价格观察结果：**

```bash
cd cli
npm run dev -- landmine \
  --from ./funnel-output/2026-Q2/audit-summary.yaml \
  --output ./funnel-output/2026-Q2/landmines.yaml \
  --quarter 2026-Q2
```

公式见 `spec/landmine-pricing.yaml`：

- **Quality track:** `landmine_price = fair_value_bull_mean * 0.70`
- **Mispricing track:** `landmine_price = min(current_price * 0.85, fair_value_bull_mean * 0.70)`
- **金融 / 周期:** 见同文件 sector overrides

---

## 3. 可选下游

如果用户要求对候选标的做单票定性审计，可以把 `candidates.yaml` 中的记录交给 `stock-analysis-audit`。传递时附带 `passed_track`、`routed_templates`、`routing_method`、`routing_confidence`、`metric_snapshot` 和 `audit_hints`。该步骤由使用者决定是否执行，不影响 `market-screener` 的定量筛选完成状态。

---

## 4. 质量检查（Agent 自检）

运行结束应检查：

- [ ] `candidates.yaml` / `deferred.yaml` / `excluded.yaml`（按市场）
- [ ] 在线运行且有报价预筛跳过时：`prefilter-excluded.yaml`
- [ ] `routing-diagnostics.yaml` / `funnel-diagnostics.yaml`
- [ ] `quarter`、`markets`、`adapter`、`output` 和 `spec` 已记录
- [ ] 如用户要求，已运行 `explain`、`filter-breakdown`、`bank-indicators` 或 `landmine`

---

## 5. 跑批后检查（CN 在线数据）

1. 对本季度运行漏斗和 `filter-breakdown`。
2. 检查 `funnel-diagnostics.yaml` -> `enrichment.cache_missing_count`。如果超过已补全存活标的的 3%，先运行缓存修复脚本，再重跑漏斗或记录剩余标的。
3. 医疗器械 L2 只路由到 `manufacturing`；强标的可能进入 `deferred` 而不是前 20。
4. Healthcare 通过率约 15-20% 时，在 diagnostics 中持续观察；未完成假阳性复核前，不要收紧模板。
5. 如果标的因全市场基准下 `inventory_turnover_vs_industry` 不达标而不进入 candidates，这是 `sector_filtered`，不是 YAML 缺失。
6. 半导体 also_run 到 cyclicals 的规则保留；`mid_cycle_*` 和报价覆盖接入后，仍需在 `funnel-diagnostics.yaml` 中观察。
7. 如果存在通过者，candidates 应覆盖多个 `winning_template`；若单一行业异常集中，检查 funnel-diagnostics 中的 `by_pool_selected`。

---

## 6. Spec 索引

| 文件 | 内容 |
|------|------|
| `docs/agent-output.md` | Agent 输出风格和结果转述指南 |
| `spec/README.md` | CLI 机器规则目录说明 |
| `spec/index.yaml` | CLI 规则清单 |
| `spec/exclusion-rules.yaml` | 共享剔除规则 |
| `spec/routing-cn.yaml` | A 股申万行业到模板的路由规则 |
| `spec/routing-us.yaml` | 美股 GICS / industry proxy 到模板的路由规则 |
| `spec/metric-policy.yaml` | 指标阈值、衍生指标和补全策略 |
| `spec/selection-policy.yaml` | 候选上限、延后名单和席位分配规则 |
| `spec/templates/*.yaml` | 行业漏斗规则 |
| `spec/landmine-pricing.yaml` | 价格观察计算公式 |
