# 内容输入格式

`scripts/render-brief.mjs` turns plain JSON into a self-contained Material Continuum HTML document. It is the stable path: inputs cannot add HTML, CSS, class names, or arbitrary attributes.

```sh
node scripts/render-brief.mjs input.json --out output.html --mode pages --ratio 3:4
```

`--mode` is `pages` (default) or `web`. Fixed pages accept `3:4` (default), `1:1`, and `16:9`; each ratio has its own arrangement in `assets/page-layouts.css`. Web mode uses normal document flow, a desktop maximum width, and a mobile breakpoint. `renderBrief(value, { baseDir, mode, ratio })` is also exported for tests and other local scripts. Asset paths resolve from `baseDir`, which the CLI sets to the input JSON directory.

## Input

This complete example uses every root-level field and the reading family:

```json
{
  "schemaVersion": "1",
  "title": "A short brief",
  "theme": "A",
  "sourceMode": "rough-material",
  "sourceLedger": [
    {
      "sourceId": "source-1",
      "label": "Approved copy",
      "locator": "brief.md#reading",
      "text": "Give words quiet reading space. Keep the thread intact. The renderer preserves this paragraph as one paragraph. A second paragraph remains separate."
    }
  ],
  "pages": [
    {
      "id": "reading-1",
      "layout": "reading",
      "purpose": "Explain the conclusion without interruption.",
      "sourceIds": ["source-1"],
      "kicker": "MATERIAL CONTINUUM",
      "meta": "Design note / 01",
      "title": "Give words\nquiet reading space",
      "blocks": [
        {
          "heading": "Keep the thread intact",
          "paragraphs": ["The renderer preserves this paragraph as one paragraph.", "A second paragraph remains separate."]
        }
      ],
      "footer": "01 / 01"
    }
  ]
}
```

`sourceMode` must be `final-copy` or `rough-material`. The ledger records source text for later coverage review; the renderer only preserves the identifiers and text. An entry may add `"type": "title" | "heading" | "paragraph" | "label"`. In final-copy mode the validator checks a supplied type against the rendered semantic element as well as preserving every source block verbatim and in order. Untyped entries retain the existing exact text-and-order check. It does not claim to understand facts or judge semantic coverage. Every page needs a purpose and at least one registered source ID.

All pages accept `id`, `layout`, `purpose`, `sourceIds`, `title`, plus optional `kicker`, `intro`, and `footer`. A photo-led page may set `"cover": true`; only that state permits `blocks: []`, producing a tall image field and raised title paper without filler body copy. A reading page may set `"continuation": true`; only that state permits the title to be omitted, and its opening paragraph receives a considered continuation-page scale and inset without generating a replacement heading. The two states cannot be combined or used by other layouts. A kicker is supplied copy, never renderer-generated filler. It stays with the title: inside the title-bearing header for comparison and sections, inside the paper for list and reading, inside the raised title sheet for photo-led, and above the narrative title in its copy plane so it does not compete with a busy image. A title may contain newlines; the renderer converts only those newlines to line breaks. Other content stays plain text.

Layout-specific fields:

| Layout | Required content | Intended relationship |
| --- | --- | --- |
| `photo-led` | `image`, 1–2 `blocks`; or `cover: true` with `blocks: []` | Full image, overlapping title sheet, supporting prose or title-only cover |
| `narrative` | `image`, 1–2 `blocks` | Illustration field crossed by one narrative paper containing the title, copy, and optional emphasis |
| `comparison` | exactly 2 `columns` | Parallel evidence; both columns use a visual, or both use the text-only variant |
| `sections` | 2–4 `sections`; optional top-level `image` and `notes` | Repeated sections, optionally organized beneath one shared illustration and followed by secondary notes |
| `list` | 2–6 `items` | Compact rows on one paper surface |
| `reading` | 1–5 `blocks`, optional `meta` and `accent`; `continuation: true` may omit `title` | Continuous paragraphs on one paper sheet |

A block is `{ "heading"?: string, "paragraphs": [string, ...] }`. Columns, sections, and list items are `{ "heading": string, "paragraphs"?: [string, ...], "details"?: [{ "label": string, "text": string }, ...], "image"?: image, "icon"?: name }`; choose at most one visual. `details` accepts 2–4 facts. Paragraphs may be omitted or empty only when valid details are present. Each fact renders its small label separately from body text, with a 14px label-to-body gap and 32px between facts. An image is `{ "src": string, "alt": string, "credit"?: string, "fit"?: "cover" | "contain" }`. The default is `cover`. Use `contain` when the complete image is the composition and cropping would remove meaningful content. Comparison columns preserve a contained image's intrinsic aspect ratio without adding colored bands; other families contain it within their registered image region. Choose artwork shaped for the target region, then check both image scale and remaining copy space.

