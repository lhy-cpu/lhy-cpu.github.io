'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('const SAFE_ID='), end = html.indexOf('  function sanitizeReferences(');
const context = { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) };
vm.runInNewContext(html.slice(start, end) + ';this.sanitizeElement=sanitizeElement;', context);
const sanitize = element => { const e = { type: 'tokenGrid', ...element }; context.sanitizeElement(e); return e; };

test('pooled token images only keep embedded raster data URLs, never remote or script URLs', () => {
  for (const colorImage of ['data:image/webp;base64,UklGRiQAAABXRUJQ', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/gif;base64,R0lGODlh'])
    assert.equal(sanitize({ colorImage }).colorImage, colorImage);
  for (const colorImage of ['https://tracker.example/pixel.png', '//tracker.example/p.png', 'http://192.168.1.1/x.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png,raw', 'data:image/png;base64,AAAA" onerror="alert(1)', ' data:image/png;base64,AAAA', 'assets/x.png', 42, null, ['data:image/png;base64,AAAA']]) {
    const e = sanitize({ colorImage, colorMode: 'image', poolColors: [[1, 2, 3, 255]] });
    assert.equal(Object.hasOwn(e, 'colorImage'), false, String(colorImage));
    assert.deepEqual(Array.from(e.poolColors[0]), [1, 2, 3, 255]);
  }
  assert.equal(Object.hasOwn(sanitize({}), 'colorImage'), false);
});
