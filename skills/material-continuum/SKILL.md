---
name: material-continuum
description: 为活动介绍、产品说明、服务对照和观点文章制作 Material 风格图文排版，按内容组合照片、插画、对照、列表与阅读版式，输出独立 HTML 和有序 PNG。
---

# Material Continuum

根据读者需要理解的信息选择版式，组织照片、插画、标题与正文。默认主题 A、3:4、1080 × 1440，按内容决定页数。

## 制作

1. 区分来源：定稿保留原文、段落及顺序；零散材料建立 sourceLedger，提炼观点而不补造事实。为每页写明读者要理解什么、对应来源及图像作用。
2. 阅读 [DESIGN.md](DESIGN.md)，查看其中适用的视觉参照。根据关系选择照片引领、叙事插画、结构对照、结构展开、卡片列表或文字阅读。
3. 按 [BRIEF.md](BRIEF.md) 编写 JSON。主题取自 `assets/color-themes.json`。位图作为独立素材；HTML 负责标题、正文、栏目圆点和纸面。新增照片/插画按实际图槽构图，不包含页面文字。图标只作小型信息标记；需要时用 `scripts/material-icons.mjs` 搜索和获取。
4. 在 skill 根目录执行：

```bash
node scripts/render-brief.mjs /path/to/brief.json --out /path/to/output.html
node scripts/validate-brief.mjs /path/to/output.html --report /path/to/validation.json
node scripts/export-pages.mjs /path/to/output.html --out /path/to/png
```

需要网页时渲染加 `--mode web`，验证和导出加 `--web`。依赖安装见 [README.md](README.md)。交付 HTML 内嵌 CSS 与图片；输入 JSON 中不写任意 HTML/CSS。

## 校对与交付

逐张查看实际 PNG，并与设计参照比较。结构和颜色检查通过不等于视觉优秀。分别记录：

- 内容：来源、定稿逐字与顺序、缺失事实、图片是否解释对应信息。
- 渲染：缺图、裁切、遮挡、溢出、实际文字颜色、圆点、页脚和导出顺序。
- 审美：焦点、图文比例、段落节奏、并列关系、插画质量和整套一致性。

多页作品或版式变更，在可委派时使用独立审阅；否则注明自行复核。回修前把当前 brief、HTML、PNG 和报告保存在作品目录。最多两轮针对性回修；仍有差距时说明具体页面和问题，不以技术通过代替优秀。

交付 brief JSON、独立 HTML、有序 PNG 和校对结论。在本仓库工作时，作品与检查记录放在根目录 `scratch/`；其他环境使用用户的作品目录。修改版式或主题时遵循 DESIGN.md 的维护边界，并重跑测试。
