# Market Screener Spec

本目录只保存 `cli/` 会读取或验证的机器规则。

## 文件关系

| 文件 | CLI 用途 |
|------|----------|
| `index.yaml` | 规则清单；列出规则文件和模板文件 |
| `exclusion-rules.yaml` | 投资范围、报价预筛、共享剔除、标记规则 |
| `routing-cn.yaml` | A 股申万行业到行业模板的路由规则 |
| `routing-us.yaml` | 美股 GICS 和行业代理到行业模板的路由规则 |
| `metric-policy.yaml` | 阈值语法、衍生指标、数据补全、模板可执行性 |
| `selection-policy.yaml` | 候选上限、延后名单、席位分配、排序规则 |
| `landmine-pricing.yaml` | `screener landmine` 使用的价格计算公式 |
| `templates/*.yaml` | 各行业漏斗 required / supporting 指标规则 |

## 不放在本目录的内容

| 内容 | 位置 |
|------|------|
| Agent 运行手册 | `../docs/agent-guide.md` |
| Agent 输出风格和结果转述指南 | `../docs/agent-output.md` |
| 后续规划 | `../docs/future-work.md` |

## 验证

```bash
cd ../cli
npm run validate
# expected: Spec OK (13 files)
npm test -- test/spec/validate-spec.test.ts
```
