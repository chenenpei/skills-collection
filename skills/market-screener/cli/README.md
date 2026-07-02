# market-screener CLI

基于 Commander 和 `tsx` 的 TypeScript 命令行工具。它读取 `../spec/` 中的规则，按市场输出 `candidates.yaml`、`deferred.yaml`、`excluded.yaml`，在线运行时还可能输出 `prefilter-excluded.yaml`。

## 安装依赖

```bash
cd skills/market-screener/cli
npm install
```


## 源码结构

```
src/
  cli.ts
  commands/     run | explain | validate | landmine | filter-breakdown | bank-indicators
  funnel/       run, router, kill-gates, template-evaluator, ranker, threshold, universe, diagnostics, types
  data/         registry, fixture, live, quote-prefilter, metrics, types; cn/ and us/ market adapters
  io/           artifacts (YAML output helpers)
  spec/         YAML loader and validation
  lib/          paths, cache, http, concurrency
```

## 命令

在本目录使用 `npm run dev -- <command>` 或 `npx tsx bin/screener.ts <command>` 执行。

| 命令 | 用途 |
|---------|---------|
| `validate <specDir>` | 校验规则 YAML（`npm run validate` 默认校验 `../spec`） |
| `run` | 运行定量漏斗 |
| `explain <ticker>` | 解释单个标的的路由和模板筛选过程；当前使用 fixture 输入 |
| `landmine` | 从 `audit-summary.yaml` 生成限价观察价 YAML |
| `filter-breakdown` | 根据漏斗输出统计各行业剔除原因 |
| `bank-indicators <ticker>` | 调试单个 A 股银行指定财年的披露抓取 |

### `run` 参数

| 参数 | 默认值 | 说明 |
|------|---------|-------------|
| `--markets` | 无 | `CN`、`US` 或 `CN,US` |
| `--quarter` | 无 | 例如 `2026-Q2` |
| `--output` | 无 | 输出根目录；写入 `{output}/{quarter}/{market}/` |
| `--spec` | 无 | 规则目录路径；`run` 必须显式传入 |
| `--adapter` | `fixture` | `fixture` 为离线数据，`live` 为在线数据 |
| `--enrich-concurrency` | `4` | 在线补全的并发标的数；每个标的可能发起 2 次 HTTP 请求 |
| `--skip-cache` | 关闭 | 在线运行时忽略补全缓存，不读也不写 |
| `--skip-preflight` | 关闭 | 仅 A 股在线运行使用；跳过报价和数据中心预检，只用于诊断数据源异常 |
| `--allow-degraded` | 关闭 | 仅 A 股在线运行使用；报价源不可用时允许低置信度回退，不可用于季度正式运行 |
| `--quote-fallback-quarter` | 无 | 包含 `data/cache/{quarter}/CN/cn-quote-universe.json` 的历史季度 |
| `--quote-fallback-fixtures-dir` | 无 | 设置 `--allow-degraded` 且 A 股在线报价失败时使用的 fixture 目录 |
| `--inherit-cache-from` | 无 | A 股在线运行使用；从上一季度继承稳定的年报、分红、行业补全，同时刷新当前报价 |

## 在线数据适配与逐票补全

`--adapter live` 会运行三段流程：

1. **报价股票池**：A 股东方财富列表 + 美股 Yahoo 报价，包含市值、价格和基础字段。
2. **报价预筛**：在逐票 HTTP 补全前剔除状态、市值、上市年限不合格标的，结果写入 `prefilter-excluded.yaml`。
3. **逐票补全**：对预筛后标的抓取年报财务、行业代理字段并派生指标；A 股银行额外跑披露抓取；最后合并行业中位数覆盖并写入 `SecurityRecord`。

| 市场 | 补全来源 |
|--------|-------------------|
| CN | 东方财富 datacenter 年报（`RPT_*`）+ orginfo 行业代理；A 股银行额外使用运行时年报发现（cninfo → SSE/SZSE → Sina fallback）和披露 PDF 抓取 |
| US | SEC EDGAR `companyfacts` + `submissions` 行业代理（CIK 通过 SEC ticker map 解析） |

### 调试 A 股银行披露抓取

```bash
npm run dev -- bank-indicators 600919 --year 2025
```

该命令使用与 A 股银行在线补全相同的运行时披露发现路径（cninfo → exchange → Sina），不需要 `--spec`。

