# Market Screener Spec

本目录只保存 `cli/` 会读取或验证的机器规则。运行时机、定时任务、到价提醒和 Agent 输出说明不放在本目录。

## 文件关系

| 文件 | CLI 用途 |
|------|----------|
| `index.yaml` | 规则 manifest；列出模板文件和少量运行元数据 |
| `conventions.yaml` | 阈值语法、soft cap、deferred cap、席位分配、模板 live viability |
| `kill-gates.yaml` | 行业模板前的共享剔除规则 |
| `routing-map.yaml` | GICS / 行业代理到行业模板的路由规则 |
| `cn-industry-map.yaml` | A 股申万行业到行业模板的主要路由规则 |
| `landmine-rules.yaml` | `screener landmine` 使用的公式 slug 和计算规则 |
| `templates/*.yaml` | 各行业漏斗 required / supporting 指标规则 |

## 不放在本目录的内容

| 内容 | 位置 |
|------|------|
| Agent 运行手册 | `../docs/agent-guide.md` |
| Agent 输出风格和 artifact 转述指南 | `../docs/agent-output.md` |
| 后续规划 | `../docs/future-work.md` |

## 验证

```bash
cd ../cli
npm run validate
npm test -- test/spec/validate-spec.test.ts
```
