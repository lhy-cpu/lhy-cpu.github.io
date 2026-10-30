# FlowSketch JSON 生成规范

[English](draw.en.md) | 简体中文

本文档供 AI 或自动化程序读取。目标是根据用户的自然语言需求生成可直接导入 FlowSketch 的项目 JSON。

## 你的任务

你是 FlowSketch 绘图代理。收到用户描述后：

1. 提取图中实体、层级、流程方向、分组、连接关系、强调信息和图片需求。
2. 先规划画布、网格、留白、元素尺寸和视觉层级，再计算坐标。
3. 为每个元素生成唯一且稳定的 `id`。
4. 用 `elements` 数组顺序表达图层：数组前部在底层，数组尾部在顶层。
5. 连接线优先绑定到元素 ID 和四向吸附点，不要只写死端点坐标。
6. 检查所有元素均在画布内、文字可容纳、连接线指向正确、颜色有足够对比度。
7. 最终只输出一个合法 JSON 对象。除非用户明确要求解释，否则不要输出 Markdown 代码围栏、注释或 JSON 之外的文字。

FlowSketch 会补齐部分缺省字段，但 AI 应尽量输出完整字段，以保证结果稳定。

本规范描述供导入的完整项目 JSON，不是网页 AI 的编辑指令格式。网页 AI 使用 `operations` 或 `edit_canvas`，字段和预算以实时共享契约为准，见 [AI.md](AI.md)。本规范重点是如何构图并生成合法、可编辑的项目数据；网页操作与文件导出流程见 [README.md](README.md)。

## 顶层格式

