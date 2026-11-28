'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const stream = require('../assets/js/ai-stream.js');

const batch = {
  note: 'keys before operations: {"operations":[{"op":"clear"}]}',
  operations: [
    { op: 'add', element: { id: 'a', type: 'basicShape', text: 'say "hi" {not} [json] \\ end', changes: { nested: [1, { x: '}' }] } } },
    { op: 'add', element: { id: 'b', type: 'text', text: '处理' } },
    { op: 'add', element: { id: 'c', type: 'connector', fromId: 'a', toId: 'b' } },
    { op: 'update', id: 'a', changes: { fill: '#fff' } },
  ],
  trailing: { operations: [{ op: 'delete', id: 'ignored' }] },
};

function feedInChunks(text, sizes) {
  const parser = stream.operationStream(), seen = [];
  let end = 0, i = 0;
  while (end < text.length) { end = Math.min(text.length, end + sizes[i++ % sizes.length]); seen.push(...parser.feed(text.slice(0, end))); }
  return { parser, seen };
}

test('operations complete one by one regardless of chunk boundaries, ignoring nested or trailing look-alikes', () => {
  const text = JSON.stringify(batch, null, 1);
  for (const sizes of [[1], [2, 7, 3], [64], [text.length]]) {
    const { parser, seen } = feedInChunks(text, sizes);
    assert.deepEqual(seen, batch.operations, String(sizes));
    assert.deepEqual(parser.operations, batch.operations);
  }
});

test('each operation is reported as soon as its object closes, before the array ends', () => {
  const text = JSON.stringify({ operations: batch.operations });
  const parser = stream.operationStream(), firstEnd = text.indexOf('}}},') + 3;
  assert.deepEqual(parser.feed(text.slice(0, firstEnd - 1)), []);
  assert.deepEqual(parser.feed(text.slice(0, firstEnd)), [batch.operations[0]]);
  assert.deepEqual(parser.feed(text), batch.operations.slice(1));
  assert.deepEqual(parser.feed(text + ' {"op":"clear"}'), []);
});

test('malformed items are skipped and non-object roots never yield operations', () => {
  const parser = stream.operationStream();
  assert.deepEqual(parser.feed('{"operations":[{"op":"add",bad},{"op":"clear"}]}'), [{ op: 'clear' }]);
  assert.deepEqual(stream.operationStream().feed('[{"operations":[{"op":"clear"}]}]'), []);
  assert.deepEqual(stream.operationStream().feed('{"x":{"operations":[{"op":"clear"}]}}'), []);
});

test('descriptions name element types and resolve connector and update labels', () => {
  const labels = new Map([['a', '输入'], ['b', '处理']]);
  assert.equal(stream.describe(batch.operations[1], labels), '正在添加文字「处理」');
  assert.equal(stream.describe(batch.operations[2], labels), '正在连线「输入」→「处理」');
  assert.equal(stream.describe({ op: 'update', id: 'b' }, labels), '正在修改「处理」');
  assert.equal(stream.describe({ op: 'delete', id: 'zzz' }, labels), '正在删除「元素」');
  assert.equal(stream.describe({ op: 'group', id: 'g', changes: { memberIds: ['a', 'b'] } }), '正在组合 2 个元素');
  assert.equal(stream.describe({ op: 'add', element: { type: 'formula', latex: 'E=mc^2' } }), '正在添加公式「E=mc^2」');
  assert.equal(stream.label({ type: 'note', text: '一二三四五六七八九十一二三四五' }), '一二三四五六七八九十一二三四…');
  assert.equal(stream.describe(null), '正在准备修改');
});

test('leading think blocks are separated from visible content, including unfinished ones', () => {
  assert.deepEqual(stream.splitThinking('  <think>先规划\n布局</think>\n好的'), { thinking: '先规划\n布局', text: '\n好的' });
  assert.deepEqual(stream.splitThinking('<think>还在想'), { thinking: '还在想', text: '' });
  assert.deepEqual(stream.splitThinking('正文 <think>x</think>'), { thinking: '', text: '正文 <think>x</think>' });
  assert.deepEqual(stream.splitThinking(null), { thinking: '', text: '' });
});
