---
version: alpha
name: Material Continuum
description: Editorial Material composition for covers, sequential visual briefs, and responsive display pages.
colors:
  primary: "#3F51B5"
  on-primary: "#FFFFFF"
  accent: "#FF5252"
  on-accent: "#212121"
  tint: "#E8EAF6"
  theme-b-primary: "#00796B"
  theme-b-on-primary: "#FFFFFF"
  theme-b-accent: "#FFC107"
  theme-b-on-accent: "#212121"
  theme-b-tint: "#E0F2F1"
  theme-c2-primary: "#5E35B1"
  theme-c2-on-primary: "#FFFFFF"
  theme-c2-accent: "#80CBC4"
  theme-c2-on-accent: "#212121"
  theme-c2-tint: "#EDE7F6"
  canvas: "#FAFAFA"
  canvas-muted: "#F5F5F5"
  surface: "#FFFFFF"
  text-primary: "#212121"
  text-secondary: "#616161"
  divider: "#E0E0E0"
  error: "#B3261E"
  success: "#2E7D32"
  warning: "#795500"
typography:
  image-title:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 88px
    fontWeight: 300
    lineHeight: 1.3
  image-heading:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 68px
    fontWeight: 300
    lineHeight: 1.25
  image-section:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 40px
    fontWeight: 400
    lineHeight: 1.4
  image-body:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.75
  image-intro:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 30px
    fontWeight: 400
    lineHeight: 1.7
  web-title:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 34px
    fontWeight: 400
    lineHeight: 40px
  web-section:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 24px
    fontWeight: 400
    lineHeight: 32px
  web-body:
    fontFamily: "Roboto, Noto Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, Arial, sans-serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 32px
rounded:
  sharp: 0px
spacing:
  micro: 4px
  base: 8px
  compact: 16px
  content: 24px
  block: 32px
  section-sm: 40px
  section-md: 48px
  section-lg: 64px
  section-xl: 80px
  page-gutter: 88px
  layout-gap: 96px
  reading-gutter: 104px
  wide-gap: 112px
  hero-space: 128px
components:
  primary-band:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.image-heading}"
    rounded: "{rounded.sharp}"
  accent-field:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.image-intro}"
    rounded: "{rounded.sharp}"
  paper:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.image-body}"
    rounded: "{rounded.sharp}"
  body-copy:
    textColor: "{colors.text-primary}"
    typography: "{typography.image-body}"
---

# 视觉设计规则

## 设计语言

锐利矩形纸面、明确色块、轻至常规字重、柔和且有语义的投影。摄影建立情境，插画解释概念，排版组织阅读。大图需要经过构图的场景或解释关系的图示；放大图标不能替代插画。

基础字号与间距在本文件 frontmatter；`assets/material.css` 保存生成的基础值和公共样式，`assets/page-layouts.css` 保存六类版式几何。正文、标题和主要间隔有明确层级。图内留白不能补偿正文拥挤；内容过多先整理重复、归组或按语义分页，定稿修改须获得授权。

在同一作品中，主题和同类容器基准线保持一致。3:4、1:1、16:9 与响应式网页分别排版，不能裁切或整体缩小代替适配。字体回退可能改变断行；声明字体名称不代表环境已安装，需检查最终渲染。

## 配色角色

正式配色唯一来源为 [color-themes.json](assets/color-themes.json)：A、B-bright、C-bright、D-light、D-dark、E-owl、F-slate。frontmatter 的颜色仅为基础回退值，正式主题覆盖它们。

| 角色 | 放置位置 |
|---|---|
| displayField / displayHeading / onDisplayField | 大色块、其标题、其小字 |
| surface / onSurface | 纸面、阅读主标题和正文 |
| coloredHeading | 纸面上的栏目标题 |
| emphasisText | 叙事页末尾的强调短语 |
| readingMarker | 列表/阅读卡栏目开头圆点 |
| coverAccent | 照片引领页标题纸面的短装饰线 |
| illustrationSurface | 结构展开中同级插图的一致外底 |

E 保持电蓝主色、洋红文字强调与圆点、明黄图形辅助。F 保持深蓝灰主色和栏目标题、洋红文字强调、明黄圆点与图形细节。不要把标题、强调色、圆点合并成一个通用 accent。普通文字至少 4.5:1；至少24px常规字重的大标题/强调文字可用3:1，E/F的亮洋红仅适用于明确的大字角色。

