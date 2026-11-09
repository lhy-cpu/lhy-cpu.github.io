// Run: node --test Tampermonkey/tests/AutoGetMedia.grouping.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { test } = require('node:test');

const scriptPath = process.argv[2] || path.join(__dirname, '..', 'AutoGetMedia.user.js');

function setup(sourcePath = scriptPath) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const suffix = /\}\)\(\);\s*$/;
    assert.match(source, suffix, 'userscript should end with its enclosing IIFE');
    const instrumented = source.replace(suffix,
        `globalThis.api = {
            checkUrl: typeof checkUrl === 'function' ? checkUrl : undefined,
            registerPlaylistResources: typeof registerPlaylistResources === 'function' ? registerPlaylistResources : undefined,
            buildResourceTree: typeof buildResourceTree === 'function' ? buildResourceTree : undefined,
            mediaUrls,
            mediaInfo
        };\n})();`);

    const listeners = new Map();
    const network = { fetch: 0, gm: 0 };
    const location = new URL('https://page.test/watch');
    class XHR {
        open() {}
        send() {}
        addEventListener() {}
    }
    const document = {
        baseURI: location.href,
        readyState: 'loading',
        referrer: '',
        body: null,
        addEventListener(type, callback) { listeners.set(`document:${type}`, callback); },
        getElementById() { return null; },
        createElement() { throw new Error('UI is outside this test harness'); }
    };
    const window = {
        location,
        fetch: async () => { network.fetch++; return {}; },
        addEventListener(type, callback) { listeners.set(`window:${type}`, callback); },
        postMessage() {}
    };
    window.self = window.top = window.parent = window;
    const context = vm.createContext({
        window,
        document,
        location,
        URL,
        XMLHttpRequest: XHR,
        GM_getValue: () => false,
        GM_xmlhttpRequest() { network.gm++; },
        console: { log() {}, warn() {}, error() {} }
    });
    vm.runInContext(instrumented, context, { filename: sourcePath });
    return { api: context.api, listeners, network };
}

function requireApi(env) {
    assert.equal(typeof env.api.checkUrl, 'function', 'checkUrl should be exposed to the VM');
    assert.equal(typeof env.api.registerPlaylistResources, 'function', 'registerPlaylistResources should be exposed to the VM');
    assert.equal(typeof env.api.buildResourceTree, 'function', 'buildResourceTree should be exposed to the VM');
    assert.equal(Object.prototype.toString.call(env.api.mediaUrls), '[object Set]', 'mediaUrls should be exposed as a Set');
    assert.equal(Object.prototype.toString.call(env.api.mediaInfo), '[object Map]', 'mediaInfo should be exposed as a Map');
    return env.api;
}

