const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(process.argv[2] || require('node:path').join(__dirname,'..','AutoGetMedia.user.js'), 'utf8').replace('await runMediaFFmpeg(engineInputs, command.args, report)', 'await globalThis.__testRunner(engineInputs, command.args, report)').replace(/\}\)\(\);\s*$/, `globalThis.api = { parsePlaylist, parseAttributes, makeIv, resolvePlaylist, downloadPlaylist, handleM3u8Download, fetchBytes, requestMedia, checkUrl, inspectFetchResponse, mediaInfo, mediaUrls, initUI, renderResourceTree, downloadMediaResource, processingSettings, selectedSources, markResource };\n})();`);
const base = 'https://cdn.test/hls/list.m3u8?token=ok';
const text = lines => '#EXTM3U\n' + lines + '\n#EXT-X-ENDLIST';
function setup({ready = 'loading', frame = false, block = false} = {}) {
    const ids = new Map(), listeners = {}, saved = [], calls = [], routes = new Map(), blobs = new Map(), engineCalls = [];
    let counter = 0;
    class TestURL extends URL {
        static createObjectURL(blob) { const url = 'blob:test/' + counter++; blobs.set(url, blob); return url; }
        static revokeObjectURL(url) { blobs.delete(url); }
    }
    class Element {
        constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.events = {}; }
        set id(value) { this._id = value; ids.set(value, this); }
        get id() { return this._id; }
        set innerHTML(value) { this._html = value; for (const match of value.matchAll(/id="([^"]+)"/g)) { const el = new Element('span'); el.id = match[1]; this.appendChild(el); } }
        appendChild(el) { this.children.push(el); el.parentNode = this; }
        prepend(el) { this.children.unshift(el); el.parentNode = this; }
        replaceChildren(...children) { this.children = []; children.forEach(el => this.appendChild(el)); }
        addEventListener(type, fn) { this.events[type] = fn; }
        closest() { return this.parentNode; }
        click() { if (this.download) saved.push({name: this.download, blob: blobs.get(this.href)}); }
        remove() { this.parentNode.children = this.parentNode.children.filter(el => el !== this); }
    }
    class XHR {
        constructor() { this.events = {}; }
        open(method, url) { this.url = url; }
        send() { this.sent = true; }
        addEventListener(type, fn) { this.events[type] = fn; }
        getResponseHeader() { return this.contentType; }
    }
    const location = new TestURL('https://page.test/player/watch');
    const document = { baseURI: location.href, referrer: '', readyState: ready, body: new Element('body'),
        getElementById: id => ids.get(id), createElement: tag => new Element(tag), querySelectorAll: () => [], addEventListener: (type, fn) => { listeners[type] = fn; } };
    const window = { location, addEventListener: (type, fn) => { listeners[type] = fn; }, fetch: async () => new Response('original') };
    window.self = window;
    window.top = frame ? {postMessage(data) { calls.push({message:data}); }} : window;
    window.parent = window.top;
    const context = vm.createContext({__testRunner:async(inputs,args)=>{engineCalls.push({inputs,args});return new Blob(['converted']);},window, document, location, URL:TestURL, Blob, Response, TextDecoder, ReadableStream, Uint8Array, ArrayBuffer, console: {log(){}, warn(){}, error(){}},
        crypto:webcrypto, XMLHttpRequest:XHR, GM_getValue:() => block, GM_setValue(){}, ProgressEvent: class {},
        setTimeout:(fn, ms) => { if (ms < 3000) return setTimeout(fn, 0); }, navigator:{clipboard:{writeText:async()=>{}}},
        GM_xmlhttpRequest: options => {
            calls.push(options);
            const route = routes.get(options.url);
            setTimeout(() => {
                if (!route) return options.onload({status:404});
                const result = typeof route === 'function' ? route(options) : route;
                if (result.error) return options.onerror();
                if (result.timeout) return options.ontimeout();
                let body = result.body || '';
                const response = options.responseType === 'arraybuffer' ? (body instanceof ArrayBuffer ? body : Uint8Array.from(body).buffer) : options.responseType === 'blob' ? new Blob([Array.isArray(body) ? Uint8Array.from(body) : body]) : body;
                options.onload({status:result.status || 200, finalUrl:result.finalUrl, responseText:typeof body === 'string' ? body : undefined, response, responseHeaders:result.headers || ''});
            }, 0);
        }
    });
    vm.runInContext(source, context);
    return {api:context.api, routes, calls, saved, window, document, listeners, XHR, ids, engineCalls};
}
async function bytes(blob) { return [...new Uint8Array(await blob.arrayBuffer())]; }

