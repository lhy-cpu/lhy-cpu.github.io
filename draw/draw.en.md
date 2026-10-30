# FlowSketch JSON Generation Specification

English | [简体中文](draw.md)

This document is intended for AI systems and automation tools. Its purpose is to define how to generate project JSON that can be imported directly into FlowSketch from a user's natural-language request.

## Your Task

You are a FlowSketch drawing agent. After receiving a user request:

1. Extract the entities, hierarchy, flow direction, groups, connections, emphasized information, and image requirements.
2. Plan the canvas, grid, margins, element sizes, and visual hierarchy before calculating coordinates.
3. Give every element a unique and stable `id`.
4. Use the order of the `elements` array as the layer order: earlier elements are behind later elements.
5. Bind connectors to element IDs and four-way anchors whenever possible instead of relying only on fixed endpoint coordinates.
6. Verify that every element stays inside the canvas, text fits its container, connectors point in the right direction, and colors have sufficient contrast.
7. Output exactly one valid JSON object. Unless the user explicitly requests an explanation, do not output Markdown fences, comments, or any text outside the JSON object.

FlowSketch fills in some missing defaults, but an AI should emit complete fields whenever possible to keep rendering deterministic.

This specification describes complete project JSON for import, not the browser AI edit protocol. The browser AI uses `operations` or `edit_canvas` under its live shared field contract and budgets; see [AI.md](AI.md). The focus here is composition and valid, editable project data. Browser workflows and file export belong in [README.en.md](README.en.md).

## Top-Level Format

```json
{
  "version": 12,
  "name": "Project name",
  "canvas": {
    "width": 1400,
    "height": 900,
    "bg": "#ffffff",
    "grid": false,
    "gridSize": 20,
    "snap": true,
    "theme": 0
  },
  "elements": [],
  "groups": []
}
```

### Top-Level Fields

| Field | Type | Description |
| --- | --- | --- |
| `version` | number | The current format version. Always use `12`. |
| `name` | string | Project name shown in the file list and used for exported filenames. |
| `canvas.width` | number | Canvas width. The editor UI limits it to 200-6000. Typical range: 1200-1800. |
| `canvas.height` | number | Canvas height. The editor UI limits it to 200-6000. Typical range: 700-1200. |
| `canvas.bg` | CSS color | Canvas background. Hex colors are recommended. |
| `canvas.grid` | boolean | Whether the grid is visible. Dragging snaps to the grid when enabled. |
| `canvas.gridSize` | number | Grid spacing. The UI limits it to 5-100. |
| `canvas.snap` | boolean | Enables element alignment and connector-anchor snapping. Usually `true`. |
| `canvas.theme` | integer | Active theme index, from 0 to 119. A theme does not automatically overwrite element colors. |
| `elements` | array | All shapes and connectors, ordered from back to front. |
| `groups` | array | True grouping relationships; members remain in `elements`. |

## Coordinates and Layout

- The origin `(0, 0)` is at the top-left of the canvas. X increases to the right and Y increases downward. Units are pixels.
- The unrotated position and dimensions of a normal element are defined by `x`, `y`, `w`, and `h`.
- `rotation` is measured in degrees around the element center. Positive values rotate clockwise.
- Leave about 70-140 pixels between major adjacent nodes and 24-40 pixels of inner padding inside groups.
- Recommended sizes: 16-20 px for body text, 20-26 px for group titles, and 28-40 px for the main title.
- For long text, enlarge the element or insert explicit `\n` line breaks. Do not rely on overflow.
- Add group backgrounds first, nodes and text next, and foreground annotations last. Connectors are usually placed before nodes so nodes cover connector endpoints.
- Technical figures should use one dominant direction, normally left-to-right or top-to-bottom, to reduce unnecessary line crossings.

## Common Fields for Normal Elements

The following fields apply to most element types except `connector`:

```json
{
  "id": "unique-node-id",
  "type": "basicShape",
  "x": 100,
  "y": 100,
  "w": 180,
  "h": 80,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "text": "Node text",
  "fontSize": 18,
  "fontWeight": 600,
  "fontFamily": "HarmonyOS Sans SC",
  "italic": false,
  "textColor": "#172554",
  "fill": "#eff6ff",
  "colorMode": "solid",
  "gradientColors": {"tl":"#ffffff","tr":"#dbeafe","bl":"#bfdbfe","br":"#eff6ff"},
  "groupId": null,
  "stroke": "#1d4ed8",
  "strokeWidth": 2,
  "radius": 8,
  "align": "center",
  "vAlign": "center",
  "textOffsetX": 0,
  "textOffsetY": 0,
  "padding": 8,
  "dash": false,
  "shadow": true
}
```

