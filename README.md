# skills-collection

本仓库收录一组 [Agent Skills](https://agentskills.io/) 格式的技能：每个技能是一个独立目录，内含 `SKILL.md`（YAML frontmatter + 使用说明），供各类兼容 Agent 按需加载。

## Skills


| Skill                   | 用途                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **code-simplify**       | 针对近期改动做复用、质量与效率审查，并直接落地修复；适用于「简化这次改动」「清理 diff」「检查复用与性能」等场景。实现思路参考 Claude Code 内置的 `/simplify` 命令，对应源码见 [simplify.ts](https://github.com/yasasbanukaofficial/claude-code/blob/main/src/skills/bundled/simplify.ts)。 |
| **code-research**       | 只读深度梳理代码库业务与实现，按模板产出中文研究报告到 `docs/research/`；适用于「研究某模块实现」「理解调用链」「交接前摸底」等，不负责顺手改业务代码。                                                                                                                               |
| **figma-design-review** | 对照 Figma 设计稿（或截图降级）走查实现与设计的一致性，关注布局、间距、字体颜色与设计 token / 组件复用；缺少设计稿或代码范围时不强行评审。**完整走查 Figma 节点时需在 Agent 环境中配置 Figma MCP**（以便通过 MCP 读取设计上下文）；仅有截图时仍可按 SKILL 中的降级流程做有限评审。                                              |


## 安装

使用 [skills CLI](https://github.com/vercel-labs/skills)。仓库：**[https://github.com/chenenpei/skiils-collection](https://github.com/chenenpei/skiils-collection)**

在目标项目目录下，**一次性安装全部技能**：

```bash
npx skills add https://github.com/chenenpei/skiils-collection -y
```

**单独安装**（每条可独立复制执行）：

```bash
npx skills add https://github.com/chenenpei/skiils-collection --skill code-simplify -y
```

```bash
npx skills add https://github.com/chenenpei/skiils-collection --skill code-research -y
```

```bash
npx skills add https://github.com/chenenpei/skiils-collection --skill figma-design-review -y
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
npx skills add . --skill figma-design-review -y
```

## License

[MIT](LICENSE)