The sections family may add one top-level `image` directly below its header. This shared visual spans the body width; a wide illustration around 3:1–3.5:1 is the calibrated shape, and `fit: "contain"` preserves the whole illustration at its natural ratio. In 3:4 output, featured sections form stacked horizontal groups with a 240px heading column and flowing body copy; in 1:1 output, they remain parallel columns. The repeated `sections` follow the image. Optional `notes` uses the block shape and renders afterward as a quieter cross-column explanation, rather than as another peer section.

When choosing a structural page, state the shared comparison dimensions or the sequence of explanations before selecting artwork. A detail label names a dimension; its text supplies the answer. Use paragraphs for continuous explanation, and details for additional scanable dimensions. In portrait output, detail labels use 18px and answers 26px; test the resulting column height with the final images in place.

For individual explanatory image rows in 3:4, the visual occupies a 420px column with a 64px gutter and a 245px image area. In 1:1, image rows use one vertical sequence with a 220px visual column, a 32px gutter, and the text track aligned to the image top; this prevents a final item from being stranded in an unbalanced grid. Supply a composed scene or a diagram containing the relationship being explained. A labeled record progressing through writing, tagging, and retrieval is an explanatory diagram; a large generic document symbol contributes only recognition. For paired comparison artwork, square or moderately landscape scenes preserve visual weight better than a panoramic banner reduced to half-page width. Recompose the artwork when needed, preserving the complete relevant action.

List and reading cards automatically place a small accent dot before every supplied kicker. No per-page opt-in is needed, and a card without a kicker receives no dot. The mark is non-interactive and hidden from assistive technology. The optional `"accent": "dot"` field selects the same marker. `data-reading-density` describes copy density but does not change paper height. Fixed paper depths share the bottom anchor described in DESIGN.md; list rows retain natural flow. Web mode uses content height.

Raster and SVG image paths must stay inside the input JSON directory and are embedded as data URLs. SVGs containing active elements, event attributes, or external references are rejected. Icons resolve from `assets/icon-library.json` or the verified default download cache and are also embedded. Missing assets fail clearly.

The fixed families reject too few, too many, or clearly excessive entries with a request to regroup or split content. These are structural guardrails, not a promise that every accepted string fits: the validator still measures the rendered DOM for overflow at each target ratio. In 16:9, list and reading share the same page gutter and left content baseline; reading keeps a maximum text measure for comfortable line length. It also requires list and reading paper to leave at least 24px before a supplied footer. The limits prevent empty templates and unbounded type shrinking; they do not replace editorial judgment.

## Output and source review

HTML embeds CSS, images, source ledger and registered page/region identifiers. `assets/layout-contract.json` defines required regions and capacity. Keep renderer-owned markup intact: validation compares actual structure and styles, not filenames. List/reading titles belong inside their paper; purely decorative backgrounds contain no text.

For rough material, distinguish supported facts, editorial connections and gaps before writing pages. Give each page one reader question and its supporting source IDs. Do not fill short pages with invented dates, claims or statistics. `sourceLedger.locator` describes where material came from; its `text` must carry the evidence needed by a reviewer even when that source is unavailable locally.

For final copy, record every supplied block in order. Titles, headings and paragraphs retain exact wording, paragraph boundaries and punctuation. A new page split may preserve reading order; rewriting requires authorization. `emphasis` is another paragraph in that ordered ledger. Footer/kicker metadata is not a place to hide changed source copy.

## Production themes and narrative emphasis

`theme` accepts `A`, `B-bright`, `C-bright`, `D-light`, `D-dark`, `E-owl`, `F-slate`. Values come from `assets/color-themes.json`; the renderer embeds all theme CSS and canonicalizes the selected ID.

The narrative sheet is the only fixed-page layout whose paper crosses an illustration boundary. It owns the kicker, title, body and optional emphasis as one reading surface; comparison, sections, list and reading keep their own restrained MD1 surfaces and do not inherit the narrative overlap.

Narrative pages may add `"emphasis": "提炼重点 / 组织叙事 / 安排版式"` as plain text up to 160 characters. It follows the body, uses `emphasisText`, and is 27px on fixed pages / 24px on web. In final-copy mode, include this text as a paragraph in the source ledger in its actual reading order. Never infer this role from colors inside an illustration. List/reading dots use `readingMarker`, not generic `accent`. F's yellow marker and pink emphasis are intentionally different.