| Field | Allowed values or guidance |
| --- | --- |
| `id` | A non-empty unique string. Connectors use it to bind to elements. |
| `type` | `basicShape`, `text`, `formula`, `note`, `image`, `tokenGrid`, `token`, or `connector`. |
| `opacity` | 0-1. Group backgrounds often use 0.5-0.8; normal nodes usually use 1. |
| `visible` | The element is not rendered when `false`. |
| `locked` | The user cannot drag the element directly when `true`. |
| `colorMode` | `solid` or `gradient` for normal fillable elements. `tokenGrid` has additional modes. |
| `gradientColors` | Four-corner color object with `tl`, `tr`, `bl`, and `br`. Used when `colorMode` is `gradient`. |
| `groupId` | ID of the true group containing the element, or `null`. It must match a record in top-level `groups`. |
| `fontWeight` | The UI commonly uses 400, 600, 700, and 800. |
| `italic` | Whether text is italic. |
| `strokeWidth` | 0-12. Use 1-3 for most nodes. |
| `radius` | Corner radius. It affects rectangular `basicShape` elements. |
| `align` | `left`, `center`, or `right`. |
| `vAlign` | `top`, `center`, or `bottom`. |
| `textOffsetX/Y` | Additional pixel offset for text relative to its normal position. Usually 0. |
| `padding` | Text inset. Default: 8. |
| `dash` | Whether to use a dashed outline. |
| `shadow` | Whether to show a shadow. Disable shadows on large collections of small elements. |

Four-corner gradients on normal fillable elements use the same two-dimensional linear interpolation model as Token matrices. Formulas, plain text, and connectors do not use fill gradients.

## Basic Shapes: `basicShape`

Add `shapeKind` to the common fields:

```json
{
  "id": "decision",
  "type": "basicShape",
  "shapeKind": "diamond",
  "x": 520,
  "y": 250,
  "w": 160,
  "h": 110,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "text": "Approved?",
  "fontSize": 18,
  "fontWeight": 700,
  "fontFamily": "HarmonyOS Sans SC",
  "italic": false,
  "textColor": "#0b2d5c",
  "fill": "#e8f1fb",
  "stroke": "#165d9c",
  "strokeWidth": 2,
  "radius": 8,
  "align": "center",
  "vAlign": "center",
  "textOffsetX": 0,
  "textOffsetY": 0,
  "padding": 8,
  "dash": false,
  "shadow": true
}
```

Allowed `shapeKind` values:

| Category | Values |
| --- | --- |
| Basic | `rect`, `ellipse`, `diamond`, `triangle`, `rightTriangle`, `parallelogram`, `trapezoid`, `pentagon`, `hexagon`, `star5`, `heart`, `cross`, `foldedRect` |
| Block arrows | `arrowRight`, `arrowLeft`, `arrowUp`, `arrowDown`, `arrowBoth`, `chevron`, `notchedArrow` |
| Diagram symbols | `braceLeft`, `braceRight` |

Notes:

- Create a rounded rectangle with `shapeKind: "rect"` and a non-zero `radius`.
- Arrows, diamonds, and similar shapes reserve a safe text area automatically, but the AI must still keep labels concise.
- Braces are open paths. Prefer `fill: "transparent"`, increase `strokeWidth` as needed, and put the explanation in a separate `text` element.
- Legacy `rect`, `roundRect`, `ellipse`, and `diamond` element types are migrated to `basicShape`. Do not emit those legacy types in new files.

## Text: `text`

A `text` element uses the common fields, but its fill is rendered as transparent. Typical values:

```json
{
  "id": "title",
  "type": "text",
  "x": 80,
  "y": 40,
  "w": 760,
  "h": 56,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "text": "System Processing Flow",
  "fontSize": 34,
  "fontWeight": 800,
  "fontFamily": "HarmonyOS Sans SC",
  "italic": false,
  "textColor": "#0b2d5c",
  "fill": "transparent",
  "stroke": "transparent",
  "strokeWidth": 0,
  "radius": 0,
  "align": "left",
  "vAlign": "center",
  "textOffsetX": 0,
  "textOffsetY": 0,
  "padding": 0,
  "dash": false,
  "shadow": false
}
```

