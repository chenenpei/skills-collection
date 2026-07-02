# Agent 使用指南 — Market Screener

本指南面向编排 **季度批量漏斗 → Deep 审计 → landmine 限价 → 到价纪律** 的 Agent。定量规则在 `spec/`；领域词汇在 `CONTEXT.md`。单票 Deep 审计见 [stock-analysis-audit](../../stock-analysis-audit/) 与其 `docs/agent-guide.md`。

**CLI 状态：** `screener` CLI 已在 `cli/` 落地（validate / run / explain / landmine）；**M3** 已完成 live adapter 全量 enrichment 管线（quote universe → 逐票财务/行业补全 → 漏斗）。Agent **必须优先调用 CLI** 执行定量漏斗与 landmine；`screener` 不在 `$PATH`，需在 `cli/` 目录通过 `npm run dev -- <command>` 运行（见 §2）。仅当 CLI 安装或执行真实失败时，才回退到 `spec/` 手工编排并标注 `N/A`。

---

## 1. 何时跑（季度调度）

**原则：** CN 与 US **同一天**跑 `--markets CN,US`，但必须在 **两市场该期披露 substantially complete** 之后；以 **较晚的 anchor** 为准，再取 **该日之后的第一个周末**。

详见 `spec/schedule.yaml`（status: confirmed）。

| 周期 | CN anchor | US anchor（季末 +45 天） | 通常更晚 | 大约执行窗口 |
|------|-----------|-------------------------|----------|--------------|
| Q1 + A股年报/一季报 | 4/30 | ~5/15 | US | 5 月中下旬第一个周末 |
| Q2 + A股半年报 | 8/31 | ~8/15 | CN | 9 月初第一个周末 |
| Q3 + A股三季报 | 10/31 | ~11/15 | US | 11 月中下旬第一个周末 |

- **每年 3 次季度定时运行**；美股 Q4/10-K（~2 月中旬）不单独跑批， freshness 并进下一轮 Q1 窗口。
- **禁止**在 `later_anchor` 之前跑漏斗；若用户要求提前跑，警告数据未齐并说明 `data_confidence: low` 风险。

未实现命令和后续规划集中记录在 [future-work.md](./future-work.md)。当前不要承诺自动日期解析命令可执行。

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

**CN live preflight:** `--adapter live` runs CN quote/datacenter preflight by default and fails before enrichment when anchors or quote integrity fail. Do not use `--skip-preflight` for quarterly sign-off; it is only for diagnosing provider outages.

**Degraded live runs:** `--allow-degraded` is only for diagnosing provider outages. Output with `quote_degraded:*` audit hints or low-confidence quote metrics is not quarterly sign-off quality. Hard CN quote integrity failures must not be bypassed by degraded mode.

**Live enrichment 缓存：** `cli/data/cache/{quarter}/{CN|US}/{ticker}.json`。同季度重复跑会读缓存，显著缩短 CN 全市场耗时（首次约 30–60 分钟，4000+ 请求）。空年报响应**不写入**缓存。CN 银行缓存会包含 `bankScrape`，其披露 PDF 在运行时按 cninfo → 交易所 → Sina 优先级发现，不依赖静态 URL 表。

**CN incremental enrich:** `--inherit-cache-from` is acceptable for opening a new quarter only when the source quarter cache was produced after the latest metric-source and quote schema fixes. It never replaces current quote refresh; verify `quoteHistory` contains the target quarter before sign-off.

### CN valuation cross-check (mandatory for Deep audit)

Before using cache `quoteHistory.pe` / `pb` in valuation sections:

1. Recompute TTM PE: `marketCap / TTM_net_income` OR `price / TTM_EPS`
2. If `|cache_pe - price| / price < 1%`, treat cache PE as **invalid** (price mislabeled as PE)
3. If `cache_pb > 15` for non-financials and PE missing, treat cache PB as **likely mislabeled dynamic PE**
4. Prefer TTM recomputation over cache quote fields for final verdict

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
- `CN/funnel-diagnostics.yaml` — 全漏斗回放统计（prefilter/kill 原因占比、sector 通过率）；可用 `scripts/funnel-replay.ts` 打印可读报告
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

