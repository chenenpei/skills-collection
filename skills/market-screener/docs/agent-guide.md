# Agent 使用指南 — Market Screener

本指南面向编排 **批量漏斗 → Deep 审计 → landmine 限价 → 结果总结** 的 Agent。定量规则在 `spec/`；领域词汇在 `CONTEXT.md`。单票 Deep 审计见 [stock-analysis-audit](../../stock-analysis-audit/) 与其 `docs/agent-guide.md`。

**CLI 状态：** `screener` CLI 已在 `cli/` 落地（validate / run / explain / landmine）；**M3** 已完成 live adapter 全量 enrichment 管线（quote universe → 逐票财务/行业补全 → 漏斗）。Agent **必须优先调用 CLI** 执行定量漏斗与 landmine；`screener` 不在 `$PATH`，需在 `cli/` 目录通过 `npm run dev -- <command>` 运行（见 §2）。仅当 CLI 安装或执行真实失败时，才回退到 `spec/` 手工编排并标注 `N/A`。

---

## 1. 运行前提

执行 CLI 前先确认以下输入：

- `quarter` 明确，例如 `2026-Q2`
- `markets` 明确，例如 `CN`、`US` 或 `CN,US`
- `adapter`，例如 `fixture` 或 `live`
- `output` 输出目录
- `spec` 规则目录，通常是 `../spec`

---

## 2. 季度运行命令序列（Phase 1）

### Step 1 — 定量漏斗

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

- **`--adapter fixture`** — 离线 fixture，适合本地验证
- **`--adapter live`** — CN 东方财富 + US Yahoo 报价宇宙 → **quote prefilter**（status/市值/上市年限，未 enrichment 的写入 `prefilter-excluded.yaml`）→ **M3 enrichment** 拉取逐票年报与行业代理（CN：`eastmoney_datacenter_annual` + `orginfo`；CN 银行额外运行 Sina/cninfo disclosure scrape；US：`sec_companyfacts` + `sec_submissions`），需联网

**CN live 预检：** `--adapter live` 默认先运行 CN 报价和数据中心预检；若锚点或报价完整性失败，会在 enrichment 前失败。`--skip-preflight` 仅用于排查数据源故障，不用于正式跑批。

**降级 live 跑批：** `--allow-degraded` 仅用于排查数据源故障。带有 `quote_degraded:*` audit hints 或低置信度报价指标的输出，不作为正式跑批结果。CN 报价完整性硬失败不能用降级模式绕过。

**Live enrichment 缓存：** `cli/data/cache/{quarter}/{CN|US}/{ticker}.json`。同季度重复跑会读缓存，显著缩短 CN 全市场耗时（首次约 30–60 分钟，4000+ 请求）。空年报响应**不写入**缓存。CN 银行缓存会包含 `bankScrape`，其披露 PDF 在运行时按 cninfo → 交易所 → Sina 优先级发现，不依赖静态 URL 表。

**CN 增量补全：** 只有源季度缓存已经包含最新指标来源和报价 schema 修正时，才可用 `--inherit-cache-from` 开启新季度。它不能替代当季报价刷新；正式确认前需检查 `quoteHistory` 包含目标季度。

### CN 估值交叉检查（Deep 审计必做）

在估值段落使用缓存中的 `quoteHistory.pe` / `pb` 前：

1. 重新计算 TTM PE：`marketCap / TTM_net_income` 或 `price / TTM_EPS`
2. 如果 `|cache_pe - price| / price < 1%`，将缓存 PE 视为**无效**，很可能是价格被误标为 PE
3. 如果非金融标的 `cache_pb > 15` 且 PE 缺失，将缓存 PB 视为**可能被误标的动态 PE**
4. 最终结论优先使用重新计算的 TTM PE，而不是缓存报价字段

**Live run 可选参数：**

- `--enrich-concurrency <n>` — 并行 enrichment **ticker** 数（默认 **4**；每 ticker 约 2 次 HTTP；另有 East Money/SEC host 上限）
- `--skip-cache` — 忽略磁盘缓存（不读不写），强制重新拉取

**CN bank debug:** `npm run dev -- bank-indicators 600919 --year 2025` 会运行同一套 cninfo/交易所/Sina 披露发现 + PDF scrape，输出 NPL、拨备覆盖率、资本充足率、NIM、ROA 等银行监管指标；该命令不需要 `--spec`。

产出（每市场）：