function flatten(nodes) {
    assert.ok(Array.isArray(nodes), 'resource tree should be a root-node array');
    const result = [];
    const stack = [...nodes];
    const seen = new Set();
    while (stack.length) {
        const node = stack.pop();
        assert.ok(node && typeof node === 'object', 'tree entries should be nodes');
        assert.ok(!seen.has(node), 'tree nodes should not form object-reference cycles');
        seen.add(node);
        assert.equal(typeof node.label, 'string', 'each node should have a label');
        assert.ok(Array.isArray(node.children), 'each node should have a children array');
        if (node.url === null) {
            if ('synthetic' in node) assert.equal(node.synthetic, true, 'synthetic groups should be marked synthetic when marked');
        } else {
            assert.equal(typeof node.url, 'string', 'real nodes should have absolute URL strings');
            assert.match(node.url, /^https?:\/\//, 'real node URLs should be absolute HTTP(S) URLs');
        }
        result.push(node);
        stack.push(...node.children);
        assert.ok(result.length <= 10000, 'resource tree should remain bounded');
    }
    return result;
}

function findUrl(nodes, url) {
    return flatten(nodes).find(node => node.url === url);
}

function cycleProbe() {
    const env = setup(scriptPath);
    const api = requireApi(env);
    const left = 'https://cdn.test/cycle/left.m3u8';
    const right = 'https://cdn.test/cycle/right.m3u8';
    api.registerPlaylistResources(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nright.m3u8\n`, left, 'https://page.test/watch');
    api.registerPlaylistResources(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900\nleft.m3u8\n`, right, 'https://page.test/watch');
    const result = { urls: Array.from(api.mediaUrls), tree: api.buildResourceTree() };
    process.stdout.write(JSON.stringify(result));
}

if (process.argv[3] === '--cycle-probe') {
    cycleProbe();
} else {
    test('captures master to variant to segment relationships without fetching manifests', () => {
        const env = setup();
        const api = requireApi(env);
        const referer = 'https://page.test/watch?lesson=7';
        const master = 'https://cdn.test/live/master.m3u8?auth=abc';
        const variant = 'https://cdn.test/live/1080/index.m3u8?token=v1';
        const segment0 = 'https://cdn.test/live/1080/segments/000.ts?token=s0';
        const segment1 = 'https://cdn.test/live/1080/segments/001.ts?token=s1';

        api.registerPlaylistResources(
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1400000\n1080/index.m3u8?token=v1\n',
            master,
            referer
        );
        api.registerPlaylistResources(
            '#EXTM3U\n#EXTINF:4,\nsegments/000.ts?token=s0\n#EXTINF:4,\nsegments/001.ts?token=s1\n#EXT-X-ENDLIST\n',
            variant,
            referer
        );

        for (const url of [master, variant, segment0, segment1]) {
            assert.ok(api.mediaUrls.has(url), `expected ${url} to be registered`);
            assert.equal(api.mediaInfo.get(url).referer, referer);
        }
        assert.equal(api.mediaInfo.get(master).hls, true);
        assert.equal(api.mediaInfo.get(variant).hls, true);
        assert.equal(api.mediaInfo.get(segment0).hls, false);
        assert.deepEqual(env.network, { fetch: 0, gm: 0 }, 'registration should not make network requests');

        const tree = api.buildResourceTree();
        const masterNode = findUrl(tree, master);
        assert.ok(masterNode, 'master should be present in the tree');
        const variantNode = masterNode.children.find(node => node.url === variant);
        assert.ok(variantNode, 'variant should be a child of its master');
        assert.deepEqual(
            new Set(variantNode.children.map(node => node.url)),
            new Set([segment0, segment1]),
            'segments should be children of the variant manifest'
        );
        flatten(tree);
    });

    test('reparents a segment captured before its manifest is registered', () => {
        const env = setup();
        const api = requireApi(env);
        const playlist = 'https://cdn.test/reordered/index.m3u8';
        const segment = 'https://cdn.test/reordered/chunk000.ts';

        api.checkUrl(segment, false, 'https://page.test/watch');
        assert.ok(findUrl(api.buildResourceTree(), segment), 'unmatched captured segment should initially be visible');

        api.registerPlaylistResources('#EXTM3U\n#EXTINF:5,\nchunk000.ts\n#EXT-X-ENDLIST\n', playlist, 'https://page.test/watch');
        const tree = api.buildResourceTree();
        const playlistNode = findUrl(tree, playlist);
        assert.ok(playlistNode, 'manifest should appear in the tree');
        assert.ok(playlistNode.children.some(node => node.url === segment), 'previously captured segment should move under its manifest');
        assert.equal(flatten(tree).filter(node => node.url === segment).length, 1, 'reparenting should not duplicate the segment');
    });

    test('deduplicates repeated byte-range references to the same media URL', () => {
        const env = setup();
        const api = requireApi(env);
        const playlist = 'https://cdn.test/ranges/index.m3u8';
        const ranged = 'https://cdn.test/ranges/media.m4s';
        api.registerPlaylistResources(
            '#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:4,\nmedia.m4s\n#EXT-X-BYTERANGE:100@100\n#EXTINF:4,\nmedia.m4s\n#EXT-X-ENDLIST\n',
            playlist,
            'https://page.test/watch'
        );

        assert.equal(Array.from(api.mediaUrls).filter(url => url === ranged).length, 1);
        assert.equal(flatten(api.buildResourceTree()).filter(node => node.url === ranged).length, 1);
        assert.equal(findUrl(api.buildResourceTree(), playlist).children.filter(node => node.url === ranged).length, 1);
        assert.deepEqual(env.network, { fetch: 0, gm: 0 });
    });

    test('groups unmanifested numbered segments by directory without mixing directories', () => {
        const env = setup();
        const api = requireApi(env);
        const urls = [
            'https://cdn.test/cam-a/index0.ts',
            'https://cdn.test/cam-a/index1.ts',
            'https://cdn.test/cam-b/index0.ts',
            'https://cdn.test/cam-b/index1.ts',
            'https://cdn.test/audio/index0.m4s',
            'https://cdn.test/audio/index1.m4s'
        ];
        for (const url of urls) api.checkUrl(url, false, 'https://page.test/watch');

        const tree = api.buildResourceTree();
        const synthetic = flatten(tree).filter(node => node.url === null);
        assert.equal(synthetic.length, 3, 'each numbered segment directory should have its own synthetic group');
        const grouped = synthetic.map(node => Array.from(node.children, child => child.url).sort());
        assert.deepEqual(grouped.sort((a, b) => a[0].localeCompare(b[0])), [
            urls.slice(0, 2).sort(),
            urls.slice(2, 4).sort(),
            urls.slice(4, 6).sort()
        ].sort((a, b) => a[0].localeCompare(b[0])));
        for (const group of synthetic) {
            assert.equal(group.children.length, 2);
            const directories = new Set(group.children.map(node => new URL(node.url).pathname.replace(/[^/]+$/, '')));
            assert.equal(directories.size, 1, 'one synthetic group must contain resources from only one directory');
        }
    });

    test('cyclic manifest relationships produce a finite resource tree', () => {
        const child = spawnSync(process.execPath, [__filename, scriptPath, '--cycle-probe'], {
            encoding: 'utf8',
            timeout: 3000,
            maxBuffer: 1024 * 1024
        });
        assert.ifError(child.error, 'cycle handling should finish within the timeout');
        assert.equal(child.status, 0, child.stderr || 'cycle probe should exit successfully');
        const result = JSON.parse(child.stdout);
        assert.ok(result.urls.includes('https://cdn.test/cycle/left.m3u8'));
        assert.ok(result.urls.includes('https://cdn.test/cycle/right.m3u8'));
        assert.ok(Array.isArray(result.tree));
        const nodeCount = flatten(result.tree).length;
        assert.ok(nodeCount <= 4, 'cycle should not recursively expand duplicate manifest nodes');
    });
}