## Formulas: `formula`

A `formula` element stores an editable LaTeX formula rendered by KaTeX. It does not use the normal `text` or `fontFamily` fields.

```json
{
  "id": "energy-equation",
  "type": "formula",
  "x": 340,
  "y": 160,
  "w": 260,
  "h": 90,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "latex": "E = mc^2",
  "displayMode": true,
  "fontSize": 32,
  "textColor": "#0b2d5c",
  "formulaTemplateId": null,
  "formulaValues": null,
  "fill": "transparent",
  "stroke": "transparent",
  "strokeWidth": 0,
  "shadow": false
}
```

- `latex` must be valid KaTeX-supported LaTeX.
- `displayMode` uses display math when `true` and inline math when `false`.
- A `fontSize` between 20 and 48 is typical. Increase `w` and `h` for matrices and piecewise expressions.
- `formulaTemplateId` and `formulaValues` are legacy compatibility fields from the old form-based editor. The visual editor now edits `latex` directly and supports arbitrary nesting; new projects should omit them or set them to `null`.
- Formula backgrounds and outlines are transparent by default. Applying a theme changes only `textColor`.

## Notes: `note`

A note is a callout block with a folded lower-right corner. It uses the common fields. Recommended dimensions are at least 180 x 120. Default style:

```json
{
  "type": "note",
  "fill": "#fff2a8",
  "stroke": "#b78c18",
  "strokeWidth": 2,
  "radius": 8,
  "shadow": true
}
```

## Group Backgrounds

When a visible boundary is needed, use a rectangular `basicShape` with `dash: true`; do not generate a separate `group` element. True membership, grouped movement, and automatic stacking are handled only by top-level `groups`. The editor still reads legacy `group` elements for backward compatibility.

## True Groups: `groups`

```json
"groups": [
  {
    "id": "group-a",
    "name": "Group 1",
    "memberIds": ["node-a", "node-b"],
    "autoStack": true,
    "stackX": 12,
    "stackY": 12
  }
]
```

- `memberIds` contains element references; every member's `groupId` should equal the group `id`.
- Group IDs must be unique and each element may belong to only one group. Groups are flat: do not reference another group ID as a member.
- Members retain absolute canvas coordinates. Do not add group-level `x/y/w/h/rotation` or apply another transform. Drawing order follows `elements`, not the order of `memberIds`.
- Automatic stacking follows the back-to-front order in `elements`, using the first member as the anchor.
- Give members their intended absolute `x/y` positions in generated JSON. `autoStack` configures later editing behavior; it does not replace initial layout. Do not place all members at one position and expect export to lay them out.
- Positive `stackX` moves right and negative values move left. Positive `stackY` moves up and negative values move down.
- Do not put connectors in a true group. Bound connectors can still follow their endpoint elements.
- When the user requests editable PPTX, keep each group's members contiguous in `elements` where possible to retain grouping and occlusion together. Do not change the requested composition merely to avoid a prompt; explain any tradeoff. Export options belong in [README.en.md](README.en.md#file-export-and-pptx-compatibility).

## Images: `image`

Images add these fields to the common element fields:

| Field | Description |
| --- | --- |
| `src` | A valid embedded `data:image/...` Data URL or a safe repository-relative `assets/` path. Ordinary images do not accept remote HTTP(S) URLs, `file://`, or paths containing `..`. |
| `fit` | `cover` or `contain`. The editor defaults to `cover`. |
| `text` | Optional bottom caption. A non-empty value displays a dark caption strip in the editor. |
| `crop` | `null` or `{x,y,w,h}` in original-image 0-1 coordinates: `x/y >= 0`, `w/h > 0`, and the entire rectangle must stay inside the image. |
| `flipX` / `flipY` | Booleans for horizontal and vertical flipping. |
| `transparentColor` | `null` or `#RRGGBB`. Makes pixels near the selected color transparent; this is not semantic background removal. |
| `colorTolerance` | Integer from 0 to 255, default 24. Zero means an exact RGB match. |

