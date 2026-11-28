'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const md = require('../assets/js/ai-markdown.js');

const show = nodes => nodes.map(n => n.type === 'text' ? n.text : n.type === 'math' ? `${n.display ? 'D' : 'M'}(${n.tex})` : n.type === 'code' ? `C(${n.text})` : n.type === 'link' ? `L(${n.href}:${show(n.children)})` : `${n.type}(${show(n.children)})`).join('');
const inline = s => show(md.parseInline(s));

test('the reported reply parses into math, bold and a list', () => {
  const source = '已绘出曲线，并用 \\(K=0.0025\\,\\mathrm{s^2/m^2}\\) 的虚线对照。\n\n- **\\(K\\) 增大**：增益降低。\n- **\\(K\\) 减小**：增益升高。\n\n但 **0.0024 和 0.0026 不能仅凭侧向加速度推出**，需要拟合。';
  const blocks = md.parseBlocks(source);
  assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'list', 'paragraph']);
  assert.equal(inline(blocks[0].text), '已绘出曲线，并用 M(K=0.0025\\,\\mathrm{s^2/m^2}) 的虚线对照。');
  assert.deepEqual(blocks[1].items.map(item => inline(item[0].text)), ['strong(M(K) 增大)：增益降低。', 'strong(M(K) 减小)：增益升高。']);
  assert.equal(inline(blocks[2].text), '但 strong(0.0024 和 0.0026 不能仅凭侧向加速度推出)，需要拟合。');
  assert.equal(md.hasMarkup(source), true);
  assert.equal(md.hasMarkup('普通回复，没有任何格式。\n第二行。'), false);
});

test('inline math, code, emphasis, links and escapes', () => {
  assert.equal(inline('$a+b$ 与 $$\\int f$$ 与 \\[x\\]'), 'M(a+b) 与 D(\\int f) 与 D(x)');
  assert.equal(inline('价格 $5 和 $10，以及 $ x $'), '价格 $5 和 $10，以及 $ x $');
  assert.equal(inline('`**不加粗** \\(x\\)` 与 ``a`b``'), 'C(**不加粗** \\(x\\)) 与 C(a`b)');
  assert.equal(inline('**粗** *斜* _斜_ ~~删~~ ***都***'), 'strong(粗) em(斜) em(斜) del(删) strong(em(都))');
  assert.equal(inline('snake_case_name 与 a * b * c 与 \\*字面\\*'), 'snake_case_name 与 a * b * c 与 *字面*');
  assert.equal(inline('[文档](https://example.com/a) [邮件](mailto:a@b.c) [坏](javascript:alert(1))'), 'L(https://example.com/a:文档) L(mailto:a@b.c:邮件) [坏](javascript:alert(1))');
});

test('unfinished syntax stays literal while streaming', () => {
  assert.equal(inline('正在写 **加粗'), '正在写 **加粗');
  assert.equal(inline('公式 \\(K=0.00'), '公式 (K=0.00');
  assert.equal(inline('代码 `x'), '代码 `x');
  const open = md.parseBlocks('说明\n```js\nconst a = 1;');
  assert.deepEqual(open.map(b => b.type), ['paragraph', 'code']);
  assert.equal(open[1].text, 'const a = 1;');
  assert.deepEqual(md.parseBlocks('$$\nx^2').map(b => b.type), ['paragraph']);
});

