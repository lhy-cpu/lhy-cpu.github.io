/* Markdown + LaTeX for AI chat replies. Model text only ever becomes text nodes and a fixed set of
   elements; the sole innerHTML is KaTeX output rendered with trust:false. Unfinished syntax while
   streaming (an open ** or \( ) stays literal until its closing delimiter arrives. */
(function (root) {
  'use strict';
  const LIST = /^( *)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/;
  const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
  const TABLE_RULE = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;
  const MARKUP = /[\\`*_#>[$~|]|^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]|^ {0,3}(?:-{3,}|_{3,}) *$/m;
  const leading = line => line.length - line.replace(/^ +/, '').length;

  function startsBlock(lines, i) {
    const line = lines[i];
    return FENCE.test(line) || /^ {0,3}#{1,6}[ \t]/.test(line) || /^ {0,3}>/.test(line) || LIST.test(line) ||
      /^ {0,3}([-*_])( *\1){2,} *$/.test(line) || /^ {0,3}(\$\$|\\\[)/.test(line) || isTable(lines, i);
  }
  function isTable(lines, i) { return lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && lines[i + 1].includes('|') && TABLE_RULE.test(lines[i + 1]); }
  function cells(line) {
    const value = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1'), out = [];
    let cell = '';
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '\\' && value[i + 1] === '|') { cell += '|'; i++; } else if (value[i] === '|') { out.push(cell.trim()); cell = ''; } else cell += value[i];
    }
    out.push(cell.trim());
    return out;
  }

  function parseList(lines, start) {
    const first = LIST.exec(lines[start]), indent = first[1].length, ordered = /\d/.test(first[2]), items = [];
    let i = start;
    while (i < lines.length) {
      const m = LIST.exec(lines[i]);
      if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
      const width = m[1].length + m[2].length + 1, body = [m[3]];
      i++;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && leading(lines[j]) > indent) { body.push(''); i++; continue; }
          break;
        }
        if (leading(line) > indent) { body.push(line.slice(Math.min(width, leading(line)))); i++; continue; }
        if (startsBlock(lines, i)) break;
        body.push(line.trim()); i++;
      }
      items.push(parseBlocks(body.join('\n')));
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = j < lines.length && LIST.exec(lines[j]);
      if (j > i && next && next[1].length === indent && /\d/.test(next[2]) === ordered) i = j;
    }
    return { block: { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items }, next: i };
  }

  function parseBlocks(source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), blocks = [];
    let i = 0, m;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if ((m = FENCE.exec(line))) {
        const close = new RegExp('^ {0,3}' + (m[1][0] === '`' ? '`' : '~') + '{' + m[1].length + ',}[ \\t]*$'), body = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
        i++;
        blocks.push({ type: 'code', lang: m[2], text: body.join('\n') });
        continue;
      }
      if ((m = /^ {0,3}(\$\$|\\\[)(.*)$/.exec(line))) {
        const close = m[1] === '$$' ? '$$' : '\\]', at = m[2].indexOf(close);
        if (at >= 0 && !m[2].slice(at + close.length).trim()) { blocks.push({ type: 'math', tex: m[2].slice(0, at) }); i++; continue; }
        if (at < 0) {
          const body = [m[2]];
          let j = i + 1, closed = false;
          for (; j < lines.length; j++) {
            const k = lines[j].indexOf(close);
            if (k >= 0) { body.push(lines[j].slice(0, k)); closed = !lines[j].slice(k + close.length).trim(); break; }
            body.push(lines[j]);
          }
          if (closed) { blocks.push({ type: 'math', tex: body.join('\n') }); i = j + 1; continue; }
        }
      }
      if ((m = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line))) { blocks.push({ type: 'heading', level: m[1].length, text: m[2] }); i++; continue; }
      if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
      if (/^ {0,3}>/.test(line)) {
        const body = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''));
        blocks.push({ type: 'quote', children: parseBlocks(body.join('\n')) });
        continue;
      }
      if (isTable(lines, i)) {
        const head = cells(lines[i]), align = cells(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : '');
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
        blocks.push({ type: 'table', head, align, rows });
        continue;
      }
      if (LIST.test(line)) { const list = parseList(lines, i); blocks.push(list.block); i = list.next; continue; }
      const body = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) body.push(lines[i++].trim());
      blocks.push({ type: 'paragraph', text: body.join('\n') });
    }
    return blocks;
  }

  const wordChar = ch => /[\p{L}\p{N}]/u.test(ch || '');
  function findClose(s, mark, from) {
    if (!s[from] || /\s/.test(s[from])) return -1;
    for (let j = s.indexOf(mark, from); j >= 0; j = s.indexOf(mark, j + 1)) {
      if (j === from || /\s/.test(s[j - 1])) continue;
      if (mark.length === 1 && (s[j + 1] === mark || s[j - 1] === mark)) continue;
      if (mark.length === 2) while (s[j + 2] === mark[0]) j++;
      return j;
    }
    return -1;
  }

  function parseInline(s) {
    const out = [];
    let text = '', i = 0;
    const flush = () => { if (text) { out.push({ type: 'text', text }); text = ''; } };
    const push = node => { flush(); out.push(node); };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        const pair = s.startsWith('\\(', i) ? '\\)' : s.startsWith('\\[', i) ? '\\]' : null;
        if (pair) { const j = s.indexOf(pair, i + 2); if (j >= 0) { push({ type: 'math', tex: s.slice(i + 2, j), display: pair === '\\]' }); i = j + 2; continue; } }
        if (/[!-/:-@[-`{-~]/.test(s[i + 1] || '')) { text += s[i + 1]; i += 2; continue; }
        text += c; i++; continue;
      }
      if (c === '`') {
        let n = 1;
        while (s[i + n] === '`') n++;
        const fence = '`'.repeat(n);
        let j = s.indexOf(fence, i + n);
        while (j >= 0 && s[j + n] === '`') j = s.indexOf(fence, j + n + 1);
        if (j >= 0) { let code = s.slice(i + n, j); if (/^ .*\S.* $/.test(code)) code = code.slice(1, -1); push({ type: 'code', text: code }); i = j + n; continue; }
        text += fence; i += n; continue;
      }
      if (c === '$') {
        if (s.startsWith('$$', i)) { const j = s.indexOf('$$', i + 2); if (j > i + 2) { push({ type: 'math', tex: s.slice(i + 2, j), display: true }); i = j + 2; continue; } text += '$$'; i += 2; continue; }
        if (s[i + 1] && !/\s/.test(s[i + 1])) {
          let j = s.indexOf('$', i + 1);
          while (j >= 0 && (/\s/.test(s[j - 1]) || s[j - 1] === '\\' || /\d/.test(s[j + 1] || ''))) j = s.indexOf('$', j + 1);
          if (j > i + 1) { push({ type: 'math', tex: s.slice(i + 1, j), display: false }); i = j + 1; continue; }
        }
        text += c; i++; continue;
      }
      const pair = s.startsWith('**', i) ? '**' : s.startsWith('__', i) ? '__' : s.startsWith('~~', i) ? '~~' : null;
      if (pair) {
        const j = findClose(s, pair, i + 2);
        if (j > 0 && !(pair === '__' && (wordChar(s[i - 1]) || wordChar(s[j + 2])))) { push({ type: pair === '~~' ? 'del' : 'strong', children: parseInline(s.slice(i + 2, j)) }); i = j + 2; continue; }
        text += pair; i += 2; continue;
      }
      if (c === '*' || c === '_') {
        const j = c === '_' && wordChar(s[i - 1]) ? -1 : findClose(s, c, i + 1);
        if (j > 0 && !(c === '_' && wordChar(s[j + 1]))) { push({ type: 'em', children: parseInline(s.slice(i + 1, j)) }); i = j + 1; continue; }
        text += c; i++; continue;
      }
      if (c === '[') {
        const m = /^\[([^\]\n]+)\]\(\s*<?((?:https?:|mailto:)[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/i.exec(s.slice(i));
        if (m) { push({ type: 'link', href: m[2], children: parseInline(m[1]) }); i += m[0].length; continue; }
      }
      text += c; i++;
    }
    flush();
    return out;
  }

  const mathCache = new Map();
  function mathNode(doc, katex, tex, display) {
    const key = (display ? 'D' : 'I') + tex;
    let html = mathCache.get(key);
    if (html === undefined && katex && typeof katex.renderToString === 'function') {
      try { html = katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 100, output: 'htmlAndMathml' }); } catch (_) { html = null; }
      if (mathCache.size > 300) mathCache.clear();
      mathCache.set(key, html);
    }
    if (!html) { const code = doc.createElement('code'); code.textContent = display ? `\\[${tex}\\]` : `\\(${tex}\\)`; return code; }
    const node = doc.createElement(display ? 'div' : 'span');
    node.className = display ? 'ai-md-math' : 'ai-md-inline-math';
    node.innerHTML = html;
    return node;
  }

  function render(source, doc, katex) {
    const text = value => doc.createTextNode ? doc.createTextNode(value) : Object.assign(doc.createElement('span'), { textContent: value });
    const el = (tag, children = [], className) => { const node = doc.createElement(tag); if (className) node.className = className; node.append(...children); return node; };
    function inline(nodes) {
      return nodes.map(node => {
        if (node.type === 'text') return text(node.text);
        if (node.type === 'code') { const code = el('code'); code.textContent = node.text; return code; }
        if (node.type === 'math') return mathNode(doc, katex, node.tex, node.display);
        if (node.type === 'link') { const a = el('a', inline(node.children)); a.href = node.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
        return el(node.type, inline(node.children));
      });
    }
    function blocks(list) {
      return list.map(block => {
        if (block.type === 'paragraph') return el('p', inline(parseInline(block.text)));
        if (block.type === 'heading') { const node = el('div', inline(parseInline(block.text)), `ai-md-h ai-md-h${block.level}`); node.setAttribute('role', 'heading'); node.setAttribute('aria-level', String(block.level)); return node; }
        if (block.type === 'code') { const code = el('code'); code.textContent = block.text; return el('pre', [code]); }
        if (block.type === 'math') return mathNode(doc, katex, block.tex, true);
        if (block.type === 'hr') return el('hr');
        if (block.type === 'quote') return el('blockquote', blocks(block.children));
        if (block.type === 'list') {
          const node = el(block.ordered ? 'ol' : 'ul', block.items.map(item => el('li', item.length === 1 && item[0].type === 'paragraph' ? inline(parseInline(item[0].text)) : blocks(item))));
          if (block.ordered && block.start !== 1) node.setAttribute('start', String(block.start));
          return node;
        }
        const row = (values, tag) => el('tr', block.head.map((_, k) => { const cell = el(tag, inline(parseInline(values[k] || ''))); if (block.align[k]) cell.style.textAlign = block.align[k]; return cell; }));
        return el('div', [el('table', [el('thead', [row(block.head, 'th')]), el('tbody', block.rows.map(values => row(values, 'td')))])], 'ai-md-table');
      });
    }
    return blocks(parseBlocks(source));
  }

  const hasMarkup = value => MARKUP.test(String(value || ''));
  const api = { parseBlocks, parseInline, render, hasMarkup };
  root.FlowSketchAIMarkdown = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
