// Run: node --test Tampermonkey/tests/AutoGetMedia.download-progress.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scriptPath = process.argv[2] || path.join(__dirname, '..', 'AutoGetMedia.user.js');

function setup(sourcePath = scriptPath) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const suffix = /\}\)\(\);\s*$/;
    assert.match(source, suffix, 'userscript should end with its enclosing IIFE');
    const instrumented = source.replace(suffix, `globalThis.api = {
        createSourceDownloadTracker: typeof createSourceDownloadTracker === 'function' ? createSourceDownloadTracker : undefined,
        downloadStates: typeof downloadStates === 'undefined' ? undefined : downloadStates,
        checkUrl: typeof checkUrl === 'function' ? checkUrl : undefined,
        prepareMediaResource: typeof prepareMediaResource === 'function' ? prepareMediaResource : undefined,
        downloadMediaResource: typeof downloadMediaResource === 'function' ? downloadMediaResource : undefined,
        selectedSources: typeof selectedSources === 'undefined' ? undefined : selectedSources,
        markResource: typeof markResource === 'function' ? markResource : undefined,
        renderResourceTree: typeof renderResourceTree === 'function' ? renderResourceTree : undefined
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
        querySelectorAll() { return []; },
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

function requireTrackerApi(env) {
    assert.equal(typeof env.api.createSourceDownloadTracker, 'function', 'createSourceDownloadTracker should be exposed to the VM');
    assert.ok(env.api.downloadStates && typeof env.api.downloadStates.get === 'function', 'downloadStates should be exposed as a Map');
    return env.api;
}

function stateOf(api, url) {
    const state = api.downloadStates.get(url);
    assert.ok(state, `expected download state for ${url}`);
    return {
        phase: state.phase,
        loaded: state.loaded,
        total: state.total,
        completedParts: state.completedParts,
        totalParts: state.totalParts,
        ...(Object.hasOwn(state, 'error') ? { error: state.error } : {})
    };
}

function assertNoNetwork(env) {
    assert.deepEqual(env.network, { fetch: 0, gm: 0 }, 'creating/updating trackers must not start network requests');
}

test('ordinary file progress advances and completion reports actual byte size', () => {
    const env = setup();
    const api = requireTrackerApi(env);
    const url = 'https://cdn.test/movie.mp4';
    const tracker = api.createSourceDownloadTracker(url);

    tracker.add('file', 1200);
    tracker.update('file', { loaded: 320, total: 1200, lengthComputable: true });
    assert.deepEqual(stateOf(api, url), {
        phase: 'downloading', loaded: 320, total: 1200, completedParts: 0, totalParts: 1
    });
    tracker.update('file', { loaded: 760, total: 1200, lengthComputable: true });
    assert.equal(stateOf(api, url).loaded, 760);

    // The browser's progress total can differ from the final Blob size (for
    // example when a response is compressed), so completion is authoritative.
    tracker.complete('file', 980);
    tracker.finish();
    assert.deepEqual(stateOf(api, url), {
        phase: 'done', loaded: 980, total: 980, completedParts: 1, totalParts: 1
    });
    assertNoNetwork(env);
});

test('unknown and inconsistent progress totals never create an over-100-percent range', () => {
    const env = setup();
    const api = requireTrackerApi(env);
    const unknownUrl = 'https://cdn.test/stream.bin';
    const unknown = api.createSourceDownloadTracker(unknownUrl);
    unknown.add('stream');
    assert.equal(stateOf(api, unknownUrl).total, null, 'a missing total should be represented as null');
    unknown.update('stream', { loaded: 256, total: 0, lengthComputable: false });
    assert.deepEqual(stateOf(api, unknownUrl), {
        phase: 'downloading', loaded: 256, total: null, completedParts: 0, totalParts: 1
    });

    const oddUrl = 'https://cdn.test/compressed.bin';
    const odd = api.createSourceDownloadTracker(oddUrl);
    odd.add('file', 100);
    odd.update('file', { loaded: 800, total: 100, lengthComputable: true });
    const oddState = stateOf(api, oddUrl);
    assert.equal(oddState.loaded, 800);
    assert.ok(oddState.total === null || oddState.total >= oddState.loaded,
        'an incorrect total must be cleared or raised so loaded/total cannot exceed 100%');
    assertNoNetwork(env);
});

test('video and audio trackers for one mixed download keep independent source progress', () => {
    const env = setup();
    const api = requireTrackerApi(env);
    const videoUrl = 'https://cdn.test/video.m3u8';
    const audioUrl = 'https://cdn.test/audio.m3u8';
    const video = api.createSourceDownloadTracker(videoUrl);
    const audio = api.createSourceDownloadTracker(audioUrl);

    video.add('video-segment', 1000);
    audio.add('audio-segment', 400);
    video.update('video-segment', { loaded: 600, total: 1000, lengthComputable: true });
    audio.update('audio-segment', { loaded: 100, total: 400, lengthComputable: true });

    assert.equal(stateOf(api, videoUrl).loaded, 600);
    assert.equal(stateOf(api, videoUrl).total, 1000);
    assert.equal(stateOf(api, audioUrl).loaded, 100);
    assert.equal(stateOf(api, audioUrl).total, 400);
    audio.update('audio-segment', { loaded: 250, total: 400, lengthComputable: true });
    assert.equal(stateOf(api, videoUrl).loaded, 600, 'audio updates must not change video progress');
    assert.equal(stateOf(api, audioUrl).loaded, 250);
    assertNoNetwork(env);
});

test('concurrent HLS range parts aggregate separately, and retry resets only its own part', () => {
    const env = setup();
    const api = requireTrackerApi(env);
    const playlistUrl = 'https://cdn.test/hls/master.m3u8';
    const tracker = api.createSourceDownloadTracker(playlistUrl);

    // Both byte ranges use the same media URL; distinct part IDs keep them
    // independently accounted for.
    tracker.add('media.m4s@0+100', 100);
    tracker.add('media.m4s@100+100', 100);
    tracker.update('media.m4s@0+100', { loaded: 40, total: 100, lengthComputable: true });
    tracker.update('media.m4s@100+100', { loaded: 70, total: 100, lengthComputable: true });
    assert.deepEqual(stateOf(api, playlistUrl), {
        phase: 'downloading', loaded: 110, total: 200, completedParts: 0, totalParts: 2
    });

    tracker.update('media.m4s@0+100', { loaded: 0, total: 100, lengthComputable: true, reset: true });
    assert.equal(stateOf(api, playlistUrl).loaded, 70, 'retry reset should preserve the other part');
    tracker.update('media.m4s@0+100', { loaded: 35, total: 100, lengthComputable: true });
    assert.equal(stateOf(api, playlistUrl).loaded, 105);

    tracker.complete('media.m4s@0+100', 96);
    tracker.complete('media.m4s@0+100', 96);
    assert.deepEqual(stateOf(api, playlistUrl), {
        phase: 'downloading', loaded: 166, total: 196, completedParts: 1, totalParts: 2
    }, 'completing a part twice must count its bytes only once');
    tracker.complete('media.m4s@100+100', 92);
    tracker.finish();
    assert.deepEqual(stateOf(api, playlistUrl), {
        phase: 'done', loaded: 188, total: 188, completedParts: 2, totalParts: 2
    });
    assertNoNetwork(env);
});

test('failure retains transferred bytes and cancellation has its own terminal phase', () => {
    const env = setup();
    const api = requireTrackerApi(env);
    const failedUrl = 'https://cdn.test/fails.ts';
    const failed = api.createSourceDownloadTracker(failedUrl);
    failed.add('part', 500);
    failed.update('part', { loaded: 180, total: 500, lengthComputable: true });
    failed.fail('connection reset');
    assert.deepEqual(stateOf(api, failedUrl), {
        phase: 'error', loaded: 180, total: 500, completedParts: 0, totalParts: 1, error: 'connection reset'
    });

    const cancelledUrl = 'https://cdn.test/cancelled.ts';
    const cancelled = api.createSourceDownloadTracker(cancelledUrl);
    cancelled.add('part', 300);
    cancelled.update('part', { loaded: 75, total: 300, lengthComputable: true });
    cancelled.cancel();
    assert.deepEqual(stateOf(api, cancelledUrl), {
        phase: 'cancelled', loaded: 75, total: 300, completedParts: 0, totalParts: 1
    });
    assertNoNetwork(env);
});

test('a newer task for the same URL supersedes every later update from the old tracker', () => {
    const env = setup();
    const api = requireTrackerApi(env);
    const url = 'https://cdn.test/reused.mp4';
    const oldTracker = api.createSourceDownloadTracker(url);
    oldTracker.add('old-file', 1000);
    oldTracker.update('old-file', { loaded: 500, total: 1000, lengthComputable: true });

    const newTracker = api.createSourceDownloadTracker(url);
    newTracker.add('new-file', 800);
    newTracker.update('new-file', { loaded: 125, total: 800, lengthComputable: true });
    const newState = stateOf(api, url);
    assert.deepEqual(newState, {
        phase: 'downloading', loaded: 125, total: 800, completedParts: 0, totalParts: 1
    });

    oldTracker.complete('old-file', 1000);
    oldTracker.finish();
    oldTracker.fail('late failure');
    oldTracker.cancel();
    assert.deepEqual(stateOf(api, url), newState, 'stale tracker callbacks must not overwrite the current task');
    assertNoNetwork(env);
});