test('default ordinary download preserves original data without starting the converter',async()=>{
 const env=setup();const url='https://cdn.test/movie.mp4';env.routes.set(url,{body:[1,2,3]});
 await env.api.downloadMediaResource(url,{});
 assert.equal(env.engineCalls.length,0);assert.equal(env.saved[0].name,'movie.mp4');assert.deepEqual(await bytes(env.saved[0].blob),[1,2,3]);
});
test('output format also converts an ordinary file through the common processing engine',async()=>{
 const env=setup();const url='https://cdn.test/movie.mp4';env.routes.set(url,{body:[1,2,3]});env.api.processingSettings.format='mkv';
 await env.api.downloadMediaResource(url,{});
 assert.equal(env.engineCalls.length,1);assert.ok(env.engineCalls[0].args.includes('copy'));assert.match(env.saved[0].name,/\.mkv$/);assert.equal(await env.saved[0].blob.text(),'converted');
});
test('ordinary audio output maps only audio and honors the chosen encoder',async()=>{
 const env=setup();const url='https://cdn.test/movie.mp4';env.routes.set(url,{body:[1,2,3]});Object.assign(env.api.processingSettings,{format:'mp3',audioMode:'encode',audioCodec:'libmp3lame'});
 await env.api.downloadMediaResource(url,{});
 const args=env.engineCalls[0].args;assert.ok(args.includes('libmp3lame'));assert.ok(!args.some(arg=>/v:0/.test(arg)));assert.match(env.saved[0].name,/\.mp3$/);
});
test('ordinary HLS download also honors selected output format',async()=>{
 const env=setup();env.routes.set(base,{body:text('#EXTINF:1,\na.ts')});env.routes.set('https://cdn.test/hls/a.ts',{body:[71,2,3]});env.api.processingSettings.format='mp4';
 await env.api.downloadMediaResource(base,{});
 assert.equal(env.engineCalls.length,1);assert.match(env.saved[0].name,/\.mp4$/);
});
test('resource marking is exclusive per URL and the mixer is placed below the list',()=>{
 const env=setup({ready:'complete'});const url='https://cdn.test/movie.mp4';env.api.checkUrl(url);env.api.renderResourceTree();
 const wrapper=env.ids.get('agm-list-wrapper');assert.equal(wrapper.children[1],env.ids.get('agm-mixer'));
 env.api.markResource('video',url);assert.equal(env.api.selectedSources.video,url);
 env.api.markResource('audio',url);assert.equal(env.api.selectedSources.video,null);assert.equal(env.api.selectedSources.audio,url);
 env.api.markResource('audio',url);assert.equal(env.api.selectedSources.audio,null);
});
test('marked video and audio use the selected streams in one output file',async()=>{
 const env=setup({ready:'complete'});const video='https://cdn.test/video.mp4',audio='https://cdn.test/audio.m4a';env.routes.set(video,{body:[1,2]});env.routes.set(audio,{body:[3,4]});
 env.api.markResource('video',video);env.api.markResource('audio',audio);
 await env.ids.get('agm-mux-start').onclick();
 assert.equal(env.engineCalls.length,1);const args=env.engineCalls[0].args;
 assert.ok(args.includes('0:v:0'));assert.ok(args.includes('1:a:0'));assert.equal(env.saved.length,1);assert.match(env.saved[0].name,/_muxed\.mp4$/);
});
test('incompatible explicit encoder and container do not produce a mislabeled download',async()=>{
 const env=setup();const url='https://cdn.test/video.mp4';env.routes.set(url,{body:[1,2]});Object.assign(env.api.processingSettings,{format:'webm',videoMode:'encode',videoCodec:'libx264'});
 await assert.rejects(env.api.downloadMediaResource(url,{}));assert.equal(env.engineCalls.length,0);assert.equal(env.saved.length,0);
});
