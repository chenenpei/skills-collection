# Agent 使用指南 — Market Screener

本指南面向编排 **季度批量漏斗 → Deep 审计 → landmine 限价 → 到价纪律** 的 Agent。定量规则在 `spec/`；领域词汇在 `CONTEXT.md`。单票 Deep 审计见 [stock-analysis-audit](../stock-analysis-audit/) 与其 `docs/agent-guide.md`。

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

Phase 2 占位：`screener schedule --year YYYY` 打印解析日期。

---

## 2. 季度运行命令序列（Phase 1）

### Step 1 — 定量漏斗

在 skill 目录下的 `cli/` 中执行（首次需 `npm install`）：

```bash
cd cli
npm run dev -- run \
  --markets CN,US \
  --quarter 2026-Q2 \
  --output ./funnel-output/2026-Q2/ \
  --spec ../spec \
  --adapter fixture
```

- **`--adapter fixture`** — 离线 fixture，适合本地验证
- **`--adapter live`** — CN 东方财富 + US Yahoo 报价宇宙，再经 **M3 enrichment** 拉取逐票年报与行业代理（CN：`eastmoney_datacenter_annual` + `orginfo`；US：`sec_companyfacts` + `sec_submissions`），需联网

**Live enrichment 缓存：** `cli/data/cache/{quarter}/{CN|US}/{ticker}.json`。同季度重复跑会读缓存，显著缩短 CN 全市场耗时（首次约 30–60 分钟，4000+ 请求）。

**Live run 可选参数：**

- `--enrich-concurrency <n>` — 并行 enrichment 请求数（默认 8）
- `--skip-cache` — 忽略磁盘缓存，强制重新拉取

产出（每市场）：

- `CN/candidates.yaml` — rank 1–25（软顶，Package M）
- `CN/deferred.yaml` — 通过漏斗但 rank > 25
- `CN/excluded.yaml` — Kill Gate 排除
- `US/` 同上

**禁止** Agent 自行调用东方财富/Yahoo API 重实现漏斗逻辑；数据拉取由 CLI adapter 负责。

### Step 2 — Deep 审计（stock-analysis-audit）

- **范围：** 每市场 `candidates.yaml` 的 **rank 1–20**（默认 `--deep-limit 20`）
- **全量 Deep：** 仅当用户明确要求 `--deep-all`
- **执行：** **parallel_by_market** — CN 与 US 各开一个 session 并行
- **报告路径：** `funnel-output/{quarter}/audit/{market}/{ticker}.md`

对每只 candidate，调用 **stock-analysis-audit Deep**，并在 prompt 中附加：

```markdown
对 {ticker}（{market}）执行 Deep 审计。

漏斗上下文（需交叉验证，非最终证据）：
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_confidence: {high|ambiguous_union}
- metric_snapshot: ...
- audit_hints: ...

若 metric_snapshot 与 Deep 数据冲突，以 Deep 为准并说明。
```

rank 21–25 写入 `audit-summary.yaml` 的 `deep_deferred`，本季不 Deep。

### Step 3 — 定性筛选 & audit-summary

阅读 Deep 报告，产出 `funnel-output/{quarter}/audit-summary.yaml`：

- `shortlist_for_landmine` — 进入等待期并设置 landmine 限价
- `rejected_after_deep` — Deep 否决
- `deep_deferred` — 因 limit 未 Deep

Deep 合格输出标准见 stock-analysis-audit `docs/agent-guide.md`。

---

## 3. 等待期 — landmine 限价（Phase 2）

```bash
cd cli
npm run dev -- landmine \
  --from ../funnel-output/2026-Q2/audit-summary.yaml \
  --output ../funnel-output/2026-Q2/landmines.yaml \
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

Phase 2 占位：`screener alert --from landmines.yaml` → `alerts.yaml`（自动比价，仍不自动买）。

---

## 5. 与 stock-analysis-audit 的分工

| 阶段 | market-screener | stock-analysis-audit |
|------|-----------------|---------------------|
| 全市场定量 | `cli/` → `npm run dev -- run` + `spec/templates/` | 不参与 |
| 单票 Deep | 编排 + audit_hints | Deep workflow |
| 到价后复核 | trigger-discipline | 可选再 Deep |

---

## 6. 质量检查（Agent 自检）

季度运行结束应存在：

- [ ] `candidates.yaml` / `deferred.yaml` / `excluded.yaml`（CN、US）
- [ ] `audit/{market}/*.md`（Deep，每市场 ≤20）
- [ ] `audit-summary.yaml`
- [ ] `landmines.yaml`（若有 shortlist）
- [ ] 未在 anchor 前跑漏斗
- [ ] 未自动下单

---

## 7. Phase 2 占位（勿在 MVP 承诺）

- `screener schedule` — 解析季度运行日期
- `screener alert` — landmine 触达告警
- Cursor Automation — 定时提醒（非自动交易）

---

## 8. Spec 索引

| 文件 | 内容 |
|------|------|
| `spec/index.yaml` | Manifest |
| `spec/schedule.yaml` | 何时跑 |
| `spec/kill-gates.yaml` | 共享 Kill Gate |
| `spec/routing-map.yaml` | 行业路由 |
| `spec/conventions.yaml` | 阈值语法 |
| `spec/templates/*.yaml` | Sector 漏斗（Package M） |
| `spec/landmine-rules.yaml` | landmine 限价公式 |
| `spec/trigger-discipline.yaml` | 场景 A/B |
| `spec/output-schema.yaml` | YAML 契约 |
