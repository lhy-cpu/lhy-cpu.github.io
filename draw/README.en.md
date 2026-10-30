# FlowSketch

English | [简体中文](README.md)

FlowSketch is a browser editor for flowcharts and publication figures, including model architecture diagrams, token matrices, and technical illustrations containing images. Projects use a human-readable JSON format.

Built with HTML, CSS, and JavaScript, the project has no build step or required application backend. Drawing, file management, and export run in the browser, with scripts, styles, and fonts included in the repository. The optional AI assistant sends conversation and canvas context directly to a user-configured API by default, with an optional local relay; see [Data and Privacy](#data-and-privacy) for the complete data flow.

## Try Online

Try FlowSketch at any of these addresses:

- [draw.lhye.work](https://draw.lhye.work/)
- [github.lhye.work/draw](http://github.lhye.work/draw)
- [lhy-cpu.github.io/draw](https://lhy-cpu.github.io/draw/)

The hosted editor uses local browser storage. See [Data and Privacy](#data-and-privacy) for data sent when using AI.

![Transformer encoder–decoder diagram drawn with FlowSketch](assets/readme-example.png)

This diagram uses a 16:9 canvas and was drawn and exported with the FlowSketch online editor ([actual editor screenshot](assets/readme-editor.jpg)). Drop the [editable Transformer JSON](examples/transformer.json) into the editor to modify it. Architecture concepts follow [Attention Is All You Need](https://arxiv.org/abs/1706.03762); the diagram layout was created for this project.

## Key Features

- Basic shapes, block arrows, braces, text, LaTeX formulas, notes, and images
- Group management with create, join, leave, ungroup, and layer-ordered automatic stacking
- Straight, auto/manual orthogonal, and smoothly controlled curved connectors with five independently selectable marker styles at each end
- Token matrices, 3D stacks, image-pooling colors, and RGBA/color/grayscale channels
- Multiple selection, alignment, even distribution, layer ordering, rotation, and eight-direction resizing
- 120 built-in color themes that can be applied to the entire drawing or only the current selection
- Undo, redo, copy, paste, a canvas context menu, and common keyboard shortcuts
- Native PPTX, SVG, PNG, and JSON export
- Multi-file browser storage, drag-and-drop import, and autosave
- Optional AI assistant with canvas editing, streaming responses, tool calling, and image input

## Getting Started

Download the repository, keep `index.html` and `assets/` in their relative locations, and open `index.html` in a modern desktop browser for basic drawing. No npm dependencies are required.

Alternatively, start a local static file server from the project directory (requires Python 3):

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Visit [http://127.0.0.1:8765](http://127.0.0.1:8765). This server only serves static files; it provides no project upload or AI relay endpoint. A consistent address helps preserve browser storage. When opening files directly, storage, clipboard, and API cross-origin support depend on the browser.

1. Choose a shape, text, formula, connector, token matrix, note, or image from the left sidebar. Use a dashed rectangle when a visible boundary is needed.
2. Move, resize, or rotate elements on the canvas, then edit dimensions, colors, text, and styles in the right sidebar.
3. Drag a connector endpoint to reveal the four-way shape anchors. Add detours and drag green segment handles on orthogonal routes, or drag the orange handles on curves.
4. Use **“导出” (Export)** in the top bar to generate native PPTX, SVG, or PNG. Use **JSON** to inspect or download the current project data.

Projects are automatically saved to IndexedDB in the current browser profile. Clearing browser site data removes these local files, so export backups of important work regularly.

## File Export and PPTX Compatibility

Project backups and rendered deliverables use different entry points, as listed below. AI composition and project JSON fields are specified in [draw.en.md](draw.en.md) ([Chinese](draw.md)):

| Entry / format | Purpose |
| --- | --- |
| JSON → Download JSON, or export one selected file | Complete project data, including hidden objects and groups, for reimport and continued editing. |
| Export multiple selected files as ZIP | One JSON per project, restorable by drag-and-drop; not batch PPTX/SVG/PNG output. |
| Top-bar Export → SVG / PNG / native PPTX | Visible content of the current project. PNG's longest side is capped at 4096 pixels. These outputs do not replace JSON backups. |

PPTX preserves canvas dimensions and exports current geometry to a single slide; pixel-identical rendering is not guaranteed:

- **Native primitives**: basic shapes, text, token cells and 3D faces, and straight/orthogonal/curved paths remain editable; images use picture objects. Connector geometry survives, but browser endpoint-binding behavior is not guaranteed in PowerPoint.
- **Corners and shadows**: rectangular corner radii and ordinary shape outer shadows use native effects.
- **Four-corner gradients**: PNG texture fills clipped to native outlines replace the old center solid color. Geometry, text, and outlines stay editable, but the texture cannot be edited as four individual gradient corners.
- **Formulas**: supported structures become native Office Math (OMML) with transparent PNG compatibility fallbacks. Unsupported formulas remain whole pictures and are counted in the export notification. Native equations use Cambria Math, so typography, spacing, and wrapping can differ.
- **Image processing**: crop, flip, fit, and color-key transparency are baked into PNG pictures that can move, rotate, and resize; the original crop cannot be recovered from the PPTX.
- **Groups**: original groups become native PowerPoint groups, including expanded token primitives, without hidden members or reapplying automatic stacking.

If members are interleaved with outside objects, export pauses for three choices:

1. **Merge groups, preserve layers**: merge interleaved groups and intervening objects, possibly including connectors, into larger groups while preserving original stacking order and changing group boundaries.
2. **Preserve groups, allow layer changes**: keep original membership and place each group at its uppermost member layer, potentially changing occlusion.
3. **Cancel export**: download nothing and optionally adjust canvas layers first.

The choice affects only that PPTX, not the canvas. Without interleaving conflicts, original groups and order are retained directly.

Import the [native formula example](examples/native-math.json) to inspect seven expected native equations and one picture fallback. On 2026-10-30, local browser exports were checked in macOS PowerPoint for opening, equation editing state, corners/gradients/shadows, pictures/tokens, native groups, and both conflict-choice branches. This does not prove pixel fidelity for every parameter combination or replace separate Windows PowerPoint, WPS, and Keynote acceptance. Automated tests alone do not prove desktop editability.

## Browser AI Assistant

Use the top-right **AI** panel to configure an OpenAI-compatible Chat Completions endpoint, key, and model. Both JSON and tools modes are supported. Settings stay in the current browser; requests use the configured API directly by default, or your local relay when selected. Neither route relays through the webpage hosting server.

Enable **Model supports image input** to attempt a canvas screenshot when sending and after each successful edit. The model can inspect alignment, overlaps, text, and connectors. Screenshots include visible canvas images and text, hide grids and editing handles, and exclude chat, settings, and keys. Blank canvases omit screenshots.

Select elements and use **Send elements to chat** to specify targets. Automatic screenshots use the target bounds with surrounding padding. Reference images, screenshots, and pending attachments support zoom and region cropping; tools mode can inspect regions through `view_canvas` and `view_reference`. Specifying targets does not restrict structural context to those elements: the current canvas structure is still sent.

AI edits validate fields, references, and drawing budgets, and support undo/redo. Manual edits or file changes prevent stale replies from overwriting the new state. Each message allows up to eight model calls and four screenshot attempts, sharing the configured total timeout and Stop control. Conversation and screenshots stay in page memory and disappear on refresh. See [AI.md](AI.md) for settings, image limits, region coordinates, and API requirements (Chinese).

For direct cross-origin connections, the API must allow the page origin and `Content-Type` / `Authorization` headers through CORS. HTTPS pages may also block ordinary non-loopback HTTP endpoints. After a network/CORS failure, click **“使用本地转发” (Use local relay)**, or open download help from AI settings. The centered help dialog automatically selects the current Windows/macOS/Linux tab and lets you switch manually. Download **one standalone service file** for your existing environment: [server.ps1](tools/local-relay/server.ps1) for built-in Windows PowerShell/.NET, [server.cjs](tools/local-relay/server.cjs) for Node.js on macOS/Linux or other systems, or [server.py](tools/local-relay/server.py) if you have Python 3 instead. Each file runs independently, without a ZIP, launcher, or automatic installation.

Run the command shown in the dialog from the download directory, using the exact current page origin (`null` for `file://`). Examples: Windows `powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1 --origin https://draw.lhye.work`; Node.js `node ./server.cjs --origin https://draw.lhye.work`; Python `python3 ./server.py --origin https://draw.lhye.work` (or `py -3` on Windows). Replace the example origin with yours. The service generates its own startup token.

If Python 3 is already available, expand the no-download option to inspect and copy the full service source with its startup text. Paste it into the matching macOS/Linux shell or Windows PowerShell; no file download or save is needed. Expanding the Python no-download section only reads `server.py` as text from the current hosting origin; the webpage does not execute it. If a `file://` page cannot read that text, the dialog offers standalone downloads instead.

Select local relay mode, keep your original API URL/key/model, and enter the loopback URL (default `http://127.0.0.1:18765`) and startup token printed in the terminal. **Test local connection** only checks `GET /health`. The helper binds to loopback and checks the exact origin and token. The token stays in page memory and must be re-entered after refresh. HTTPS pages can contact HTTP loopback endpoints; allow the browser's local-network/loopback permission prompt. Browser or organization policies and CSP `connect-src` can still block access; ordinary public HTTP pages may lack the required secure context, so use HTTPS or a local static page. Do not disable browser security or install certificates. See [Chrome's official guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access) and [AI.md](AI.md#可选本地转发). No API key or model service is included.

## Formula Editing

Choose **Formula** in the left sidebar to insert a LaTeX formula. The editor provides these workflows:

- **Visual editing**: work directly in the typeset formula, click a dotted placeholder to fill it, and insert fractions, roots, scripts, integrals, matrices, cases, or other structures at any placeholder or cursor position. Structures can be nested without limit.
- **Categorized formula library**: browse structures, basic math, Greek letters, relations, operators, sets and logic, arrows, and calculus, or open the complete numeric, symbol, alphabetic, and Greek virtual keyboard.
- **LaTeX source**: type any KaTeX-supported LaTeX directly and switch back and forth with the visual editor.

The editor keeps LaTeX synchronized and reports syntax errors. Double-click a formula on the canvas to edit it again, or use the properties panel to change its size, color, rotation, and display mode. Formula data is stored in project JSON and participates in SVG, PNG, and clipboard-image export; PPTX follows the native-equation/picture fallback rules above.

## Files and Import

Click **“文件” (Files)** in the upper-right corner to open the file list. Creating or importing a project always creates an independent file and never overwrites an existing one. Continuing to edit the active file updates only that file.

- Files are sorted by modification time, newest first.
- Import JSON through the file picker or by dropping it onto the page. A ZIP previously exported by FlowSketch can also be dropped back onto the page to restore its projects.
- Dropped images are added to the active project as image elements.
- The file list supports multi-select deletion and export. Deletion always requires confirmation.
- One selected file exports as JSON. Multiple selected files export as a ZIP containing one independent JSON file per project.
- By default, FlowSketch prompts for cleanup when total storage reaches 10 MB or the library reaches 100 files. Both limits are configurable in the file list.

On first use of the new file library, a project saved by an older version in `localStorage` is migrated automatically into an independent file.

## Shortcuts

| Action | Shortcut or gesture |
| --- | --- |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Copy / paste | `Ctrl+C` / `Ctrl+V` |
| Duplicate | `Ctrl+D` |
| Delete elements | `Delete` or `Backspace` |
| Multi-select | `Shift` + click, or drag a selection box |
| Nudge / fast move | Arrow keys / `Shift` + arrow keys |
| Pan the canvas | Hold Space and drag, or use the middle mouse button |
| Snap rotation angle | Hold `Shift` while dragging the rotation handle |
| Open the canvas menu | Right-click inside the canvas |

When copying inside the canvas, FlowSketch retains editable element data and attempts to write a PNG to the system clipboard for pasting into other applications. System image clipboard support depends on browser permissions and how the page is opened.

## JSON and AI Generation

FlowSketch project JSON can be edited manually or generated by AI. See [draw.en.md](draw.en.md) for the complete field reference, element types, theme behavior, connector rules, and generation examples. The Chinese version is available at [draw.md](draw.md).

Importing JSON creates a new file. Clicking **“应用编辑内容” (Apply edited content)** in the **“项目 JSON” (Project JSON)** dialog updates the active file instead.

## Data and Privacy

**Drawing and static deployment require no application backend; the optional relay runs on the user’s computer.** The current code has no project upload, cloud synchronization, login, analytics, or telemetry endpoint. Ordinary drawing does not actively upload projects or API settings to the webpage hosting server.

| Scenario | Data flow |
| --- | --- |
| Drawing, importing local JSON/ZIP/images, autosave | Processed in the browser; projects, images, and file-library settings are stored locally in IndexedDB |
| JSON/ZIP/SVG/PNG/PPTX export | Generated and downloaded in the browser, without a server-side conversion endpoint |
| AI settings | API URL, key, model, connection mode, relay URL, and other options stay in the current origin's `localStorage`; the startup token stays only in page memory. Neither is included in exported projects |
| Sending an AI message | Direct browser POST by default. In relay mode the request contents, API URL, and key first go to the local helper, which POSTs to the configured API. Requests contain conversation history, current canvas structure (project name, text, element properties, groups, selection, etc.), model, and tool definitions in tools mode; a supplied key is sent as an `Authorization: Bearer …` header |
| AI image input | When enabled, reference attachments and canvas or region screenshots go to the same API through the selected connection mode. Screenshots include existing images visible in that region. Original image `src` and image-pooling data are excluded from structural context |
| Loading a project through `?project=…` | Requests the specified project address on page initialization; a remote server may record access metadata |
| External image references in imported content | Ordinary image elements accept embedded Data URLs or safe `assets/` paths. A token matrix's `colorImage` may retain a remote URL, which is requested when showing its thumbnail or resampling the image |
| Opening local relay help | Reads plain `server.py` text from the same hosting origin for the no-download instructions; sends no API key, startup token, or conversation to that origin |
| Visiting a hosted editor | Browser requests the site's HTML, scripts, styles, and fonts; the hosting platform may keep ordinary access logs |

Both direct requests and the helper’s upstream AI requests omit browser cookies and the Referer header, and reject HTTP redirects. Data is still processed by the configured API operator; transport protection depends on whether the endpoint uses HTTPS. Keys are not encrypted in local storage and can be removed with the AI panel's clear-configuration button. Scripts on the same origin can access that storage.

For offline use, keep a local copy, do not send AI messages or load remote projects through `?project=…`, and ensure imported image and image-pooling sources use embedded Data URLs. Runtime dependencies are bundled, the formula component uses local fonts, and keypress sounds are disabled. Local libraries are separate across browsers, profiles, domains, and ports. Clearing site data removes local projects and settings. Embedded Data URL images increase JSON file size.

The main implementations are [index.html](index.html) (file library, project URL loading, and export), [ai.js](assets/js/ai.js) (settings and conversation), [ai-client.js](assets/js/ai-client.js) (direct and local relay requests), and [ai-engine.js](assets/js/ai-engine.js) (canvas context and edit validation). These statements describe the repository code; analytics scripts, proxies, or services added by deployers require their own disclosure.

## Static Deployment

Deploy to GitHub Pages or another static hosting service, or serve the files directly with Nginx or similar software. Preserve the directory structure, include `index.html`, the complete `assets/` directory, and the downloadable `tools/local-relay/server.ps1`, `server.cjs`, and `server.py` files, and retain licenses and third-party notices. The hosting server requires no Node.js service, database, or server environment variables. The optional relay runs on the user’s computer. Users enter API keys in their own browsers.

Update the entry page and resources together. Resource version parameters are in `index.html`; the entry HTML should revalidate its cache. Do not embed personal API keys in HTML, scripts, or the repository.

## Development and Testing

```text
index.html           Editor entry, canvas interaction, file library, import/export
assets/js/           AI assistant, image editing, canvas capture, connector drawing
assets/css/          AI and image editor styles
assets/vendor/       Bundled libraries, fonts, and PPTX export code
tools/               Optional local relay, independently downloadable service files
tests/               Node.js automated tests
draw.md / draw.en.md Project JSON format and generation guide
AI.md                AI setup, interaction, and troubleshooting (Chinese)
```

Development tests use Node.js and its built-in test runner. No npm dependencies are required:

```bash
node --test tests/*.test.cjs
```

Tests cover AI request protocols and authentication boundaries, edit validation, cross-file protection, image processing, region captures, and connector/PPTX geometry, package structure, corners/shadows/gradient textures, native equations, expanded group membership, conflict choices, and cancellation. API requests use mocks and need no real key. These tests do not certify real provider endpoints or every browser environment. Run relevant tests and check affected browser interactions before contributing changes.

## License

This project is distributed under the [GNU General Public License v3.0](LICENSE). Additional component and asset information is available in [NOTICE](NOTICE).

ZIP export uses [fflate 0.8.2](https://github.com/101arrowz/fflate), visual math input uses [MathLive 0.110.0](https://mathlive.io/), formula layout uses [KaTeX 0.16.22](https://katex.org/) and its math fonts, and PNG canvas rendering uses [html2canvas 1.4.1](https://github.com/niklasvh/html2canvas). All four are distributed under the MIT License; their complete license texts are stored at [assets/vendor/fflate.LICENSE](assets/vendor/fflate.LICENSE), [assets/vendor/mathlive/LICENSE.txt](assets/vendor/mathlive/LICENSE.txt), [assets/vendor/katex.LICENSE](assets/vendor/katex.LICENSE), and [assets/vendor/html2canvas.LICENSE](assets/vendor/html2canvas.LICENSE).

The interface uses an unmodified copy of HarmonyOS Sans SC Regular. The font is copyrighted by Huawei Device Co., Ltd. and is embedded and redistributed under the separate HarmonyOS Sans Fonts License Agreement preserved at [assets/vendor/harmonyos-sans/LICENSE.txt](assets/vendor/harmonyos-sans/LICENSE.txt). Third-party works retain their own licenses and copyright notices.
