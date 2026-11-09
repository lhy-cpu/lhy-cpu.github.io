// Run: node --test Tampermonkey/tests/AutoGetMedia.test.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const scriptPath = process.argv[2] || path.join(__dirname, '..', 'AutoGetMedia.user.js');
const source = fs.readFileSync(scriptPath, 'utf8').replace(/\}\)\(\);\s*$/,
    'globalThis.api = { mediaUrls, mediaInfo };\n})();');

function setup({ ready = 'loading', sandbox = false } = {}) {
    const ids = new Map(), listeners = {};
    function addListener(type, callback) { const previous = listeners[type]; listeners[type] = (...args) => { if (previous) previous(...args); callback(...args); }; }
    class Element {
        constructor() { this.style = {}; this.children = []; }
        set id(value) { ids.set(value, this); }
        set innerHTML(value) {
            for (const match of value.matchAll(/id="([^"]+)"/g)) {
                const child = new Element(); child.id = match[1]; this.appendChild(child);
            }
        }
        appendChild(child) { this.children.push(child); child.parentNode = this; }
        prepend(child) { this.children.unshift(child); child.parentNode = this; }
        replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
        closest() { return new Element(); }
        addEventListener() {}
    }
    class XHR { open() {} send() {} }
    const location = new URL('https://page.test/watch');
    const document = {
        baseURI: location.href, readyState: ready, body: new Element(),
        getElementById: id => ids.get(id), createElement: () => new Element(), querySelectorAll: () => [],
        addEventListener: addListener
    };
    const window = { location, addEventListener: addListener };
    // Tampermonkey 的 window 包装对象可与原生 WindowProxy 不同；top/self 属于页面窗口体系。
    const pageWindow = sandbox ? { location } : window;
    pageWindow.parent = pageWindow;
    window.self = window.top = window.parent = pageWindow;
    const context = vm.createContext({ window, document, location, URL, XMLHttpRequest: XHR,
        GM_getValue: () => false, setTimeout, console: { log() {} } });
    vm.runInContext(source, context);
    return { api: context.api, ids, listeners, window, pageWindow };
}

test('iframe resources appear when userscript window differs from page WindowProxy', async () => {
    const env = setup({ready:'complete', sandbox:true});
    const child = { parent: env.pageWindow };
    assert.notEqual(env.window, env.pageWindow);
    env.listeners.message({source:child, origin:'https://frame.test', data:{type:'AutoGetMedia_NEW_URL', url:'https://cdn.test/stream?token=1', hls:true, referer:'https://frame.test/watch?id=2'}});
    env.listeners.message({source:child, origin:'https://frame.test', data:{type:'AutoGetMedia_NEW_URL', url:'https://cdn.test/index0.ts', hls:false}});
    assert.equal(env.api.mediaUrls.size, 2);
    assert.equal(env.ids.get('agm-count').innerText, 2);
    await new Promise(resolve => setTimeout(resolve, 80));
    const rows = env.ids.get('agm-list-wrapper').children[0].children;
    assert.equal(rows.length, 1); // 分片默认归入其清单，而非新增外层卡片。
    assert.equal(rows[0].children[2].children[1].innerText, '下载媒体内容');
    assert.ok(!rows[0].children[5].open);
    assert.equal(rows[0].children[5].children[1].children.length, 0);
    assert.equal(env.api.mediaInfo.get('https://cdn.test/stream?token=1').referer, 'https://frame.test/watch?id=2');
});
test('nested iframe resources are accepted and duplicate notifications do not add rows', async () => {
    const env = setup({ready:'complete', sandbox:true});
    const outer = {parent:env.pageWindow}, inner = {parent:outer};
    const event = {source:inner, origin:'https://frame.test', data:{type:'AutoGetMedia_NEW_URL', url:'https://cdn.test/a.ts'}};
    env.listeners.message(event); env.listeners.message(event);
    assert.equal(env.api.mediaUrls.size, 1);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(env.ids.get('agm-list-wrapper').children[0].children.length, 1);
});
test('unknown message types and non-HTTP resource URLs are rejected', () => {
    const env = setup({sandbox:true});
    env.listeners.message({source:null, origin:'https://frame.test', data:{type:'other',url:'https://cdn.test/a.ts'}});
    for (const url of ['javascript:alert(1)', 'data:text/plain,hello', 'file:///video.ts']) {
        env.listeners.message({source:null,origin:'https://frame.test',data:{type:'AutoGetMedia_NEW_URL',url,hls:true}});
    }
    assert.equal(env.api.mediaUrls.size,0);
});
test('Edge-style null source does not discard valid iframe media notifications', () => {
    const env = setup({sandbox:true});
    env.listeners.message({source:null,origin:'https://frame.test',data:{type:'AutoGetMedia_NEW_URL',url:'https://cdn.test/a.ts',referer:'https://frame.test/watch'}});
    assert.ok(env.api.mediaUrls.has('https://cdn.test/a.ts'));
    assert.equal(env.api.mediaInfo.get('https://cdn.test/a.ts').referer,'https://frame.test/watch');
});
test('inaccessible WindowProxy parent does not discard valid playlist notifications', () => {
    const env=setup({sandbox:true});
    const source={get parent(){throw new Error('Cross-origin access denied');}};
    env.listeners.message({source,origin:'https://frame.test',data:{type:'AutoGetMedia_PLAYLIST',url:'https://cdn.test/master.m3u8',text:'#EXTM3U\n#EXTINF:3,\na.ts\n#EXT-X-ENDLIST'}});
    assert.ok(env.api.mediaUrls.has('https://cdn.test/master.m3u8'));
    assert.ok(env.api.mediaUrls.has('https://cdn.test/a.ts'));
});
test('iframe resources received before DOM readiness are rendered on initialization', () => {
    const env=setup({sandbox:true});
    env.listeners.message({source:{parent:env.pageWindow},origin:'https://frame.test',data:{type:'AutoGetMedia_NEW_URL',url:'https://cdn.test/a.ts'}});
    env.listeners.DOMContentLoaded();
    assert.equal(env.ids.get('agm-list-wrapper').children[0].children.length,1);
});