If real image data is unavailable, do not invent Base64 or use a remote image URL. Create a labeled `basicShape` placeholder and let the user import an actual image. Browser AI image additions must reference a trusted current `assetId`, not submit `src` directly; this differs from the `src` stored in complete project JSON. Token image pooling has separate `colorImage` rules that do not relax the ordinary-image source policy.

## Token Matrices: `tokenGrid`

Use token matrices to represent sequences, feature maps, model tokens, matrices, or multichannel data.

```json
{
  "id": "tokens",
  "type": "tokenGrid",
  "x": 180,
  "y": 300,
  "w": 280,
  "h": 28,
  "rotation": 0,
  "opacity": 1,
  "visible": true,
  "locked": false,
  "text": "",
  "rows": 1,
  "cols": 8,
  "depthCount": 1,
  "cellW": 28,
  "cellH": 28,
  "gapX": 8,
  "gapY": 8,
  "token3d": false,
  "extrude": 10,
  "stackX": 12,
  "stackY": 12,
  "colorMode": "solid",
  "colorChannels": ["color"],
  "cellColors": ["#e8f1fb", "#e8f1fb", "#e8f1fb", "#e8f1fb", "#e8f1fb", "#e8f1fb", "#e8f1fb", "#e8f1fb"],
  "cellColorIndex": 0,
  "gradientEditLayer": 0,
  "gradientLayers": [{"tl":"#ffffff","tr":"#e8f1fb","bl":"#c8d9ee","br":"#f5f9ff"}],
  "fill": "#e8f1fb",
  "stroke": "#165d9c",
  "strokeWidth": 2,
  "radius": 2,
  "dash": false,
  "shadow": false
}
```

### Token Matrix Constraints

- `rows`, `cols`: 1-100.
- `depthCount`: 1-20. It controls stacked layers; image pooling uses the number of `colorChannels` layers.
- `cellW`, `cellH`: 4-200.
- `gapX`, `gapY`, `extrude`, `stackX`, `stackY`: 0-200.
- `token3d`: Whether to draw 3D top and side faces.
- For total dimensions, use `layers = depthCount` outside image mode and `layers = colorChannels.length` in image mode. Treat `extrude` as 0 when `token3d: false`; it adds no edge margin in that case.
- Approximate total width: `cols * cellW + (cols - 1) * gapX + extrude + (layers - 1) * stackX`.
- Approximate total height: `rows * cellH + (rows - 1) * gapY + extrude + (layers - 1) * stackY`.
- The AI should set `w` and `h` to match those total dimensions.

Image-pooling mode uses `colorMode: "image"` and requires editor-computed fields such as `colorImage`, `poolColors`, `poolRows`, and `poolCols`. Unless those values already exist in the input, generate `solid` mode and let the user upload and pool an image in the editor.

`colorChannels` can contain `r`, `g`, `b`, `a`, `color`, and `gray`, ordered from the top layer downward.

Use `colorMode: "cells"` for independent cell colors. Store `rows * cols` hexadecimal colors in row-major `cellColors`; `cellColorIndex` only records the editor's current cell. Use `colorMode: "gradient"` for a four-corner gradient. Store `tl`, `tr`, `bl`, and `br` in `gradientLayers` for each depth layer; the renderer uses two-dimensional bilinear interpolation. When generating JSON, keep these array lengths consistent with the matrix dimensions.

## Single 3D Tokens: `token`

The renderer retains compatibility with `token`, which uses the normal common fields. Recommended values are 64 x 42, `radius: 2`, a dark fill, and white text. The toolbar now focuses on the more capable `tokenGrid`, so prefer `tokenGrid` in new drawings.

## Connectors: `connector`

```json
{
  "id": "edge-input-process",
  "type": "connector",
  "x": 0,
  "y": 0,
  "fromX": 280,
  "fromY": 240,
  "toX": 520,
  "toY": 240,
  "fromId": "input",
  "fromSide": "right",
  "toId": "process",
  "toSide": "left",
  "route": "orthogonal",
  "routeBias": "horizontal",
  "routePoints": [],
  "curveControls": null,
  "stroke": "#0b2d5c",
  "strokeWidth": 2,
  "dash": false,
  "arrowStartStyle": "none",
  "arrowEndStyle": "triangle",
  "arrowWidth": 14,
  "arrowLength": 18,
  "visible": true,
  "locked": false
}
```

### Connector Rules

