"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(process.argv[2] || path.join(__dirname,'..','AutoGetMedia.user.js'),'utf8');
const block = script.split('// --- 浏览器媒体处理引擎 ---')[1].split('// --- 浏览器媒体处理引擎结束 ---')[0];
const { CORE_VERSION, createMediaFFmpegEngine, mediaFFmpegWorker } = new Function(block+'\nreturn mediaFFmpegEngine;')();

function makeCore(options, records) {
  const opts = options || {};
  const entries = new Map();
  const directories = new Set();
  let ret = -1;
  let resetCount = 0;
  let logger = function noop() {};
  let progress = function noop() {};

  const fs = {
    mkdir(path) {
      if (directories.has(path) || entries.has(path)) throw new Error(`EEXIST: ${path}`);
      directories.add(path);
    },
    analyzePath(path) { return { exists: directories.has(path) || entries.has(path) }; },
    writeFile(path, bytes) { entries.set(path, Uint8Array.from(bytes)); },
    readFile(path) {
      if (!entries.has(path)) throw new Error(`ENOENT: ${path}`);
      return entries.get(path);
    },
    unlink(path) {
      if (!entries.delete(path)) throw new Error(`ENOENT: ${path}`);
    },
    rmdir(path) {
      if (!directories.delete(path)) throw new Error(`ENOENT: ${path}`);
    },
  };

  const core = {
    FS: fs,
    setLogger(callback) { logger = callback; },
    setProgress(callback) { progress = callback; },
    get ret() { return ret; },
    set ret(value) { ret = value; },
    exec(...args) {
      if (opts.onExec) opts.onExec(args);
      logger({ type: "stdout", message: "mock ffmpeg running" });
      progress({ progress: 0.5, time: 0.2 });
      ret = typeof opts.exitCode === "function" ? opts.exitCode(args) : (opts.exitCode ?? 0);
      if (ret === 0) {
        const outputName = args[args.length - 1];
        entries.set(outputName, Uint8Array.from([0x46, 0x46, 0x4d, 0x50]));
      }
    },
    reset() {
      resetCount += 1;
      ret = -1;
    },
  };
  const record = {
    core,
    entries,
    directories,
    get resetCount() { return resetCount; },
  };
  records.push(record);
  return core;
}