公式见 `spec/landmine-rules.yaml`：

- **Quality track：** `landmine_price = fair_value_bull_mean × 0.70`
- **Mispricing track：** `landmine_price = min(current_price × 0.85, fair_value_bull_mean × 0.70)`
- **金融 / 周期：** 见同文件 sector overrides

**执行：** 用户根据 `landmines.yaml` 在券商 App **人工**挂 GTC 限价单或到价提醒。CLI **never** 下单。

---

## 4. 到价纪律（Phase 3）

MVP：券商提醒 + 用户/Agent 对照 `spec/trigger-discipline.yaml`。

| 场景 | slug | 纪律 |
|------|------|------|
| A — 个股独立下跌 | `trigger_isolated_drop` | **禁止立刻买**；24h 定性复核；宁可等一季财报 |
| B — 宏观恐慌 | `trigger_macro_panic` | 24h 确认后 **40–50% 首批仓位**；剩余仓位等下一财报季 |
| 不确定 | `trigger_ambiguous` | **默认按场景 A** |

`screener alert` 尚未实现。当前仍由券商提醒和人工复核处理，后续规划见 [future-work.md](./future-work.md)。

---

## 5. 与 stock-analysis-audit 的分工

| 阶段 | market-screener | stock-analysis-audit |
|------|-----------------|---------------------|
| 全市场定量 | `cli/` → `npm run dev -- run` + `spec/templates/` | 不参与 |
| 单票 Deep | 编排 + audit_hints | Deep workflow |
| 单票 Deferred Lite | 编排 + deferred 上下文 | Lite workflow |
| 到价后复核 | trigger-discipline | 可选再 Deep |

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
- [ ] 未在 anchor 前跑漏斗
- [ ] 未自动下单

---

## Post-run quarterly gate (CN live)

1. Run funnel + `filter-breakdown` for the quarter.
2. Check `funnel-diagnostics.yaml` → `enrichment.cache_missing_count`. If > 3% of enriched survivors, run the cache repair script, then re-run funnel or document residual tickers.
3. **Medical devices (医疗器械):** L2 routes to `manufacturing` only; strong names may appear in `deferred`, not top 20 — expected after P0 healthcare fix.
4. **Healthcare pass rate ~15–20%:** monitor in diagnostics; do not tighten template without Deep false-positive review.
5. **688617 class:** absent from candidates when `inventory_turnover_vs_industry` fails under full-universe benchmarks — sector_filtered, not YAML omission bug.
6. **Cyclicals also_run on 半导体:** retained; pass rate should improve now that `mid_cycle_*` and quote overlays ship — still monitor in `funnel-diagnostics.yaml`.
7. **Seat allocation:** candidates span multiple `winning_template` values when passers exist; check `by_pool_selected` in funnel-diagnostics if one sector dominates unexpectedly.

---

## 7. 未实现命令（勿承诺可执行）

未实现命令和后续规划集中记录在 [future-work.md](./future-work.md)。当前不要承诺自动到价提醒或自动日期解析命令可执行。

---

## 8. Spec 索引

| 文件 | 内容 |
|------|------|
| `spec/index.yaml` | Manifest |
| `spec/schedule.yaml` | 何时跑 |
| `spec/kill-gates.yaml` | 共享 Kill Gate |
| `spec/routing-map.yaml` | GICS / keyword fallback → sector templates |
| `spec/cn-industry-map.yaml` | A-share Shenwan L1/L2 → sector templates（CN 主路径） |
| `spec/conventions.yaml` | 阈值语法、`routing_method` |
| `spec/templates/*.yaml` | Sector 漏斗（Package M） |
| `spec/landmine-rules.yaml` | landmine 限价公式 |
| `spec/trigger-discipline.yaml` | 场景 A/B |
| `spec/output-schema.yaml` | YAML 契约 |