- `route`: `straight`, `orthogonal`, or `curve`.
- `routeBias`: Preferred automatic orthogonal direction, either `horizontal` or `vertical`. Bound endpoint sides also influence the first and last segments.
- `routePoints`: Manual orthogonal routing points such as `[{"x": 420, "y": 300}]`. An empty array uses the minimum automatic bend count; **Add detour** and the green segment handles write these points.
- `curveControls`: Curve-handle vectors relative to the start and end endpoints, such as `{"from":{"x":80,"y":-40},"to":{"x":-80,"y":40}}`. Each vector controls both the endpoint lead-in direction and the curve tangent; use `null` for automatic curvature.
- `arrowStartStyle` / `arrowEndStyle`: Start and end marker styles. Allowed values are `none`, `triangle`, `stealth`, `open`, `diamond`, and `circle`; `none` disables that marker.
- `arrowWidth` / `arrowLength`: Arrow width and length (4..100, default 14 and 18). Enables thick lines with small arrows, with independent canvas control handles and property inputs. New connectors default to 14 and 18. Old projects without size fields retain their stroke-scaled markers; setting a dimension makes it independent. SVG, PNG and PPTX exports preserve actual dimensions.
- `strokeWidth`: Connector line width is a finite nonnegative number with no fixed upper limit; 0 hides the shaft. Arrow tips stay at the logical endpoints and the shaft is clipped at their joins to prevent thick lines protruding.
- `fromId` / `toId`: IDs of bound elements. Omit them or set them to `null` for unbound endpoints.
- `fromSide` / `toSide`: `left`, `right`, `top`, or `bottom`.
- `fromX/Y`, `toX/Y`: Actual coordinates for unbound endpoints and fallback coordinates for bound endpoints. Always provide sensible values.
- When an element rotates, its bound anchors rotate around the element center and connectors follow automatically.
- A left-to-right flow normally connects `right` to `left`. A top-to-bottom flow normally connects `bottom` to `top`.
- `orthogonal` automatically uses the minimum bend count based on endpoint direction and can use `routePoints` to avoid nodes. Use the control-handle `curve` route in dense crossing regions.
- Choose non-`none` values for both `arrowStartStyle` and `arrowEndStyle` for a bidirectional relationship. Legacy `arrowStart` / `arrowEnd` booleans remain import-compatible.
- A connector cannot bind to another connector.

## Themes and Color Palettes

The engine has 120 themes. `canvas.theme` accepts an index from 0 to 119. The theme is only the currently selected palette; the `fill`, `stroke`, and `textColor` stored on each element determine its rendered appearance. The editor rewrites colors only when the user clicks **Apply to all elements** or **Apply to selected elements**.

Each theme contains five color slots:

1. Primary text and connector color.
2. Main accent and common outline color.
3. Light node fill.
4. Secondary accent and note fill.
5. Neutral background or group fill.

The 20 base palettes are listed below. Theme index `i` uses base palette `i % 20`:

| Base | Five-color palette |
| --- | --- |
| 0 Deep Sea Blue + Orange | `#0b2d5c` `#165d9c` `#e8f1fb` `#f69d3c` `#ffffff` |
| 1 Grape + Amber | `#4c1d95` `#7c3aed` `#f3efff` `#f59e0b` `#ffffff` |
| 2 Forest + Orange | `#064e3b` `#059669` `#e7f8f1` `#f97316` `#ffffff` |
| 3 Berry + Sky | `#831843` `#db2777` `#fdf2f8` `#0ea5e9` `#ffffff` |
| 4 Clear Sky + Scarlet | `#172554` `#2563eb` `#eff6ff` `#ef4444` `#ffffff` |
| 5 Graphite + Green | `#3f3f46` `#71717a` `#f4f4f5` `#22c55e` `#ffffff` |
| 6 Dune + Lake Blue | `#713f12` `#ca8a04` `#fefce8` `#0284c7` `#ffffff` |
| 7 Aurora + Coral | `#164e63` `#0891b2` `#ecfeff` `#e11d48` `#ffffff` |
| 8 Wisteria + Lime | `#3b0764` `#9333ea` `#faf5ff` `#84cc16` `#ffffff` |
| 9 Terracotta + Teal | `#7f1d1d` `#dc2626` `#fef2f2` `#0d9488` `#ffffff` |
| 10 Rock Gray + Indigo | `#1f2937` `#475569` `#f1f5f9` `#6366f1` `#ffffff` |
| 11 Mint + Coral | `#134e4a` `#14b8a6` `#f0fdfa` `#f43f5e` `#ffffff` |
| 12 Magenta + Cyan | `#4a044e` `#c026d3` `#fdf4ff` `#06b6d4` `#ffffff` |
| 13 Sunset + Indigo | `#422006` `#ea580c` `#fff7ed` `#4f46e5` `#ffffff` |
| 14 Cloud Sky + Purple | `#0c4a6e` `#0ea5e9` `#f0f9ff` `#a855f7` `#ffffff` |
| 15 Tundra + Amber | `#365314` `#65a30d` `#f7fee7` `#d97706` `#ffffff` |
| 16 Midnight + Sakura | `#312e81` `#4f46e5` `#eef2ff` `#ec4899` `#ffffff` |
| 17 Rose + Mint | `#881337` `#e11d48` `#fff1f2` `#10b981` `#ffffff` |
| 18 Ink Black + Orange | `#27272a` `#18181b` `#fafafa` `#f97316` `#ffffff` |
| 19 Pine + Purple | `#052e16` `#16a34a` `#f0fdf4` `#7c3aed` `#ffffff` |