```json
{
  "version": 12,
  "name": "项目名称",
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

### 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 当前格式版本固定为 `12`。 |
| `name` | string | 文件列表和导出文件名使用的项目名称。 |
| `canvas.width` | number | 画布宽度，编辑器限制为 200-6000。常用 1200-1800。 |
| `canvas.height` | number | 画布高度，编辑器限制为 200-6000。常用 700-1200。 |
| `canvas.bg` | CSS color | 画布背景，建议使用十六进制颜色。 |
| `canvas.grid` | boolean | 是否显示网格。启用时拖动会吸附网格。 |
| `canvas.gridSize` | number | 网格间距，界面限制为 5-100。 |
| `canvas.snap` | boolean | 是否启用元素对齐和连接点吸附。通常为 `true`。 |
| `canvas.theme` | integer | 当前主题索引，范围 0-119。主题不会自动覆盖元素颜色。 |
| `elements` | array | 所有图形和连接线，按从底层到顶层排列。 |
| `groups` | array | 真正的组合关系；成员仍保留在 `elements` 中。 |

## 坐标与布局

- 原点 `(0, 0)` 在画布左上角，X 向右，Y 向下，单位为像素。
- 普通元素的位置和未旋转尺寸由 `x`、`y`、`w`、`h` 表示。
- `rotation` 以元素中心为旋转中心，单位为度，正值顺时针。
- 相邻主要节点建议保留 70-140 像素间距；分组内边距建议 24-40 像素。
- 正文建议 16-20 px，组标题 20-26 px，主标题 28-40 px。
- 文本较长时优先增大元素宽高或主动使用 `\n` 换行，不要依赖溢出。
- 先放分组背景，再放节点和文字，最后放需要置顶的标注；连接线通常放在节点之前，使节点覆盖线端。
- 技术图默认采用左到右或上到下的单一主方向，避免无意义交叉线。

## 普通元素公共字段

以下字段适用于除 `connector` 外的大多数元素：

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
  "text": "节点文字",
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

| 字段 | 允许值或建议 |
| --- | --- |
| `id` | 非空唯一字符串。连接线通过它绑定元素。 |
| `type` | `basicShape`、`text`、`formula`、`note`、`image`、`tokenGrid`、`token` 或 `connector`。 |
| `opacity` | 0-1。背景分组常用 0.5-0.8，普通节点通常为 1。 |
| `visible` | `false` 时不渲染。 |
| `locked` | `true` 时用户不能直接拖动该元素。 |
| `colorMode` | 普通可填充元素使用 `solid` 或 `gradient`；`tokenGrid` 另有更完整的模式。 |
| `gradientColors` | 四角颜色对象，包含 `tl`、`tr`、`bl`、`br`。仅在 `colorMode: "gradient"` 时使用。 |
| `groupId` | 所属组合 ID；未组合时为 `null`。必须与顶层 `groups` 中的记录一致。 |
| `fontWeight` | 界面常用 400、600、700、800。 |
| `italic` | 是否使用斜体。 |
| `strokeWidth` | 0-12。普通节点建议 1-3。 |
| `radius` | 圆角半径；对 `basicShape` 的矩形有效。 |
| `align` | `left`、`center`、`right`。 |
| `vAlign` | `top`、`center`、`bottom`。 |
| `textOffsetX/Y` | 文字相对元素中心的额外像素偏移。通常为 0。 |
| `padding` | 文本内边距。默认 8。 |
| `dash` | 是否使用虚线描边。 |
| `shadow` | 是否显示阴影。大量小元素建议关闭。 |

普通可填充元素的四角渐变与 Token 矩阵一致，内部颜色按横向、纵向二维线性插值生成。公式、纯文字和连接线不使用填充渐变。

## 基础图形 `basicShape`

在公共字段上增加 `shapeKind`：

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
  "text": "是否通过？",
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

`shapeKind` 可用值：

| 类别 | 值 |
| --- | --- |
| 基础 | `rect`、`ellipse`、`diamond`、`triangle`、`rightTriangle`、`parallelogram`、`trapezoid`、`pentagon`、`hexagon`、`star5`、`heart`、`cross`、`foldedRect` |
| 块箭头 | `arrowRight`、`arrowLeft`、`arrowUp`、`arrowDown`、`arrowBoth`、`chevron`、`notchedArrow` |
| 图示符号 | `braceLeft`、`braceRight` |

注意：

- 普通圆角矩形使用 `shapeKind: "rect"` 配合 `radius`。
- 箭头、菱形等会为文字自动保留安全区域，但 AI 仍应控制文字长度。
- 大括号是开放路径，建议 `fill: "transparent"`、适当增加 `strokeWidth`，并将说明文字放在独立 `text` 元素中。
- 旧格式中的 `rect`、`roundRect`、`ellipse`、`diamond` 类型会被迁移为 `basicShape`，新文件不要再使用旧类型。

## 文字 `text`

`text` 元素使用普通元素公共字段，但填充会被渲染为透明，通常设置：

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
  "text": "系统处理流程",
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

## 公式 `formula`

`formula` 元素用于插入可继续编辑的 LaTeX 公式。公式由 KaTeX 排版，不使用普通元素的 `text` 和 `fontFamily` 字段。

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

- `latex` 是 KaTeX 支持的 LaTeX 源码，必须能被严格解析。
- `displayMode` 为 `true` 时按独立公式排版；`false` 时按行内公式排版。
- `fontSize` 建议 20-48，复杂矩阵或分段函数应增加 `w`、`h`。
- `formulaTemplateId` 和 `formulaValues` 是旧版填空编辑器的兼容字段。新版可视化编辑器直接编辑 `latex` 并支持任意嵌套；新项目应设为 `null` 或省略。
- 公式默认透明背景、无描边。主题应用只修改 `textColor`。

## 便签 `note`

便签是右下角折角的说明块。字段与普通元素相同，推荐尺寸不小于 180 x 120，默认风格：

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

## 组合背景

需要可见边界时，使用矩形 `basicShape` 并设置 `dash: true`，不要生成单独的 `group` 元素。真正的成员关系、整体移动和自动堆叠统一由顶层 `groups` 管理。编辑器仍可读取旧项目中的 `group` 元素，但它仅用于向后兼容。

## 真正的组合 `groups`

```json
"groups": [
  {
    "id": "group-a",
    "name": "组合 1",
    "memberIds": ["node-a", "node-b"],
    "autoStack": true,
    "stackX": 12,
    "stackY": 12
  }
]
```

- `memberIds` 按引用存储成员；成员的 `groupId` 应等于组合 `id`。
- 组合 ID 必须唯一；一个元素只能属于一个组合。组合是扁平关系，不支持把组合 ID 当作另一个组合的成员。
- 成员仍使用画布绝对坐标；不要给组合添加 `x/y/w/h/rotation` 或再次套用坐标变换。`memberIds` 的顺序不是绘制顺序，实际图层顺序以 `elements` 为准。
- 自动堆叠按 `elements` 的图层顺序从底到顶排列，以第一个成员为基准。
- 生成 JSON 时先给成员填写最终所需的绝对 `x/y`；`autoStack` 是后续编辑行为的设置，不代替初始布局，不能把所有成员放在同一点等待导出器排版。
- `stackX` 的正值向右，负值向左；`stackY` 的正值向上，负值向下，单位为像素。
- 连接线不应作为组合成员；连接线仍可通过端点绑定跟随图形。
- 用户要求可编辑 PPTX 时，尽量让每个组合的成员在 `elements` 中连续，不穿插外部对象，以同时保留组合与遮挡顺序。不要仅为避免提示改变用户要求的构图；遇到两者冲突应说明取舍，实际导出选项见 [README.md](README.md#文件导出与-pptx-兼容性)。

## 图片 `image`

图片在普通字段上增加：

| 字段 | 说明 |
| --- | --- |
| `src` | 合法的内嵌 `data:image/...` Data URL，或仓库中的安全 `assets/` 相对路径；普通图片不接受远程 HTTP(S) URL、`file://` 或含 `..` 的路径。 |
| `fit` | `cover` 或 `contain`。界面默认 `cover`。 |
| `text` | 可选图片底部说明；非空时编辑器显示深色字幕条。 |
| `crop` | `null` 或 `{x,y,w,h}`，使用原图 0-1 归一化坐标；`x/y >= 0`、`w/h > 0`，且整个范围必须在图内。 |
| `flipX` / `flipY` | 布尔值，分别水平、垂直翻转。 |
| `transparentColor` | `null` 或 `#RRGGBB`；将与目标颜色相近的像素变透明，不是语义抠图。 |
| `colorTolerance` | 0-255 的整数，默认 24；0 表示 RGB 精确匹配。 |

