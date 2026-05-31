---
name: figma-design-review
description: Use when reviewing implementation against a Figma design, checking layout/spacing/visual parity, or auditing whether code properly reuses the project's existing design tokens, typography primitives, colors, and design-system components instead of hand-written styles.
---

# Figma Design Review

Review implementation against design. This is a design-diff skill, not a general code review skill.

The goal is to find places where shipped code diverges from the design, especially in:
- structure and states
- layout, spacing, and alignment
- typography and colors
- token and style-system reuse
- design-system component reuse vs ad-hoc styling

## Core Rules

1. Stay scoped to design parity. Do not report ordinary logic, architecture, or testing issues unless they directly cause a design/state mismatch.
2. Refuse to guess when required context is missing. Missing design input or missing file scope is a blocker, not an invitation to improvise.
3. Prefer user-provided review scope. Only expand one hop when necessary.
4. Use a clean-context reviewer subagent for the main review. The parent agent handles preflight checks and lightweight pre-review only.

## Required Inputs

You need both:
- a design reference
- a code review scope

### Accepted design reference

Preferred:
- Figma URL with node id, or Figma node/file details that can be fetched through Figma tools

Fallback:
- screenshot(s) of the design

### Accepted code scope

Preferred:
- explicit file paths from the user

Fallback:
- an explicitly named component or module, after which you may ask the user to confirm the target files before reviewing

## Blockers and Fallbacks

### No design reference

Do not start the review.

Tell the user you cannot perform a design review without a design reference and ask for one of:
- a Figma URL with node id
- a Figma screenshot
- a clearly identified design file and node

### Figma reference provided but cannot be read

Do not continue into formal review.

Tell the user what failed and ask for one of:
- a corrected/accessible Figma URL or node
- screenshots of the target design

### Screenshot-only review

You may proceed, but you MUST mark the result as limited.

Before findings, include a brief limitation note that clearly tells the user:
- the review is operating with reduced precision
- exact tokens and node structure could not be verified from screenshots alone
- conclusions are limited to visible structure, layout, spacing, hierarchy, and other obvious visual differences

In screenshot-only mode, do not make confident claims about exact design tokens, node structure, or hidden states unless the code itself provides direct evidence.

### No file scope

Do not guess the review surface.

Ask the user to provide:
- the component file(s) to review, or
- the exact component/module name plus the expected file range

## Scope Control

Default review scope:
- only the file paths the user provided

One-hop expansion allowed when necessary:
- directly related style file for a reviewed component
- directly imported/rendered view file that is necessary to explain a visible design mismatch

If you need to go beyond one hop, stop and ask the user before proceeding.

Do not silently expand to an entire feature area or module tree.

## Review Flow

Follow this sequence.

### 1. Validate inputs

Confirm:
- design reference exists
- design reference is readable
- file scope is explicit enough

If any item fails, stop and ask for missing context.

### 2. Gather minimal context

Collect only what is needed:
- the target file(s)
- directly related style file(s), if needed
- directly referenced view file(s), if needed
- Figma design context and screenshot, when Figma is available

Do not bulk-read unrelated files.

### 3. Parent-agent lightweight precheck

Before dispatching the reviewer subagent, do a small precheck yourself. Focus on obvious items only:
- is the expected title/section/major structure present
- do primary layout containers appear to match the design shape
- are there obvious hard-coded colors, spacing values, font sizes, shadows, or radii
- are there obvious signs that project typography/tokens/primitives are being bypassed

This precheck is only to surface obvious issues early and to package better context for the reviewer. It is not the final review.

### 4. Dispatch clean-context reviewer subagent

Spawn a reviewer subagent with `fork_context: false`.

Pass only:
- the design reference context
- the selected file contents
- the user-provided review scope
- any lightweight precheck notes
- explicit instructions that this is a design-only review

Do not pass your full conversation history.

Use the reviewer prompt in `references/design-reviewer.md`.

### 5. Reviewer subagent output

The reviewer subagent should return findings only for design-related issues, ordered by severity.

### 6. Merge and de-duplicate

Combine the reviewer output with any parent-agent precheck findings.

De-duplicate overlapping issues and keep the clearest version with the strongest file evidence.

## What To Review

### Structure and state parity

Check whether the implementation preserves the design's:
- section structure
- helper text
- tips, alerts, banners, and annotations
- empty, warning, error, and abnormal states
- buttons/actions and their placement

### Layout and spacing

Check:
- container width/height intent
- column widths
- gap/padding/margin
- alignment
- vertical rhythm between rows, labels, content, and footnotes

### Typography and colors

Check:
- font size
- line height
- weight
- hierarchy
- text, border, and background color intent

### Token and style-system reuse

Check whether the code:
- hard-codes colors, spacing, shadows, radii, or typography values that should likely come from project tokens
- bypasses existing typography primitives, shared style helpers, variables, or semantic color tokens
- duplicates styling patterns that likely already exist in the project

Do not require a specific library name. First infer what the project already uses, then judge reuse against that system.

### Design-system component reuse

Check whether the implementation:
- hand-builds UI that should be using an existing design-system component or primitive
- recreates a standard pattern with custom CSS instead of reusing the project system

Report this only when it materially affects consistency or maintainability.

## Severity

- `P1`: A missing or wrong design structure/state that materially changes what the user sees
- `P2`: A clear mismatch in layout, spacing, typography, color, or token/primitive usage
- `P3`: A smaller visual inconsistency or a maintainability issue tied to design-system/style-system reuse

## Output Format

Findings first. Order by severity.

For each finding include:
- severity (`P1` / `P2` / `P3`)
- short title
- file and line reference
- what differs from the design
- why it matters
- a concrete improvement direction

If there are no findings, say so explicitly and mention any residual review limitations.

If the review was blocked, output:
- the blocker
- why it prevents a valid design review
- what the user can provide next

## Example Prompts

- `给你 Figma URL 和两个组件文件，帮我走查实现和设计稿的差异，重点看布局和间距`
- `只看这个组件和样式文件，检查有没有硬编码颜色/字号/间距，以及是否应该复用项目现有样式系统`
- `我只有设计截图和代码文件，帮我做降级版设计走查`
- `帮我走查这个实现`
- `这是 Figma 链接，但 node 打不开；目标代码是这几个文件`
- `Review this implementation against the Figma node and focus on layout, spacing, and typography mismatches.`
- `Check whether this component is using hard-coded colors and spacing instead of the project's existing design tokens or style primitives.`
- `I only have a screenshot and these component files. Do a limited design review and call out what you cannot verify precisely.`

## Anti-Patterns

Do not:
- continue after a failed Figma fetch as if the design were known
- infer review scope from a whole feature folder when the user did not provide one
- turn this into a general code review
- overstate confidence in screenshot-only mode
- report style reuse issues without first checking whether the project already has relevant tokens/primitives/components