function makeEnvironment(options) {
  const opts = options || {};
  const requests = [];
  const urls = new Map();
  const revokedUrls = [];
  const workers = [];
  const assetAttempts = new Map();
  let nextUrl = 1;
  let outstandingRunMessages = 0;
  let maxOutstandingRunMessages = 0;

  const URLApi = {
    createObjectURL(blob) {
      const url = `blob:mock-${nextUrl++}`;
      urls.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      urls.delete(url);
      revokedUrls.push(url);
    },
  };

  class SimulatedWorker {
    constructor(workerUrl) {
      this.workerUrl = workerUrl;
      this.terminated = false;
      this.heldRuns = [];
      this.coreRecords = [];
      workers.push(this);
      const workerIndex = workers.length;
      this.scope = {
        postMessage: (message) => {
          if (message.type === "done" || message.type === "job-error") {
            outstandingRunMessages = Math.max(0, outstandingRunMessages - 1);
          }
          queueMicrotask(() => {
            if (!this.terminated && typeof this.onmessage === "function") this.onmessage({ data: message });
          });
        },
        importScripts: (coreUrl) => {
          if (!urls.has(coreUrl)) throw new Error("importScripts received a revoked or unknown blob URL");
          if (workerIndex <= (opts.initFailureCount || 0)) throw new Error("injected core initialization failure");
          this.scope.createFFmpegCore = async ({ wasmBinary }) => {
            if (!(wasmBinary instanceof ArrayBuffer)) throw new Error("wasmBinary was not passed as ArrayBuffer");
            const recordList = [];
            const core = makeCore(opts.core || {}, recordList);
            this.coreRecords.push(...recordList);
            return core;
          };
        },
      };
      this.workerScope = this.scope;
      this.context = {
        self: this.scope,
        ArrayBuffer,
        Uint8Array,
      };
      vm.runInNewContext(`(${mediaFFmpegWorker.toString()})();`, this.context, { timeout: 1000 });
    }

    postMessage(message) {
      if (this.terminated) return;
      if (message.type === "run") {
        outstandingRunMessages += 1;
        maxOutstandingRunMessages = Math.max(maxOutstandingRunMessages, outstandingRunMessages);
        if (opts.holdRuns && opts.holdRuns()) {
          this.heldRuns.push(message);
          return;
        }
      }
      queueMicrotask(() => {
        if (!this.terminated && typeof this.scope.onmessage === "function") {
          void this.scope.onmessage({ data: message });
        }
      });
    }

    deliverHeldRuns() {
      for (const message of this.heldRuns.splice(0)) {
        if (!this.terminated) void this.scope.onmessage({ data: message });
      }
    }

    terminate() {
      this.terminated = true;
      this.heldRuns.length = 0;
    }
  }

  const environment = {
    Blob,
    URL: URLApi,
    Worker: SimulatedWorker,
    setTimeout,
    GM_xmlhttpRequest(details) {
      requests.push(details.url);
      const attempt = (assetAttempts.get(details.url) || 0) + 1;
      assetAttempts.set(details.url, attempt);
      const shouldFail = typeof opts.failRequest === "function" && opts.failRequest(details.url, attempt);
      let aborted = false;
      queueMicrotask(() => {
        if (aborted) return;
        if (shouldFail) {
          details.onerror({ status: 0 });
        } else if (details.responseType === "arraybuffer") {
          details.onload({ status: 200, response: Uint8Array.from([1, 2, 3, 4]).buffer });
        } else {
          details.onload({ status: 200, responseText: "/* mocked ffmpeg core UMD */" });
        }
      });
      return { abort() { aborted = true; } };
    },
  };

  return {
    environment,
    requests,
    urls,
    revokedUrls,
    workers,
    get maxOutstandingRunMessages() { return maxOutstandingRunMessages; },
    engine(optionsOverride) {
      return createMediaFFmpegEngine({
        globalObject: environment,
        sources: [
          { cdn: "jsdelivr", js: "https://cdn-a.test/core.js", wasm: "https://cdn-a.test/core.wasm" },
          { cdn: "unpkg", js: "https://cdn-b.test/core.js", wasm: "https://cdn-b.test/core.wasm" },
        ],
        sleep: async () => {},
        retryDelays: [0, 0],
        ...(optionsOverride || {}),
      });
    },
  };
}

function task(inputName, outputName) {
  return {
    inputs: [{ name: inputName || "input0", blob: new Blob(["sample-media"]) }],
    args: ["-i", inputName || "input0", "-c", "copy", outputName || "output.mp4"],
  };
}

test("runtime request retries twice and falls back to the paired unpkg assets", async () => {
  const harness = makeEnvironment({
    failRequest(url, attempt) {
      return url === "https://cdn-a.test/core.js" && attempt <= 3;
    },
  });
  const engine = harness.engine();
  const input = task();

  const blob = await engine.runMediaFFmpeg(input.inputs, input.args);

  assert.equal(CORE_VERSION, "0.12.10");
  assert.equal(blob.size, 4);
  assert.ok(harness.requests.filter((url) => url === "https://cdn-a.test/core.js").length === 3);
  assert.ok(harness.requests.includes("https://cdn-b.test/core.js"));
  assert.ok(harness.requests.includes("https://cdn-b.test/core.wasm"));
  assert.equal(harness.workers.length, 1);
});