逐票补全只在 `--adapter live` 下运行。fixture adapter 使用已补全 JSON，不访问网络补全。

### 季度缓存

响应会缓存在本地磁盘，加快重复运行，尤其是 A 股 4000+ 标的：

```
data/cache/{quarter}/{CN|US}/{ticker}.json
```

- 每季度首次 A 股在线运行通常需要 **30–60 分钟**；未命中缓存时每个标的至少一次请求。
- 同季度后续运行默认读取缓存，除非设置 `--skip-cache`。
- 空财务响应 **不会** 缓存，下次运行会重新抓取。
- 缓存键为 quarter + market + ticker；可删除 `data/cache/{quarter}/` 强制刷新。
- 主机并发上限：East Money datacenter 8，SEC 4；该上限叠加在 `--enrich-concurrency` 之上。

新季度可用 `--inherit-cache-from 2026-Q1` 复用上一季度稳定的 A 股年报、分红和行业补全；当前报价指标和 `quoteHistory` 仍会按目标季度刷新。如果上一季度缓存产生于指标来源或 schema 修正之前，不要继承。

### 指标来源纪律（ADR 0005）

补全层不能编造缺失指标。代理 fallback 已改为供应商字段或显式派生；缺失指标按 missing 进入模板（required → fail，`missing: skip` → skip）。见 [`../docs/adr/0005-metric-source-hygiene.md`](../docs/adr/0005-metric-source-hygiene.md)。

| 市场 | 真实来源（不做静默代理） |
|--------|----------------------------------|
| CN | 东方财富 `ROIC` 字段；`debt_to_equity` 来自 `TOTAL_LIABILITIES / TOTAL_EQUITY`；operating margin 来自 operating profit / revenue；EV/EBITDA 只使用资产负债表和 operating profit 链条 |
| US | SEC `companyfacts` 标签：基于 equity 的 ROE、`GrossProfit` / revenue - COGS、`OperatingIncomeLoss`、operating cash flow 标签；输入存在时用 NOPAT / invested capital 派生 ROIC |

**缓存失效：** 指标来源变更后，在季度签名前删除 `data/cache/{quarter}/`，或对 **CN 和 US** 都用 `--skip-cache` 重新在线补全。旧缓存可能保留修正前的代理值。命中缓存时，如果最新缓存年份缺少 `roic` 或 `totalEquity`（ADR 0005 字段），补全会自动重新抓取年报行。

## 端到端脚本

离线和在线端到端检查位于 `scripts/`，**不属于** `npm test`。

| 脚本 | 命令 | 检查内容 |
|--------|---------|----------------|
| Fixture E2E | `npm run e2e:fixture` | 使用 fixture 跑完整 CN+US 漏斗；不访问网络 |
| Live E2E | `npm run e2e:live` | 真实网络在线运行，默认 CN、`2026-Q1` |
| Live E2E (full) | `npm run e2e:live:full` | CN+US 在线运行，并断言补全结果 |
| CN quote smoke | `npx tsx scripts/probes/cn-quote-snapshot.ts` | 检查 603195/600519/600919 的东方财富 PE/PB 映射 |
| CN preflight smoke | `npx tsx scripts/probes/cn-preflight.ts` | 检查东方财富报价锚点和 datacenter 年报行探针 |
| US quote smoke | `npx tsx scripts/probes/us-yahoo-universe.ts` | 检查 Yahoo 股票池抓取耗时和前 5 个样本 |

向在线脚本传递额外参数：

```bash
npm run e2e:live -- --markets CN,US --quarter 2026-Q2
```

Live E2E 会断言补全后的候选结果（`candidates >= 1`、`metric_snapshot` 非空）、A 股股票池规模，以及空 YoY 不会误触发 `kill_revenue_decline_3y_consecutive`。该脚本需要网络；macOS 使用系统代理时需设置 `HTTPS_PROXY`（见 `scripts/e2e/live.ts`）。

### 输出文件

| 文件 | 写入时机 |
|------|------|
| `candidates.yaml` | 始终写入 |
| `deferred.yaml` | 始终写入，可能为空 |
| `excluded.yaml` | 对 **补全后** 股票池应用 kill gates |
| `prefilter-excluded.yaml` | 仅在线运行且报价预筛有剔除项时写入 |
| `routing-diagnostics.yaml` | 始终写入，记录 kill 后存活标的的路由摘要 |
| `funnel-diagnostics.yaml` | 始终写入，记录完整漏斗阶段计数和原因拆解 |