Theme names combine 20 hue-family names that match their actual colors with six tone levels. Examples include `深海蓝橙 · 标准 001`, `葡萄琥珀 · 标准 002`, and `深海蓝橙 · 沉静 021`. Each hue family provides Standard, Calm, Balanced, Bright, Clear, and Light variants.

When generating a drawing, select colors directly from one base palette and use the same color for the same meaning. Do not set only `canvas.theme` while omitting element colors.

## Theme Application Rules

When a user applies a theme, the engine recolors elements as follows:

- Connectors use color slot 1.
- Plain text and formulas use color slot 1 for text or formula color.
- Notes use color slot 4 for fill, a darker derivative for the outline, and color slot 1 for text.
- Rectangles used as group backgrounds use color slot 5 for fill, color slot 2 for the outline, and color slot 1 for text.
- Other elements primarily alternate between slots 2 and 3, with some elements using slot 4 as an accent.

## Composition Guidance

- Keep the main process nodes visually consistent. Use fill colors to distinguish inputs, processing, and outputs.
- Use diamonds for decisions, image frames for external visual data, and notes for explanations.
- Large groups should provide background and boundaries. Avoid turning every small node into a visually heavy card.
- Create at least one font-size level between the main title and node titles.
- Pair light fills with dark text and dark fills with white text.
- Keep line widths, corner radii, and shadow usage consistent. Publication figures usually benefit from 1-2 px outlines and restrained shadows.
- Align repeated structures and reuse identical `w`, `h`, spacing, and colors.
- Leave at least 40 px around the canvas edges, plus extra room for shadows and thick outlines.
- Do not route connectors through labels or important nodes. Reposition nodes instead of adding excessive bends.

## Complete Minimal Example