- `CN/candidates.yaml` — rank 1–20（席位分配后的 Deep 队列优先级，非跨模板综合分）
- `CN/deferred.yaml` — 通过漏斗但未入选 candidates（watchlist 最多 20；额外 passer 仅记入 funnel-diagnostics）
- `CN/excluded.yaml` — 对 **已 enrichment** 宇宙应用 Kill Gate 后的排除（含 `enrichment_failure` 可选字段）
- `CN/prefilter-excluded.yaml` — **仅 live**：quote prefilter 跳过、未 enrichment 的标的（status/市值/年限）
- `CN/routing-diagnostics.yaml` — Kill Gate 存活标的的路由分布（`by_method`、`fallback_rate`）
- `CN/funnel-diagnostics.yaml` — 全漏斗回放统计（prefilter/kill 原因占比、sector 通过率）；可用 `scripts/reports/funnel-replay.ts` 打印可读报告
- **按行业层级统计剔除原因**：`npm run dev -- filter-breakdown --output ./funnel-output/ --quarter {quarter} --markets CN`（默认写入同目录 `filter-breakdown.md`；需 enrichment cache）
- `US/` 同上

**禁止** Agent 自行调用东方财富/Yahoo API 重实现漏斗逻辑；数据拉取由 CLI adapter 负责。

### Step 2 — Deep 审计（stock-analysis-audit）

- **范围：** 每市场 `candidates.yaml` 的 **rank 1–20**；这是 Agent 编排默认值，不是 `screener run` 参数
- **全量 Deep：** 仅当用户明确要求全量 Deep；这是 Agent 编排选择，不是 `screener run` 参数
- **执行：** **parallel_by_market** — CN 与 US 各开一个 session 并行
- **报告路径：** `funnel-output/{quarter}/audit/{market}/{ticker}.md`
- **禁止跨季复用正文：** 每个 `quarter` 的 candidates Deep 必须 **全量重跑**（默认 20/20）。不得将上一季 `.md` 仅改日期标签当作本季结论。仅当用户明确要求「引用上季 Deep」且 enrichment cache 与 funnel `metric_snapshot`、**当前股价/估值** 无实质变化时，才可标注 `carried_forward_from` 并跳过；**dividend_yield / bankScrape / rank 变化一律重审**。

对每只 candidate，调用 **stock-analysis-audit Deep**，并在 prompt 中附加：

```markdown
对 {ticker}（{market}）执行 Deep 审计。

漏斗上下文（需交叉验证，非最终证据）：
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_method: {gics|cn_industry_map|industry_proxy|fallback}
- routing_confidence: {high|ambiguous_union|low}
- metric_snapshot: ...
- audit_hints: ...

若 routing_method 为 fallback 或 routing_confidence 为 low，Deep 须标注 sector 分类不确定并处理 audit_hints。
若 metric_snapshot 与 Deep 数据冲突，以 Deep 为准并说明。
```

### Step 2b — Deferred Lite 轻扫（stock-analysis-audit Lite）

**目的：** 在不动 ranker / soft cap 的前提下，对「通过漏斗但未进 top-20」的标的做低成本扫雷，降低 deferred 漏审风险。

- **范围：** 每市场 `deferred.yaml` **按 rank 升序取前 N**（默认 **N=8**，见 `spec/conventions.yaml#deferred_lite_sweep`）
- **模式：** **stock-analysis-audit Lite**（非 Deep）；产出 `preliminary_verdict`，不得直接写入 landmine
- **报告路径：** `funnel-output/{quarter}/audit/{market}/{ticker}.lite.md`
- **执行：** 可与 Step 2 同市场 session 串行，或 CN/US 各开 Lite 子任务；**不得**用 Lite 替代 candidates 的 Deep
- **跳过条件：** 用户明确要求全量 Deep；或该市场 `deferred.yaml` 为空

对每只 deferred Lite 标的，调用 **stock-analysis-audit Lite**，并在 prompt 中附加：

```markdown
对 {ticker}（{market}）执行 Lite 初筛（非 Deep）。

漏斗上下文（需交叉验证，非最终证据）：
- deferred_rank: {rank in deferred.yaml}
- seat_source: deferred
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_method: {...}
- routing_confidence: {...}
- metric_snapshot: ...
- audit_hints: ...

Lite 目标：判断是否值得下季升格为 Deep 主队列或纳入用户 watchlist。
若 preliminary_verdict 为 verdict_quality_reasonable_price 或 verdict_medium_term_revaluation 且 confidence ≥ 3，在 Structured Summary 中明确标注，供 audit-summary 的 promote_next_quarter 使用。
```

**升格规则（写入 audit-summary）：**

| Lite preliminary_verdict | confidence | promote_next_quarter |
|---|---|---|
| `verdict_quality_reasonable_price` 或 `verdict_medium_term_revaluation` | ≥ 3 | **true** |
| `verdict_watchlist` | 任意 | false（继续跟踪） |
| `verdict_reject` | 任意 | false |

**可选 — 季度 diff / 用户补审（`quarter_diff_lite`）：**

- 上季 `candidates` 本季既不在 candidates 也不在 deferred（如 sector 边际未过）→ 用户点名或季度 diff 清单 → **同一 Lite 流程**，报告仍写 `{ticker}.lite.md`，记入 `audit-summary.yaml#quarter_diff_lite`，`reason` 注明来源（如 `sector_borderline_fail`、`user_requested`）
- 不扩大默认批量范围；避免对全市场 sector_filtered 做 Lite