test('block structures: headings, nested and ordered lists, quotes, rules, tables and display math', () => {
  const blocks = md.parseBlocks('## 标题 ##\n\n1. 第一\n   - 子项\n2. 第二\n\n3. 第三\n\n> 引用 **重点**\n\n---\n\n| 参数 | 值 |\n|:--|--:|\n| \\(K\\) | 0.0025 |\n| a\\|b | 2 |\n\n$$\nK = \\frac{m}{L}\n$$\n\\[ a^2 \\]\n\n5) 从五开始');
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'list', 'quote', 'hr', 'table', 'math', 'math', 'list']);
  assert.deepEqual([blocks[0].level, blocks[0].text], [2, '标题']);
  const list = blocks[1];
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[0].map(b => b.type), ['paragraph', 'list']);
  assert.equal(list.items[0][1].items[0][0].text, '子项');
  assert.equal(inline(blocks[2].children[0].text), '引用 strong(重点)');
  assert.deepEqual(blocks[4].head, ['参数', '值']);
  assert.deepEqual(blocks[4].align, ['left', 'right']);
  assert.deepEqual(blocks[4].rows, [['\\(K\\)', '0.0025'], ['a|b', '2']]);
  assert.equal(blocks[5].tex.trim(), 'K = \\frac{m}{L}');
  assert.equal(blocks[6].tex.trim(), 'a^2');
  assert.equal(blocks[7].start, 5);
});

function fakeDocument() {
  const created = [];
  const node = tag => { const n = { tag, children: [], attrs: {}, style: {}, append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; } };
    Object.defineProperty(n, 'innerHTML', { set(v) { n.html = v; }, get() { return n.html; } }); created.push(n); return n; };
  return { created, createElement: node, createTextNode: text => ({ text }) };
}
const flat = n => n.text !== undefined ? n.text : n.html !== undefined ? `[${n.html}]` : n.textContent !== undefined && !n.children.length ? n.textContent : n.children.map(flat).join('');

test('rendering builds fixed elements, keeps model HTML as text and only injects KaTeX output', () => {
  const doc = fakeDocument(), calls = [];
  const katex = { renderToString: (tex, options) => { calls.push([tex, options]); return `<span class="katex">${tex}</span>`; } };
  const nodes = md.render('<img src=x onerror=alert(1)> **\\(K\\)**\n\n$$x$$\n\n[x](javascript:alert(1))', doc, katex);
  assert.deepEqual(nodes.map(n => n.tag), ['p', 'div', 'p']);
  assert.equal(nodes[0].children[0].text, '<img src=x onerror=alert(1)> ');
  assert.equal(nodes[0].children[1].tag, 'strong');
  assert.equal(nodes[0].children[1].children[0].html, '<span class="katex">K</span>');
  assert.equal(nodes[1].className, 'ai-md-math');
  assert.ok(calls.every(([, options]) => options.trust === false && options.throwOnError === false));
  assert.equal(doc.created.filter(n => n.html !== undefined).length, 2);
  assert.equal(doc.created.some(n => n.tag === 'a' || n.tag === 'img' || n.tag === 'script'), false);
  const link = md.render('[文档](https://example.com)', fakeDocument(), katex)[0].children[0];
  assert.deepEqual([link.tag, link.href, link.target, link.rel], ['a', 'https://example.com', '_blank', 'noopener noreferrer']);
});

test('without KaTeX, formulas fall back to readable source and tables keep alignment', () => {
  const nodes = md.render('式 \\(a+b\\)\n\n| a | b |\n|:-:|---|\n| 1 | 2 |', fakeDocument(), undefined);
  assert.equal(nodes[0].children[1].tag, 'code');
  assert.equal(nodes[0].children[1].textContent, '\\(a+b\\)');
  const table = nodes[1].children[0];
  assert.equal(nodes[1].className, 'ai-md-table');
  assert.equal(table.children[0].children[0].children[0].style.textAlign, 'center');
  assert.equal(flat(table.children[1]), '12');
});

test('the vendored KaTeX renders the reported formula without errors', () => {
  const sandbox = { console };
  sandbox.self = sandbox.window = sandbox.globalThis = sandbox;
  require('node:vm').runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../assets/vendor/katex.min.js'), 'utf8'), sandbox);
  const katex = sandbox.katex;
  assert.equal(typeof katex.renderToString, 'function');
  const html = md.render('用 \\(K=0.0025\\,\\mathrm{s^2/m^2}\\) 对照', fakeDocument(), katex)[0].children[1].html;
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /katex-error/);
});