```json
{
  "version": 12,
  "name": "Three-Stage Processing Flow",
  "canvas": {
    "width": 1100,
    "height": 620,
    "bg": "#ffffff",
    "grid": false,
    "gridSize": 20,
    "snap": true,
    "theme": 0
  },
  "elements": [
    {
      "id": "title",
      "type": "text",
      "x": 70,
      "y": 45,
      "w": 960,
      "h": 55,
      "rotation": 0,
      "opacity": 1,
      "visible": true,
      "locked": false,
      "text": "Three-Stage Processing Flow",
      "fontSize": 32,
      "fontWeight": 800,
      "fontFamily": "HarmonyOS Sans SC",
      "italic": false,
      "textColor": "#0b2d5c",
      "fill": "transparent",
      "stroke": "transparent",
      "strokeWidth": 0,
      "radius": 0,
      "align": "left",
      "vAlign": "center",
      "textOffsetX": 0,
      "textOffsetY": 0,
      "padding": 0,
      "dash": false,
      "shadow": false
    },
    {
      "id": "edge-1",
      "type": "connector",
      "x": 0,
      "y": 0,
      "fromX": 320,
      "fromY": 300,
      "toX": 450,
      "toY": 300,
      "fromId": "input",
      "fromSide": "right",
      "toId": "process",
      "toSide": "left",
      "route": "orthogonal",
      "stroke": "#0b2d5c",
      "strokeWidth": 2,
      "dash": false,
      "arrowStartStyle": "none",
      "arrowEndStyle": "triangle",
      "visible": true,
      "locked": false
    },
    {
      "id": "edge-2",
      "type": "connector",
      "x": 0,
      "y": 0,
      "fromX": 650,
      "fromY": 300,
      "toX": 780,
      "toY": 300,
      "fromId": "process",
      "fromSide": "right",
      "toId": "output",
      "toSide": "left",
      "route": "orthogonal",
      "stroke": "#0b2d5c",
      "strokeWidth": 2,
      "dash": false,
      "arrowStartStyle": "none",
      "arrowEndStyle": "triangle",
      "visible": true,
      "locked": false
    },
    {
      "id": "input",
      "type": "basicShape",
      "shapeKind": "rect",
      "x": 100,
      "y": 250,
      "w": 220,
      "h": 100,
      "rotation": 0,
      "opacity": 1,
      "visible": true,
      "locked": false,
      "text": "Input Data",
      "fontSize": 20,
      "fontWeight": 700,
      "fontFamily": "HarmonyOS Sans SC",
      "italic": false,
      "textColor": "#0b2d5c",
      "fill": "#e8f1fb",
      "stroke": "#165d9c",
      "strokeWidth": 2,
      "radius": 12,
      "align": "center",
      "vAlign": "center",
      "textOffsetX": 0,
      "textOffsetY": 0,
      "padding": 8,
      "dash": false,
      "shadow": true
    },
    {
      "id": "process",
      "type": "basicShape",
      "shapeKind": "rect",
      "x": 450,
      "y": 250,
      "w": 200,
      "h": 100,
      "rotation": 0,
      "opacity": 1,
      "visible": true,
      "locked": false,
      "text": "Feature Processing",
      "fontSize": 20,
      "fontWeight": 700,
      "fontFamily": "HarmonyOS Sans SC",
      "italic": false,
      "textColor": "#ffffff",
      "fill": "#165d9c",
      "stroke": "#0b2d5c",
      "strokeWidth": 2,
      "radius": 12,
      "align": "center",
      "vAlign": "center",
      "textOffsetX": 0,
      "textOffsetY": 0,
      "padding": 8,
      "dash": false,
      "shadow": true
    },
    {
      "id": "output",
      "type": "basicShape",
      "shapeKind": "rect",
      "x": 780,
      "y": 250,
      "w": 220,
      "h": 100,
      "rotation": 0,
      "opacity": 1,
      "visible": true,
      "locked": false,
      "text": "Output Result",
      "fontSize": 20,
      "fontWeight": 700,
      "fontFamily": "HarmonyOS Sans SC",
      "italic": false,
      "textColor": "#0b2d5c",
      "fill": "#f69d3c",
      "stroke": "#165d9c",
      "strokeWidth": 2,
      "radius": 12,
      "align": "center",
      "vAlign": "center",
      "textOffsetX": 0,
      "textOffsetY": 0,
      "padding": 8,
      "dash": false,
      "shadow": true
    }
  ],
  "groups": []
}
```

## Preflight Checklist

Before returning the final JSON, confirm all of the following:

- The JSON parses strictly and contains no comments, trailing commas, `NaN`, or `undefined`.
- `version` is 12, and `canvas`, `elements`, and `groups` exist.
- Every `id` is unique, and every connector reference points to an existing element.
- All `shapeKind`, `route`, `align`, `vAlign`, and connector-side enum values are valid.
- Every element boundary is inside the canvas with room for shadows and outlines.
- Text fits its container, and long labels use line breaks.
- Layer ordering is correct: backgrounds first, content later.
- `groups[].memberIds` and member `groupId` agree in both directions, with no nesting or multiple memberships. For PPTX, avoid interleaving group members with outside objects where possible.
- Elements with the same semantic role use consistent colors, font sizes, radii, line widths, and shadows.
- Ordinary image `src` values are real embedded Data URLs or safe `assets/` paths, not remote URLs. Crop rectangles stay inside the original image.
- Token matrix `w` and `h` match its rows, columns, cell dimensions, spacing, and layer offsets.
- Every `formula.latex` value parses successfully in KaTeX, and its container is large enough.
- The final response contains only the JSON object.