### 漏斗回放报告

运行后可打印易读的 Markdown 漏斗回放，包括预筛和 kill 原因占比、路由分布、行业通过率：

```bash
npx tsx scripts/reports/funnel-replay.ts --from-output ./funnel-output/2026-Q1/CN
npx tsx scripts/reports/funnel-replay.ts --from-output ./funnel-output/2026-Q1/CN --write report.md
```

优先读取 `funnel-diagnostics.yaml`；如果不存在，则从 `prefilter-excluded.yaml`、`excluded.yaml` 和 `routing-diagnostics.yaml` 重建。

### 按行业层级统计剔除原因

按行业分组统计退出阶段：prefilter / kill / sector filter / deferred / candidate，并输出申万 L1-L3 表和各 L1 的原因排名。**默认写入** `{output}/{quarter}/{market}/filter-breakdown.md`，与 `candidates.yaml` 同目录。

```bash
# 使用与 screener run 相同的 --output 根目录（推荐）
npm run dev -- filter-breakdown --output ./funnel-output/ --quarter 2026-Q1 --markets CN

# 或显式指定市场目录
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN

# 自定义报告路径 / stdout
npm run dev -- filter-breakdown --output ./funnel-output/ --quarter 2026-Q1 --markets CN --report ./reports/cn-filters.md
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN --stdout

# 附加 template-track 规则失败明细（required vs supporting metrics）：
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN --template-tracks
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN --template-tracks --template manufacturing --track quality --industry-l1 机械设备
```

`--template-tracks` 会基于补全缓存回放 spec 评估。过滤参数包括 `--stage`、`--template`、`--track`、`--industry-l1|l2|l3`、`--track-top`，并向 `filter-breakdown.md` 追加一个章节。

### 路由覆盖报告

从补全缓存的 `industryProxy` 离线统计路由分布：

```bash
npx tsx scripts/reports/routing-report.ts --quarter 2026-Q1 --market CN --spec ../spec
```

在线补全后、季度漏斗前使用，确认 A 股路由表覆盖率满足 `fallback_rate < 5%`。

### 修复补全缓存缺口

A 股在线运行后，如果 `funnel-diagnostics.yaml` 显示 `enrichment.cache_missing_count` 超过补全存活标的的 3%：

```bash
npx tsx scripts/maintenance/repair-enrich-cache.ts --quarter 2026-Q1 --market CN
```

对缺少缓存文件或 `annualRows` 为空的报价预筛存活标的重新运行 `enrichCnRecord`。完成后重新运行漏斗，或记录剩余标的。

`repair-enrich-cache.ts --inherit-cache-from 2026-Q1` 会先用上一季度缓存填充目标季度缺失的 A 股缓存，再回退到在线 datacenter 抓取。

完整重新补全前如需清理受污染的 `quoteHistory`，例如修复报价字段映射后：

```bash
# 先 dry-run
npx tsx scripts/maintenance/repair-enrich-cache.ts --quarter 2026-Q2 --purge-quote-history --dry-run

# 带备份清理，然后强制重新补全全部存活标的
npx tsx scripts/maintenance/repair-enrich-cache.ts --quarter 2026-Q2 --purge-quote-history --backup
npx tsx scripts/maintenance/repair-enrich-cache.ts --quarter 2026-Q2 --force-all --concurrency 4
```

## 测试

```bash
npm test
```

单元测试和集成测试覆盖数据适配、缓存、补全合并和漏斗逻辑。涉及数据源适配器的测试会 mock `httpFetch`；真实联网检查只通过 `e2e:live` / `e2e:live:full` 运行。

`npm audit --omit=dev --audit-level=high` 应保持干净。完整的 `npm audit --audit-level=high` 可能报告仅开发依赖相关的 `vitest` / `vite` / `esbuild` advisory；常规筛选运行中不要执行 `npm audit fix --force`，因为它可能引入破坏性的 Vitest 升级。

## 相关文档

- Skill 编排：[`../SKILL.md`](../SKILL.md)
- Agent 季度运行手册：[`../docs/agent-guide.md`](../docs/agent-guide.md)
- Spec 索引：[`../spec/index.yaml`](../spec/index.yaml)