AI 无法取得真实图片数据时，不要捏造 Base64 或填入远程图片 URL；用带说明文字的 `basicShape` 占位，让用户通过网页导入真实图片。网页 AI 新增图片必须引用本次可信参考图的 `assetId`，不能直接提交 `src`；这与完整项目 JSON 中存储的 `src` 不同。Token 图片池化的 `colorImage` 有独立规则，不能据此放开普通图片的来源限制。

## Token 矩阵 `tokenGrid`

适合表示序列、特征图、模型 Token、矩阵或多通道数据。

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

### Token 矩阵约束

- `rows`、`cols`: 1-100。
- `depthCount`: 1-20，决定叠加层数；图片池化模式由 `colorChannels` 层数决定。
- `cellW`、`cellH`: 4-200。
- `gapX`、`gapY`、`extrude`、`stackX`、`stackY`: 0-200。
- `token3d`: 是否绘制立体顶面和侧面。
- 计算总尺寸时，非图片模式的 `layers = depthCount`，图片模式的 `layers = colorChannels.length`；`token3d: false` 时 `extrude` 按 0 计算，不增加边缘留白。
- 总宽约为 `cols * cellW + (cols - 1) * gapX + extrude + (layers - 1) * stackX`。
- 总高约为 `rows * cellH + (rows - 1) * gapY + extrude + (layers - 1) * stackY`。
- AI 生成时应让 `w`、`h` 与上述总尺寸一致。

图片池化模式使用 `colorMode: "image"`，并需要 `colorImage`、`poolColors`、`poolRows`、`poolCols` 等由编辑器计算的字段。除非输入中已经提供这些数据，否则 AI 应生成 `solid` 模式，让用户在编辑器中上传图片后池化。

`colorChannels` 可按层从上到下选择 `r`、`g`、`b`、`a`、`color`、`gray`。

独立单元格模式使用 `colorMode: "cells"`，`cellColors` 按行优先存储 `rows * cols` 个十六进制颜色；`cellColorIndex` 仅表示编辑器当前选中的小块。四角渐变模式使用 `colorMode: "gradient"`，`gradientLayers` 按层存储 `tl`、`tr`、`bl`、`br` 四个角色，矩阵内部按二维双线性插值。AI 生成时应让数组长度与行列、层数一致。

## 单个 3D Token `token`

渲染器兼容 `token`，其字段与普通元素一致。建议尺寸 64 x 42、`radius: 2`、较深填充色和白色文字。当前工具栏主要使用功能更完整的 `tokenGrid`，新图优先用 `tokenGrid`。

## 连接线 `connector`

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

### 连接规则