### Step 3 — 定性筛选 & audit-summary

阅读 **Deep** 报告（及 Step 2b Lite 报告），产出 `funnel-output/{quarter}/audit-summary.yaml`：

- `shortlist_for_landmine` — **仅来自 Deep**（candidates rank 1–20）；Lite 不得直接进入 landmine，除非用户同季追加 Deep
- `rejected_after_deep` — Deep 否决
- `deferred_lite_screened` — Step 2b Lite 结果（含 `promote_next_quarter`）
- `deep_deferred` — `deferred.yaml` 中 **rank > N** 且仍 ≤ deferred cap 的条目（本季未 Lite）
- `quarter_diff_lite` — 可选 ad-hoc Lite（见 Step 2b）

Deep / Lite 合格输出标准见 stock-analysis-audit `docs/agent-guide.md` 与 `spec/workflow-company.md`。

---

## 3. 等待期 — landmine 限价（Phase 2）

```bash
cd cli
npm run dev -- landmine \
  --from ./funnel-output/2026-Q2/audit-summary.yaml \
  --output ./funnel-output/2026-Q2/landmines.yaml \
  --quarter 2026-Q2
```

公式见 `spec/landmine-pricing.yaml`：

- **Quality track：** `landmine_price = fair_value_bull_mean × 0.70`
- **Mispricing track：** `landmine_price = min(current_price × 0.85, fair_value_bull_mean × 0.70)`
- **金融 / 周期：** 见同文件 sector overrides

**输出：** `landmines.yaml` 记录价格观察计算结果。

---

## 5. 与 stock-analysis-audit 的分工

| 阶段 | market-screener | stock-analysis-audit |
|------|-----------------|---------------------|
| 全市场定量 | `cli/` → `npm run dev -- run` + `spec/templates/` | 不参与 |
| 单票 Deep | 编排 + audit_hints | Deep workflow |
| 单票 Deferred Lite | 编排 + deferred 上下文 | Lite workflow |
| 结果总结 | 整理 CLI 输出和 audit-summary | 可引用 Deep / Lite 结论 |

---

## 6. 质量检查（Agent 自检）

季度运行结束应存在：

- [ ] `candidates.yaml` / `deferred.yaml` / `excluded.yaml`（CN、US）
- [ ] live 跑批时若有 quote prefilter 跳过：`prefilter-excluded.yaml`（CN、US）
- [ ] `routing-diagnostics.yaml` / `funnel-diagnostics.yaml`（CN、US）；CN `fallback_rate` 宜 < 5%
- [ ] `audit/{market}/*.md`（Deep，每市场 ≤20）
- [ ] `audit/{market}/*.lite.md`（Deferred Lite，每市场 ≤8，除非跳过 Step 2b）
- [ ] `audit-summary.yaml`
- [ ] `landmines.yaml`（若有 shortlist）
- [ ] `quarter`、`markets`、`adapter`、`output` 和 `spec` 已记录

---

## 跑批后检查（CN live）

1. 对本季度运行漏斗和 `filter-breakdown`。
2. 检查 `funnel-diagnostics.yaml` → `enrichment.cache_missing_count`。如果超过已补全存活标的的 3%，先运行缓存修复脚本，再重跑漏斗或记录剩余标的。
3. **医疗器械：** L2 只路由到 `manufacturing`；强标的可能进入 `deferred` 而不是前 20，这是 P0 healthcare 修正后的预期结果。
4. **Healthcare 通过率约 15–20%：** 在 diagnostics 中持续观察；未完成 Deep 假阳性复核前，不要收紧模板。
5. **688617 类标的：** 如果因全市场基准下 `inventory_turnover_vs_industry` 不达标而不进入 candidates，这是 sector_filtered，不是 YAML 缺失。
6. **半导体 also_run 到 cyclicals：** 保留该规则；`mid_cycle_*` 和报价覆盖已接入后，通过率应改善，仍需在 `funnel-diagnostics.yaml` 中观察。
7. **席位分配：** 如果存在通过者，candidates 应覆盖多个 `winning_template`；若单一行业异常集中，检查 funnel-diagnostics 中的 `by_pool_selected`。

---

## 7. Spec 索引

| 文件 | 内容 |
|------|------|
| `docs/agent-output.md` | Agent 输出风格和结果转述指南 |
| `spec/README.md` | CLI 机器规则目录说明 |
| `spec/index.yaml` | CLI 规则清单 |
| `spec/kill-gates.yaml` | 共享 Kill Gate |
| `spec/routing-map.yaml` | GICS / keyword fallback → sector templates |
| `spec/cn-industry-map.yaml` | A-share Shenwan L1/L2 → sector templates（CN 主路径） |
| `spec/conventions.yaml` | 阈值语法、`routing_method` |
| `spec/templates/*.yaml` | Sector 漏斗（Package M） |
| `spec/landmine-rules.yaml` | landmine 限价公式 |
