# market-screener

面向 A 股和美股个股的季度定量筛选技能。它先用 `cli/` 中的 `screener` 命令生成 `candidates.yaml`、`deferred.yaml`、`excluded.yaml` 等结果，再把候选标的交给 [stock-analysis-audit](../stock-analysis-audit/) 做 Deep（深度审计）。

本目录包含两部分：`spec/` 保存规则，`cli/` 执行定量漏斗。投资结论仅用于研究辅助，不构成投资建议。

## 目录结构

| 路径 | 用途 |
|------|------|
| [SKILL.md](./SKILL.md) | Agent 编排入口，仅在用户明确调用时使用 |
| [cli/](./cli/) | TypeScript 命令行工具，包含 `validate`、`run`、`explain`、`landmine`、`filter-breakdown`、`bank-indicators` |
| [docs/agent-guide.md](./docs/agent-guide.md) | 面向 Agent 的运行手册 |
| [docs/agent-output.md](./docs/agent-output.md) | 面向 Agent 的输出风格和结果转述指南 |
| [docs/future-work.md](./docs/future-work.md) | 中文后续工作清单；集中记录未实现能力和规划项 |
| [CONTEXT.md](./CONTEXT.md) | 领域词汇表，仅保存术语和 slug |
| [spec/README.md](./spec/README.md) | CLI 机器规则目录说明 |
| [spec/index.yaml](./spec/index.yaml) | CLI 规则清单 |
| [spec/kill-gates.yaml](./spec/kill-gates.yaml) | 行业模板前的共享剔除规则 |
| [spec/routing-map.yaml](./spec/routing-map.yaml) | GICS / 行业代理到模板的路由规则 |
| [spec/cn-industry-map.yaml](./spec/cn-industry-map.yaml) | A 股申万行业到模板的主要路由规则 |
| [spec/conventions.yaml](./spec/conventions.yaml) | 阈值语法和通过规则约定 |
| [spec/landmine-rules.yaml](./spec/landmine-rules.yaml) | 限价观察价计算规则 |
| [spec/templates/](./spec/templates/) | 六类行业漏斗规则 |

## 命令行工具

路径：[`cli/`](./cli/)。这是基于 Commander 和 `tsx` 的 TypeScript 命令行工具。

### 安装依赖

```bash
cd skills/market-screener/cli
npm install
```

### 运行测试

```bash
npm test
```

### 常用命令

以下命令都在 `skills/market-screener/cli` 目录执行，可使用 `npm run dev -- <command>` 或 `npx tsx bin/screener.ts <command>`。

**校验规则文件**

```bash
npm run validate
# or: npx tsx bin/screener.ts validate ../spec
```

**运行定量漏斗**（`--adapter fixture` 为离线 fixture；`--adapter live` 使用东方财富、Yahoo、SEC 等在线数据源）

```bash
# Offline (default)
npx tsx bin/screener.ts run \
  --markets CN,US \
  --quarter 2026-Q2 \
  --output /tmp/screener-out \
  --spec ../spec \
  --adapter fixture

# Live universe (requires network)
npx tsx bin/screener.ts run \
  --markets CN,US \
  --quarter 2026-Q2 \
  --output /tmp/screener-out-live \
  --spec ../spec \
  --adapter live
```

写入 `{output}/{quarter}/{CN|US}/candidates.yaml`、`deferred.yaml`、`excluded.yaml`、`routing-diagnostics.yaml`、`funnel-diagnostics.yaml`，在线运行且有预筛剔除时还会写入 `prefilter-excluded.yaml`。

**A 股路由：** 补全后的 A 股标的通过 `spec/cn-industry-map.yaml` 路由（`routing_method: cn_industry_map`）。季度漏斗前可用 `npx tsx scripts/reports/routing-report.ts --quarter YYYY-Qn --market CN --spec ../spec` 检查覆盖率，目标是 `fallback_rate` < 5%。

**在线数据参数：** `--enrich-concurrency`（默认 4）、`--skip-cache`。

**解释单个标的的路由和筛选结果**

```bash
npx tsx bin/screener.ts explain 600519 \
  --market CN \
  --fixture test/fixtures/universe-cn.json \
  --spec ../spec
```

**根据 Deep 审计短名单生成限价观察价**

```bash
npx tsx bin/screener.ts landmine \
  --from test/fixtures/audit-summary.yaml \
  --output /tmp/landmines.yaml \
  --quarter 2026-Q2
```

**统计漏斗剔除原因**

```bash
npm run dev -- filter-breakdown \
  --output /tmp/screener-out \
  --quarter 2026-Q2 \
  --markets CN
```

默认写入 `/tmp/screener-out/2026-Q2/CN/filter-breakdown.md`。

`run` 和 `explain` 需要显式传入 `--spec ../spec`。`landmine` 可通过 `--spec` 指定规则目录；省略时会使用命令内部的默认规则路径。

## 相关文档

- [CONTEXT-MAP.md](../../CONTEXT-MAP.md)