- `route`: `straight`、`orthogonal` 或 `curve`。
- `routeBias`: 折线自动走线的优先方向，允许 `horizontal` 或 `vertical`。端点已绑定时，引擎还会结合吸附边方向自动确定首尾段。
- `routePoints`: 手动折线路由点数组，格式为 `[{"x": 420, "y": 300}]`。空数组表示自动选择最简折数；编辑器中的“增加绕行段”和绿色段手柄会写入这些点。
- `curveControls`: 曲线控制杆相对首尾端点的向量，格式为 `{"from":{"x":80,"y":-40},"to":{"x":-80,"y":40}}`。控制向量同时决定端点引出直线方向和曲线切线；`null` 表示自动曲率。
- `arrowStartStyle` / `arrowEndStyle`: 首尾箭头样式，允许 `none`、`triangle`、`stealth`、`open`、`diamond`、`circle`。`none` 表示无箭头。
- `arrowWidth` / `arrowLength`: 箭头宽度与长度（4..100，默认 14 与 18）。支持粗线配小箭头，画布上有独立控制点和属性输入框进行自定义。 新建连接线默认 14 与 18；旧项目缺少尺寸字段时保留原来的随线宽缩放效果，设置对应尺寸后改为独立控制。SVG、PNG 和 PPTX 导出保留实际尺寸。
- `strokeWidth`: 连接线线宽为不小于 0 的有限数值，无固定上限；0 隐藏线身。箭头端点保持原位置，线身在接头处裁切，防止粗线从箭头尖端露出。
- `fromId` / `toId`: 绑定元素 ID。未绑定时可省略或设为 `null`。
- `fromSide` / `toSide`: `left`、`right`、`top`、`bottom`。
- `fromX/Y`、`toX/Y`: 未绑定时是实际端点；绑定时作为回退坐标，仍应填写合理值。
- 元素旋转后，绑定吸附点会围绕元素中心同步旋转，连接线会自动跟随。
- 从左到右流程通常使用 `fromSide: "right"` 和 `toSide: "left"`；从上到下使用 `bottom` 到 `top`。
- `orthogonal` 会根据端点方向自动选择最简折数，也可用 `routePoints` 绕开节点；复杂交叉区域可用带控制杆的 `curve`。
- 双向关系可为 `arrowStartStyle` 和 `arrowEndStyle` 同时选择非 `none` 样式；旧版 `arrowStart` / `arrowEnd` 布尔字段仍可导入。
- 连接线不能绑定到另一条连接线。

## 主题与配色

引擎有 120 个主题，`canvas.theme` 使用 0-119 的索引。主题只是当前调色板选择；JSON 中已有元素的 `fill`、`stroke` 和 `textColor` 决定实际渲染颜色。用户点击“应用到全部元素”或“应用到所选元素”时，编辑器才会用当前主题重写颜色。

每个主题包含 5 个颜色槽：

1. 主文字与连接线色。
2. 主强调色和常用描边色。
3. 浅色节点填充。
4. 次强调色和便签填充。
5. 中性背景或分组填充。

20 组基础调色板如下，索引 `i` 的基础组是 `i % 20`：

| 基础组 | 5 色调色板 |
| --- | --- |
| 0 深海蓝橙 | `#0b2d5c` `#165d9c` `#e8f1fb` `#f69d3c` `#ffffff` |
| 1 葡萄琥珀 | `#4c1d95` `#7c3aed` `#f3efff` `#f59e0b` `#ffffff` |
| 2 森林橙 | `#064e3b` `#059669` `#e7f8f1` `#f97316` `#ffffff` |
| 3 樱莓天青 | `#831843` `#db2777` `#fdf2f8` `#0ea5e9` `#ffffff` |
| 4 晴空朱红 | `#172554` `#2563eb` `#eff6ff` `#ef4444` `#ffffff` |
| 5 石墨青绿 | `#3f3f46` `#71717a` `#f4f4f5` `#22c55e` `#ffffff` |
| 6 沙丘湖蓝 | `#713f12` `#ca8a04` `#fefce8` `#0284c7` `#ffffff` |
| 7 极光珊瑚 | `#164e63` `#0891b2` `#ecfeff` `#e11d48` `#ffffff` |
| 8 紫藤青柠 | `#3b0764` `#9333ea` `#faf5ff` `#84cc16` `#ffffff` |
| 9 赤陶青 | `#7f1d1d` `#dc2626` `#fef2f2` `#0d9488` `#ffffff` |
| 10 岩灰靛蓝 | `#1f2937` `#475569` `#f1f5f9` `#6366f1` `#ffffff` |
| 11 薄荷珊瑚 | `#134e4a` `#14b8a6` `#f0fdfa` `#f43f5e` `#ffffff` |
| 12 洋红青 | `#4a044e` `#c026d3` `#fdf4ff` `#06b6d4` `#ffffff` |
| 13 落日靛蓝 | `#422006` `#ea580c` `#fff7ed` `#4f46e5` `#ffffff` |
| 14 云天紫 | `#0c4a6e` `#0ea5e9` `#f0f9ff` `#a855f7` `#ffffff` |
| 15 苔原琥珀 | `#365314` `#65a30d` `#f7fee7` `#d97706` `#ffffff` |
| 16 午夜樱粉 | `#312e81` `#4f46e5` `#eef2ff` `#ec4899` `#ffffff` |
| 17 玫瑰薄荷 | `#881337` `#e11d48` `#fff1f2` `#10b981` `#ffffff` |
| 18 墨黑橙 | `#27272a` `#18181b` `#fafafa` `#f97316` `#ffffff` |
| 19 松林紫 | `#052e16` `#16a34a` `#f0fdf4` `#7c3aed` `#ffffff` |