test("core initialization failure falls back to the other CDN as a matched pair", async () => {
  const harness = makeEnvironment({ initFailureCount: 1 });
  const engine = harness.engine();
  const input = task("input0", "converted.webm");
  const statuses = [];

  const result = await engine.runMediaFFmpeg(input.inputs, input.args, (status) => statuses.push(status));

  assert.equal(result.type, "video/webm");
  assert.equal(harness.workers.length, 2);
  assert.ok(harness.requests.includes("https://cdn-a.test/core.js"));
  assert.ok(harness.requests.includes("https://cdn-a.test/core.wasm"));
  assert.ok(harness.requests.includes("https://cdn-b.test/core.js"));
  assert.ok(harness.requests.includes("https://cdn-b.test/core.wasm"));
  assert.ok(statuses.some((status) => status.phase === "runtime-source-error" && status.cdn === "jsdelivr"));
  assert.equal(harness.urls.size, 0);
});

test("jobs share one worker and execute in strict serial order", async () => {
  const harness = makeEnvironment();
  const engine = harness.engine();
  const first = task("input0", "first.mp4");
  const second = task("input1", "second.mp4");

  const outputs = await Promise.all([
    engine.runMediaFFmpeg(first.inputs, first.args),
    engine.runMediaFFmpeg(second.inputs, second.args),
  ]);

  assert.deepEqual(outputs.map((blob) => blob.size), [4, 4]);
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.maxOutstandingRunMessages, 1);
});

test("worker removes virtual files and directories and calls reset after execution", async () => {
  const harness = makeEnvironment();
  const engine = harness.engine();
  const input = task("inputs/source.bin", "outputs/result.mp4");

  const result = await engine.runMediaFFmpeg(input.inputs, input.args);

  assert.equal(result.size, 4);
  const [record] = harness.workers[0].coreRecords;
  assert.ok(record);
  assert.equal(record.entries.size, 0);
  assert.equal(record.directories.size, 0);
  assert.equal(record.resetCount, 1);
  assert.ok(harness.revokedUrls.length >= 2);
});

test("nonzero FFmpeg exit rejects after cleanup and a later task can reuse the core", async () => {
  let exitCode = 17;
  const harness = makeEnvironment({ core: { exitCode: () => exitCode } });
  const engine = harness.engine();
  const failed = task("input0", "failed.mp4");

  await assert.rejects(
    engine.runMediaFFmpeg(failed.inputs, failed.args),
    (error) => error.exitCode === 17 && /exited with code 17/.test(error.message),
  );
  const [record] = harness.workers[0].coreRecords;
  assert.equal(record.entries.size, 0);
  assert.equal(record.resetCount, 1);

  exitCode = 0;
  const successful = task("input0", "success.mp4");
  assert.equal((await engine.runMediaFFmpeg(successful.inputs, successful.args)).size, 4);
  assert.equal(harness.workers.length, 1);
});

