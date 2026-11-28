'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('the displayed front-end version is never older than any cache-busted asset', () => {
  const shown = html.match(/<span id="appVersion" title="前端资源版本">(\d{8}\.\d+)<\/span>/)?.[1];
  assert.ok(shown, 'index.html must show #appVersion');
  const key = value => value.split('.').map(Number).reduce((date, build) => date * 1000 + build);
  const assets = [...html.matchAll(/\?v=(\d{8}\.\d+)/g)].map(match => match[1]);
  assert.ok(assets.length > 5);
  for (const version of assets) assert.ok(key(shown) >= key(version), `${shown} is older than asset version ${version}`);
});

test('the help dialog title shows the same version next to the repository link', () => {
  assert.match(html, /<span class="app-version"[^>]*>v'\+esc\(\$\('#appVersion'\)\.textContent\)\+'<\/span><a class="repo-link" href="https:\/\/github\.com\/lhy-cpu\/Drawer_Engine_AI"/);
});