主题名称由 20 个与实际主色对应的色系名和 6 个明暗层次组成，例如 `深海蓝橙 · 标准 001`、`葡萄琥珀 · 标准 002`、`深海蓝橙 · 沉静 021`。每个色系依次提供标准、沉静、平衡、明亮、清透、轻盈六种层次。

AI 生成图时建议直接从一个基础调色板取色，并保证同一语义使用同一颜色。不要仅设置 `canvas.theme` 而省略元素颜色。

## 主题应用规则

当用户应用主题时，引擎按以下方式重着色：

- 连接线：使用颜色槽 1。
- 纯文字和公式：文字或公式使用颜色槽 1。
- 便签：填充使用颜色槽 4，描边为其加深色，文字使用颜色槽 1。
- 用作组合背景的矩形：填充使用颜色槽 5，描边使用颜色槽 2，文字使用颜色槽 1。
- 其他元素：主要在颜色槽 2 和 3 之间分配，部分元素用颜色槽 4 强调。

## 构图建议

- 主流程节点样式保持一致，输入、处理、输出可通过填充色区分。
- 决策使用菱形，外部数据或图片使用图片框，说明使用便签。
- 大分组只承担背景和边界，不要把每个小节点都做成独立厚重卡片。
- 主标题与节点标题至少形成一个字号层级差。
- 浅色填充配深色文字；深色填充配白色文字。
- 线宽、圆角和阴影数量要统一。论文图通常用 1-2 px 描边和克制阴影。
- 重复结构应对齐，并使用相同的 `w`、`h`、间距和颜色。
- 画布边缘至少保留 40 px；阴影和粗描边还需要额外空间。
- 不要让连接线穿过文字或关键节点。必要时调整节点位置，而不是堆叠更多折线。

## 完整最小示例

```json
{
  "version": 12,
  "name": "三阶段处理流程",
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
      "text": "三阶段处理流程",
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
      "text": "输入数据",
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
      "text": "特征处理",
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
      "text": "输出结果",
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

## 输出前检查

生成最终 JSON 前逐项确认：

- JSON 可被严格解析，不含注释、尾随逗号、`NaN` 或 `undefined`。
- `version` 为 12，`canvas`、`elements` 和 `groups` 存在。
- 所有 `id` 唯一，连接线引用的 ID 都存在。
- `shapeKind`、`route`、`align`、`vAlign` 和连接边枚举值合法。
- 所有元素的边界都在画布内，且给阴影和描边留有余量。
- 文字与容器尺寸匹配，长文本已换行。
- 图层顺序合理：背景在前、内容在后。
- `groups[].memberIds` 与成员 `groupId` 双向一致，没有嵌套或重复归属；若目标是 PPTX，已尽量避免组员与外部对象交错。
- 相同类别的颜色、字号、圆角、线宽和阴影一致。
- 普通图片 `src` 是真实有效的内嵌 Data URL 或安全 `assets/` 路径，不是远程 URL；图片裁切范围在原图内。
- Token 矩阵的 `w`、`h` 与行列、单元尺寸、间距和层叠参数一致。
- 每个 `formula.latex` 都能被 KaTeX 正确解析，且公式容器有足够宽高。
- 最终响应只包含 JSON 对象。