图片可以包含协调的额外色系，黑白灰主题也允许彩色图片。CSS 不会重染位图；自带大面积颜色背景的插图需要单独匹配主题。可着色 SVG 的局部颜色按图像语义分配，不能为了凑颜色改变信息主次。

## 版式与容器

- 照片引领：图像铺满实际图槽，标题纸面跨过真实图片边界。保留独立的短装饰线。
- 叙事插画：场景与文案共同表达一个过程或概念。强调短语显式使用 emphasisText；图片中的蓝色不自动成为文字色。
- 结构对照：相同维度、相同内部层级和对齐线；两张图主体尺度相称，颜色差异具有表达作用。
- 结构展开：连续解释相关信息；用场景或图示承担关系。平级插图保持一致外底，不单独给中间项加亮色背景制造优先级。
- 卡片列表：同类短信息在一张纸面内形成连续行，分隔线只画在行间，末项不留尾线。
- 文字阅读：保留完整论述和舒适的段落间距。短文字仍需足够纸面高度和底部余量。

列表/阅读的标题和内容都在卡片内，纯装饰背景不承载文字。每个已提供的 kicker 前自动放一个16px圆点，间距16px；卡片栏目使用圆点标记。页脚与卡片外边缘对齐。标题色带是另一种容器，允许有文字，但断行后仍需保留底部内边距。

3:4 的阅读纸面 y=202、最小高度1104，列表纸面 y=168、最小高度1138；共享背景分界 y=828、纸面底线 y=1306。数值是项目校准而非通用 MD1 规则。其他比例有自己的几何关系。

## 图像与视觉校准

制作结构页前查看适用参照：[结构对照](assets/reference-comparison.png)、[结构展开](assets/reference-development.png)、[文字阅读](assets/reference-reading.png)。它们只说明层级、分组、密度、留白和纸面关系；参照用于比较构图，正文来自当前 brief，交付页面由 HTML 排版。

先定义每张图的解释任务、实际比例、主体尺度和允许裁切的位置。原尺寸检查物体连接、手部动作和空间关系，再放入页面检查裁切与可读性。成对插画比较画法、尺度和视觉重量；两页内容关系不同，就不应复用同一张图声称已解释新的流程。

图像铺满照片/叙事槽，不能用色带掩盖图片宽度不足。对照图或解释图可用 contain 保留完整关系。新增插图延续干净、几何化、平面的语言；是否精致由实际构图和细节决定，不由物件数量或颜色数量决定。照片与插画保持不同表达职责。

审阅时把当前 PNG 和参照放在相近尺寸，指出可观察的差距。每次回修只针对具体缺陷，检查改进是否伤害内容和层级。技术 fixtures、新生成图片和用户认可参照的地位不同。最多两轮回修后交付残余问题，保留用户认可状态与内部判断的区别。

## 维护边界

新主题修改 `assets/color-themes.json` 后运行 `npm run themes:sync` / `themes:check`。基础字号和间距修改本文件 frontmatter 后运行 `npm run design:sync` / `design:check`。同步脚本只管理对应 CSS 块，不直接手改生成块。

新增版式须同时定义输入关系/容量、renderer 分支、`layout-contract.json` 和共享 CSS；使用短、典型、长内容及错误输入测试，再查看导出 PNG 并换题材验证。新题材、图标或主题本身不需要新增版式。普通 brief 不增加局部 CSS 补丁。

## 设计依据

MD1 的 [metrics/keylines](https://m1.material.io/layout/metrics-keylines.html)、[structure](https://m1.material.io/layout/structure.html)、[typography](https://m1.material.io/style/typography.html) 与 [elevation](https://m1.material.io/material-design/elevation-shadows.html) 提供网格、阅读层级与表面关系依据。本项目的海报字号、锐角纸面与固定分界是本项目的编辑设计选择，不声称是官方统一要求。

MD2 的 [color system](https://m2.material.io/design/color/the-color-system.html) 与 [Owl](https://m2.material.io/design/material-studies/owl.html) 启发颜色角色；E/F 是本项目适配。先规划再检查实际渲染的工作方式参考 [Guizang PPT Skill](https://github.com/op7418/guizang-ppt-skill)，未复制其实现代码。
