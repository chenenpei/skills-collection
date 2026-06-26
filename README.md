# skills-collection

本仓库收录一组 [Agent Skills](https://agentskills.io/) 格式的技能：每个技能是一个独立目录，内含 `SKILL.md`（YAML frontmatter + 使用说明），供各类兼容 Agent 按需加载。

## Skills


| Skill                   | 用途                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **code-simplify**       | 针对近期改动做复用、质量与效率审查，并直接落地修复；适用于「简化这次改动」「清理 diff」「检查复用与性能」等场景。实现思路参考 Claude Code 内置的 `/simplify` 命令，对应源码见 [simplify.ts](https://github.com/yasasbanukaofficial/claude-code/blob/main/src/skills/bundled/simplify.ts)。 |
| **code-research**       | 只读深度梳理代码库业务与实现，按模板产出中文研究报告到 `docs/research/`；适用于「研究某模块实现」「理解调用链」「交接前摸底」等，不负责顺手改业务代码。                                                                                                                               |
| **communication-style-guide** | 中文对话风格偏好指南。默认用于回复用户时校准语气、主语、完整动作、用词分寸、情绪表达和对话收束；包含可持续追加的纠正示例参考。 |
| **figma-design-review** | 对照 Figma 设计稿（或截图降级）走查实现与设计的一致性，关注布局、间距、字体颜色与设计 token / 组件复用；缺少设计稿或代码范围时不强行评审。**完整走查 Figma 节点时需在 Agent 环境中配置 Figma MCP**（以便通过 MCP 读取设计上下文）；仅有截图时仍可按 SKILL 中的降级流程做有限评审。                                              |
| **stock-analysis-audit** | 对个股和基金类产品做证据优先的投资审计。个股侧重财务质量、护城河、估值、机会成本和反向排雷；基金侧覆盖 ETF、指数基金、主动基金等，重点看基金结构、持仓暴露、费用、同类基金比较和组合角色。支持 Lite 初筛与 Deep 深度审计。同目录含 `spec/` 规则、`chatbot/` 分阶段提示词与 `docs/` 示例。结论仅供研究辅助，非投资建议。 |
| **market-screener** | 面向 A 股和美股个股的季度定量筛选：先按硬性条件剔除，再做行业归类和行业模板评分，输出 `candidates.yaml`、`deferred.yaml` 等结果文件，并把候选标的交给 **stock-analysis-audit** 做深度审计（Deep）。包含 `spec/` 规则、需手动触发的 `SKILL.md` 编排，以及 `cli/` 中的 TypeScript 命令行工具 `screener`（`validate`、`run`、`explain`、`landmine`、`filter-breakdown`）。详见 [CONTEXT-MAP.md](./CONTEXT-MAP.md)。 |

## 安装

使用 [skills CLI](https://github.com/vercel-labs/skills)。仓库：**[https://github.com/chenenpei/skills-collection](https://github.com/chenenpei/skills-collection)**

在目标项目目录下，**一次性安装全部技能**：

```bash
npx skills add https://github.com/chenenpei/skills-collection -y
```

**单独安装**（每条可独立复制执行）：

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill code-simplify -y
```

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill code-research -y
```

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill communication-style-guide -y
```

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill figma-design-review -y
```

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill stock-analysis-audit -y
```

```bash
npx skills add https://github.com/chenenpei/skills-collection --skill market-screener -y
```

已克隆本仓库时，在仓库根目录：**全部安装**：

```bash
npx skills add . -y
```

**单独安装**：

```bash
npx skills add . --skill code-simplify -y
```

```bash
npx skills add . --skill code-research -y
```

```bash
npx skills add . --skill communication-style-guide -y
```

```bash
npx skills add . --skill figma-design-review -y
```

```bash
npx skills add . --skill stock-analysis-audit -y
```

```bash
npx skills add . --skill market-screener -y
```

## License

[MIT](LICENSE)
