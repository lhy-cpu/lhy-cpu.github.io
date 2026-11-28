/* Incremental reading of streamed edit batches. Parsed items only drive progress and previews;
   the complete batch is still validated and applied atomically after the reply ends. */
(function (root) {
  'use strict';
  const TYPE_NAMES = { basicShape: '图形', text: '文字', note: '便签', token: 'Token', tokenGrid: 'Token 矩阵', formula: '公式', connector: '连接线', image: '图片' };

  // Feed the growing text of {"operations":[...]}; returns operations completed since the last call.
  function operationStream() {
    let text = '', pos = 0, inString = false, escape = false, stringStart = -1, lastKey = null, pendingKey = null;
    let opsDepth = -1, elementStart = -1, done = false;
    const stack = [], operations = [];
    function feed(full) {
      text = String(full || '');
      const found = [];
      for (; pos < text.length && !done; pos++) {
        const ch = text[pos];
        if (inString) {
          if (escape) escape = false;
          else if (ch === '\\') escape = true;
          else if (ch === '"') { inString = false; if (stack.length === 1) lastKey = text.slice(stringStart + 1, pos); }
          continue;
        }
        if (ch === '"') { inString = true; stringStart = pos; }
        else if (ch === ':') { if (stack.length === 1) pendingKey = lastKey; }
        else if (ch === ',') { if (stack.length === 1) pendingKey = null; }
        else if (ch === '{' || ch === '[') {
          stack.push(ch);
          if (ch === '[' && opsDepth < 0 && stack.length === 2 && stack[0] === '{' && pendingKey === 'operations') opsDepth = 2;
          else if (ch === '{' && opsDepth > 0 && stack.length === opsDepth + 1) elementStart = pos;
        } else if (ch === '}' || ch === ']') {
          stack.pop();
          if (ch === '}' && opsDepth > 0 && stack.length === opsDepth && elementStart >= 0) {
            try { const operation = JSON.parse(text.slice(elementStart, pos + 1)); operations.push(operation); found.push(operation); } catch (_) { /* the final batch parse reports errors */ }
            elementStart = -1;
          } else if (ch === ']' && opsDepth > 0 && stack.length === opsDepth - 1) done = true;
        }
      }
      return found;
    }
    return { feed, operations };
  }

  function label(element) {
    const text = String(element?.text || element?.latex || '').replace(/\s+/g, ' ').trim();
    return text ? (text.length > 14 ? text.slice(0, 14) + '…' : text) : (TYPE_NAMES[element?.type] || '元素');
  }

  function describe(operation, labels = new Map()) {
    const name = id => labels.get(id) || '元素';
    const op = operation && operation.op;
    if (op === 'add') {
      const element = operation.element || {};
      if (element.type === 'connector') return element.fromId || element.toId ? `正在连线「${name(element.fromId)}」→「${name(element.toId)}」` : '正在添加连接线';
      return `正在添加${TYPE_NAMES[element.type] || '元素'}「${label(element)}」`;
    }
    if (op === 'update') return `正在修改「${name(operation.id)}」`;
    if (op === 'delete') return `正在删除「${name(operation.id)}」`;
    if (op === 'group') return Array.isArray(operation.changes?.memberIds) ? `正在组合 ${operation.changes.memberIds.length} 个元素` : '正在调整组合';
    if (op === 'ungroup') return '正在取消组合';
    if (op === 'canvas') return '正在调整画布';
    if (op === 'rename') return '正在重命名项目';
    if (op === 'clear') return '正在清空画布';
    return '正在准备修改';
  }

  // Some models stream their reasoning inside the content as a leading <think> block.
  function splitThinking(content) {
    const value = String(content || ''), match = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/.exec(value);
    return match ? { thinking: match[1].trim(), text: value.slice(match[0].length) } : { thinking: '', text: value };
  }

  const api = { operationStream, describe, label, splitThinking };
  root.FlowSketchAIStream = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