test("cancel rejects active and queued work, terminates the worker, releases URLs, and permits reinitialization", async () => {
  let shouldHold = true;
  const harness = makeEnvironment({ holdRuns: () => shouldHold });
  const engine = harness.engine();
  const first = task("input0", "held.mp4");
  const second = task("input1", "queued.mp4");
  const activePromise = engine.runMediaFFmpeg(first.inputs, first.args);
  const pendingPromise = engine.runMediaFFmpeg(second.inputs, second.args);

  for (let attempt = 0; attempt < 20 && (!harness.workers[0] || harness.workers[0].heldRuns.length === 0); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(harness.workers[0].heldRuns.length, 1);
  engine.cancelMediaFFmpeg();

  await assert.rejects(activePromise, { name: "AbortError" });
  await assert.rejects(pendingPromise, { name: "AbortError" });
  assert.equal(harness.workers[0].terminated, true);
  assert.equal(harness.urls.size, 0);

  shouldHold = false;
  const afterCancel = task("input0", "after-cancel.mp4");
  assert.equal((await engine.runMediaFFmpeg(afterCancel.inputs, afterCancel.args)).size, 4);
  assert.equal(harness.workers.length, 2);
});


test('runtime progress uses MB for compressed or unreliable totals and never exceeds 100 percent', async () => {
  const { engine, run } = new Function(block + '\nreturn {engine:mediaFFmpegEngine,run:runMediaFFmpeg};')();
  engine.runMediaFFmpeg = async (inputs, args, report) => {
    for (const event of [
      { url: 'core.js', loaded: 50, total: 100 },
      { url: 'core.wasm', loaded: 254 * 1048576, total: 100 * 1048576 },
      { url: 'core.wasm', loaded: 255 * 1048576, total: 300 * 1048576 },
      { url: 'unknown.wasm', loaded: 2 * 1048576, total: 0 },
      { url: 'noncomputable.wasm', loaded: 2 * 1048576, total: 4 * 1048576, lengthComputable: false },
      { url: 'invalid.wasm', loaded: Infinity, total: Infinity },
      { url: 'negative.wasm', loaded: -1, total: 100 }
    ]) report({ phase: 'runtime-download', ...event });
    return new Blob(['output']);
  };
  const messages = [];
  await run([], [], text => messages.push(text));
  assert.deepEqual(messages, [
    '加载处理组件 50%', '加载处理组件 254.0 MB', '加载处理组件 255.0 MB',
    '加载处理组件 2.0 MB', '加载处理组件 2.0 MB', '加载处理组件 0.0 MB', '加载处理组件 0%'
  ]);
  assert.ok(messages.filter(text => text.endsWith('%')).every(text => Number(text.match(/(\d+)%$/)[1]) <= 100));
});

test('processing reports percentage, media time, speed and ETA when total duration is known', async () => {
  const { engine, run } = new Function(block + '\nreturn {engine:mediaFFmpegEngine,run:runMediaFFmpeg};')();
  engine.runMediaFFmpeg = async (inputs, args, report) => {
    report({phase:'runtime-ready'});
    report({phase:'ffmpeg-progress',data:{time:30000000,progress:0.25}});
    report({phase:'ffmpeg-log',data:{message:'frame= 600 time=00:01:00.00 bitrate=500kbits/s speed=2.00x'}});
    report({phase:'ffmpeg-progress',data:{time:120000000,progress:1}});
    return new Blob(['output']);
  };
  const messages=[];
  await run([{duration:120,role:'auto'}],[],text=>messages.push(text));
  assert.ok(messages.some(text=>text.includes('25%')&&text.includes('00:30 / 02:00')));
  assert.ok(messages.some(text=>text.includes('50%')&&text.includes('2.00x')&&text.includes('预计剩余 00:30')));
  assert.ok(messages.every(text=>!text.includes('100%')),'completion is shown only after the output is saved');
});

test('FFmpeg key-value logs provide progress even when its native progress callback is absent', async () => {
  const { engine, run } = new Function(block + '\nreturn {engine:mediaFFmpegEngine,run:runMediaFFmpeg};')();
  engine.runMediaFFmpeg=async(inputs,args,report)=>{
    for(const message of ['Duration: 00:02:00.00, start: 0.000000','out_time_us=60000000','out_time_ms=60000000','speed=4.0x']) report({phase:'ffmpeg-log',data:{message}});
    return new Blob(['output']);
  };
  const messages=[];await run([{}],[],text=>messages.push(text));
  assert.ok(messages.some(text=>text.includes('50%')&&text.includes('01:00 / 02:00')&&text.includes('4.00x')&&text.includes('预计剩余 00:15')));
});

test('unknown duration displays processed media time instead of fabricating a percentage', async () => {
  const { engine, run }=new Function(block+'\nreturn {engine:mediaFFmpegEngine,run:runMediaFFmpeg};')();
  engine.runMediaFFmpeg=async(inputs,args,report)=>{
    report({phase:'runtime-ready'});
    report({phase:'ffmpeg-progress',data:{time:10000000,progress:NaN}});
    report({phase:'ffmpeg-log',data:{message:'out_time=00:00:15.00'}});
    return new Blob(['output']);
  };
  const messages=[];await run([{}],[],text=>messages.push(text));
  assert.ok(messages.some(text=>text.includes('已处理 00:15')));
  assert.ok(messages.every(text=>!text.includes('%')&&!text.includes('预计剩余')));
});
