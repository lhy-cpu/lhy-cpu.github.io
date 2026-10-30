const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/ai-client.js'), 'utf8');
function client(fetch) {
  const context = { window: {}, fetch, URL, TextEncoder, TextDecoder, Error };
  vm.runInNewContext(source, context);
  return context.window.FlowSketchAIClient;
}
const config = { apiUrl: 'https://api.example/v1', key: 'secret-key', model: 'model', stream: false, mode: 'text', timeoutSeconds: 600, historyTurns: 100 };
function request(api, overrides = {}) { return api.complete({ config: { ...config, ...overrides.config }, messages: [], ...overrides }); }
function wire(content = '你好', finish = 'stop', toolCalls) {
  return { choices: [{ message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }] };
}
function json(value) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function event(delta, reason = null) { return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] }) + '\r\n\r\n'; }
function stream(text, sizes = [1]) {
  const bytes = new TextEncoder().encode(text);
  let position = 0, count = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position === bytes.length) return controller.close();
    const next = Math.min(bytes.length, position + sizes[count++ % sizes.length]);
    controller.enqueue(bytes.slice(position, next)); position = next;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function streamRequest(api, options = {}) { return api.complete({ config: { ...config, stream: true }, messages: [], ...options }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function persistentStream(payload) {
  let cancelled = false;
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
  return { response, get cancelled() { return cancelled; } };
}
async function promptly(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Completion waited for transport EOF or cancellation')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

test('endpoint normalization and prohibited components', () => {
  const api = client();
  for (const [input, expected] of [
    ['https://api.example', 'https://api.example/v1/chat/completions'],
    ['https://api.example/', 'https://api.example/v1/chat/completions'],
    ['http://localhost:8000/v1/', 'http://localhost:8000/v1/chat/completions'],
    ['https://api.example/custom', 'https://api.example/custom/chat/completions'],
    ['https://api.example/v1/chat/completions/', 'https://api.example/v1/chat/completions'],
  ]) assert.equal(api.endpoint(input), expected);
  for (const input of ['no-url', 'file:///a', 'https://u:p@host', 'https://host/?key=secret', 'https://host/#secret', 'https://host/?', 'https://host/#']) assert.throws(() => api.endpoint(input));
});

test('JSON result and safe fetch options, tool mode gated', async () => {
  const seen = [];
  const api = client(async (url, options) => { seen.push({ url, ...options }); return json(wire()); });
  assert.deepEqual(plain(await request(api)), { role: 'assistant', content: '你好' });
  assert.equal(seen[0].credentials, 'omit');
  assert.equal(seen[0].referrerPolicy, 'no-referrer');
  assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].headers.Authorization, 'Bearer secret-key');
  assert.equal(JSON.parse(seen[0].body).stream, false);
  assert.equal('tools' in JSON.parse(seen[0].body), false);
  assert.equal('timeoutSeconds' in JSON.parse(seen[0].body), false);
  assert.equal('historyTurns' in JSON.parse(seen[0].body), false);
  const tools = [{ type: 'function', function: { name: 'draw' } }];
  await api.complete({ config: { ...config, mode: 'tools', key: '' }, messages: [], tools });
  assert.deepEqual(JSON.parse(seen[1].body).tools, tools);
  assert.equal(JSON.parse(seen[1].body).tool_choice, 'auto');
  assert.equal('Authorization' in seen[1].headers, false);
});

test('JSON tool response and no wire metadata', async () => {
  const calls = [{ id: 'call_a', type: 'function', function: { name: 'draw', arguments: '{"x":1}' } }];
  const api = client(async () => json(wire(null, 'tool_calls', calls)));
  assert.deepEqual(plain(await request(api)), { role: 'assistant', content: null, tool_calls: calls });
});

test('SSE UTF-8 split bytes, CRLF split, multi data lines, usage and content callbacks', async () => {
  const first = 'data: {"choices":\r\ndata: [{"index":0,"delta":{"role":"assistant","content":"你好"},"finish_reason":null}]}\r\n\r\n';
  const payload = ': keepalive\r\n\r\n' + first + event({ content: '世界' }) + event({}, 'stop') + 'data: {"choices":[],"usage":{"total_tokens":9}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const deltas = [];
  const result = await streamRequest(client(async () => stream(payload, [1, 2, 3, 7])), { onDelta: (part, full) => deltas.push([part, full]) });
  assert.deepEqual(plain(result), { role: 'assistant', content: '你好世界' });
  assert.deepEqual(deltas, [['你好', '你好'], ['世界', '你好世界']]);
});

test('SSE indexed tool fragments aggregate in index order and only content calls back', async () => {
  const payload = event({ role: 'assistant', tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'mov', arguments: '{' } }, { index: 0, id: 'call_a', type: 'function', function: { name: 'dr', arguments: '{"x":' } }] })
    + event({ tool_calls: [{ index: 0, function: { name: 'aw', arguments: '1}' } }, { index: 1, function: { name: 'e', arguments: '}' } }] })
    + event({}, 'tool_calls') + 'data: [DONE]\n\n';
  const deltas = [];
  const result = await streamRequest(client(async () => stream(payload)), { onDelta: (...args) => deltas.push(args) });
  assert.deepEqual(plain(result), { role: 'assistant', content: null, tool_calls: [
    { id: 'call_a', type: 'function', function: { name: 'draw', arguments: '{"x":1}' } },
    { id: 'call_b', type: 'function', function: { name: 'move', arguments: '{}' } },
  ] });
  assert.deepEqual(deltas, []);
});

test('SSE DONE completes and cancels a persistent body without waiting for cleanup', async () => {
  const connection = persistentStream(event({ content: '完成' }) + event({}, 'stop') + 'data: [DONE]\n\n: keepalive\n');
  const result = await promptly(streamRequest(client(async () => connection.response)));
  assert.deepEqual(plain(result), { role: 'assistant', content: '完成' });
  assert.equal(connection.cancelled, true);
  assert.equal(connection.response.body.locked, false);
});

test('persistent SSE still rejects invalid finishes and buffered data after DONE', async () => {
  const done = 'data: [DONE]\n\n';
  for (const [payload, message] of [
    [event({ content: 'partial' }) + done, /缺少结束标记/],
    [event({}, 'length') + done, /长度限制/],
    [event({}, 'content_filter') + done, /内容过滤/],
    [event({}, 'tool_calls') + done, /工具调用缺失/],
    [event({ tool_calls: [{ index: 0, function: { name: 'draw', arguments: '{}' } }] }, 'tool_calls') + done, /工具调用不完整/],
    [event({}, 'stop') + done + 'data: {}\n\n', /结束标记之后/],
    [event({}, 'stop') + done + 'data: {', /结束标记之后/],
    [event({}, 'stop') + done + 'event: error', /错误事件/],
  ]) {
    const connection = persistentStream(payload);
    await assert.rejects(promptly(streamRequest(client(async () => connection.response))), message);
    assert.equal(connection.cancelled, true);
    assert.equal(connection.response.body.locked, false);
  }
});

test('persistent SSE validates UTF-8 and byte limit of the complete buffered chunk', async () => {
  const prefix = new TextEncoder().encode(event({}, 'stop') + 'data: [DONE]\n\n');
  const partialUTF8 = new Uint8Array(prefix.length + 1);
  partialUTF8.set(prefix); partialUTF8[prefix.length] = 0xe4;
  const invalid = persistentStream(partialUTF8);
  await assert.rejects(promptly(streamRequest(client(async () => invalid.response))), /不完整的 UTF-8/);
  assert.equal(invalid.cancelled, true);
  const oversized = persistentStream(event({}, 'stop') + 'data: [DONE]\n\n:' + 'x'.repeat(2 * 1024 * 1024));
  await assert.rejects(promptly(streamRequest(client(async () => oversized.response))), /2MB/);
  assert.equal(oversized.cancelled, true);
});

test('rejects truncated SSE, errors and malformed protocol', async () => {
  for (const payload of [event({ content: 'partial' }), event({}, 'stop'), event({}) + 'data: [DONE]\n\n',
    'data: {"error":{"message":"secret-key"}}\n\n', 'event: error\ndata: {}\n\n', 'data: invalid\n\n',
    event({}, 'length') + 'data: [DONE]\n\n', event({}, 'content_filter') + 'data: [DONE]\n\n',
    event({ tool_calls: [{ index: 0, function: { name: 'draw', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n',
    event({ tool_calls: [{ index: 100 }] }), event({}, 'stop') + 'data: [DONE]\n\ndata: {}\n\n',
  ]) await assert.rejects(streamRequest(client(async () => stream(payload, [65536]))), (error) => !error.message.includes('secret-key'));
});

test('rejects malformed JSON and interrupted completion reasons', async () => {
  for (const payload of [wire('partial', 'length'), wire('hidden', 'content_filter'), wire('partial', null), { error: { message: 'secret-key' } }, {}, wire([], 'stop'), wire(null, 'tool_calls', [])]) {
    await assert.rejects(request(client(async () => json(payload))), (error) => !error.message.includes('secret-key'));
  }
});

test('HTTP and network failures never echo credentials', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(request(client(async () => new Response('secret-key', { status }))), (error) => error.message.includes(String(status)) && !error.message.includes('secret-key'));
  }
  await assert.rejects(request(client(async () => { throw new Error('API secret-key connection error'); })), (error) => !error.message.includes('secret-key'));
});

test('initial fetch failure promptly explains possible CORS and supplier configuration safely', async () => {
  const api = client(async () => { throw new TypeError('Failed to fetch secret-key https://private.example/?token=private'); });
  await assert.rejects(promptly(request(api)), (error) => {
    assert.equal(error.code, 'NETWORK_OR_CORS');
    for (const text of ['可能', 'CORS', '供应商', '当前网页来源', 'Content-Type', 'Authorization', 'OPTIONS', '网络', 'HTTPS']) assert.ok(error.message.includes(text));
    assert.equal(error.message.includes('secret-key'), false);
    assert.equal(error.message.includes('private'), false);
    assert.equal(error.message.includes('Failed to fetch'), false);
    return true;
  });
});

test('transport failure while reading a response is not presented as CORS', async () => {
  for (const streaming of [false, true]) {
    const api = client(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError('secret-key private upstream error')); },
    })));
    await assert.rejects(request(api, { config: { ...config, stream: streaming } }), (error) => {
      assert.match(error.message, /响应读取中断/);
      assert.equal(error.code, undefined);
      assert.equal(error.message.includes('CORS'), false);
      assert.equal(error.message.includes('secret-key'), false);
      return true;
    });
  }
});

test('abort signal forwarded and cancellation has safe message', async () => {
  const controller = new AbortController(); controller.abort();
  const api = client(async (_, options) => { assert.equal(options.signal, controller.signal); throw new DOMException('secret-key', 'AbortError'); });
  await assert.rejects(request(api, { signal: controller.signal }), (error) => {
    assert.match(error.message, /已取消或超时/);
    assert.equal(error.code, undefined);
    assert.equal(error.message.includes('CORS'), false);
    return true;
  });
});

test('response and tool argument size limits', async () => {
  await assert.rejects(request(client(async () => json(wire('x'.repeat(2 * 1024 * 1024))))), /2MB/);
  const calls = [{ id: 'a', type: 'function', function: { name: 'draw', arguments: 'x'.repeat(1024 * 1024 + 1) } }];
  await assert.rejects(request(client(async () => json(wire(null, 'tool_calls', calls)))), /1MB/);
  const payload = event({ tool_calls: [{ index: 0, id: 'a', function: { name: 'draw', arguments: 'x'.repeat(1024 * 1024 + 1) } }] }, 'tool_calls');
  await assert.rejects(streamRequest(client(async () => stream(payload, [65536]))), /1MB/);
});


test('invalid UTF-8 is rejected and incomplete indexed calls are rejected', async () => {
  const response = () => new Response(new Uint8Array([0xff, 0xfe]));
  await assert.rejects(streamRequest(client(async () => response())), /UTF-8/);
  await assert.rejects(request(client(async () => response())), /UTF-8/);
  const payload = event({ tool_calls: [{ index: 1, id: 'a', function: { name: 'draw', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n';
  await assert.rejects(streamRequest(client(async () => stream(payload))), /序号不完整/);
  const calls = Array.from({ length: 101 }, (_, i) => ({ id: 'a' + i, type: 'function', function: { name: 'draw', arguments: '{}' } }));
  await assert.rejects(request(client(async () => json(wire(null, 'tool_calls', calls)))), /数量超过限制/);
});

test('relay URL validation prevents forwarding API credentials to a remote helper', () => {
  const api = client();
  assert.equal(api.relayEndpoint('http://127.0.0.1:18765/'), 'http://127.0.0.1:18765');
  assert.equal(api.relayEndpoint('http://localhost:1234'), 'http://localhost:1234');
  for (const value of ['https://127.0.0.1:18765', 'http://example.test:18765', 'http://192.168.1.1',
    'http://127.0.0.1.attacker.test', 'http://user:pass@localhost', 'http://localhost/proxy',
    'http://localhost/?', 'http://localhost/#', 'file:///tmp/socket']) assert.throws(() => api.relayEndpoint(value));
});

test('local forwarding separates upstream credentials, local token and model payload', async () => {
  const seen = [];
  const api = client(async (url, options) => { seen.push({ url, ...options }); return json(wire()); });
  const local = {...config, connection:'local', relayUrl:'http://127.0.0.1:18765', relayToken:'local-secret'};
  await api.complete({config:local,messages:[]});
  assert.equal(seen[0].url, 'http://127.0.0.1:18765/proxy');
  assert.equal(seen[0].headers['X-FlowSketch-Target'], 'https://api.example/v1/chat/completions');
  assert.equal(seen[0].headers['X-FlowSketch-Token'], 'local-secret');
  assert.equal(seen[0].headers.Authorization, 'Bearer secret-key');
  assert.equal(seen[0].targetAddressSpace, 'loopback');
  assert.equal(seen[0].credentials, 'omit');
  assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].body.includes('secret'), false);
  await api.complete({config:{...local,connection:'direct'},messages:[]});
  assert.equal(seen[1].url, 'https://api.example/v1/chat/completions');
  assert.equal('X-FlowSketch-Token' in seen[1].headers, false);
  assert.equal('X-FlowSketch-Target' in seen[1].headers, false);
});

test('relay health probe sends only local token and checks service identity', async () => {
  const config = {relayUrl:'http://127.0.0.1:18765',relayToken:'local-secret',key:'never-send',apiUrl:'https://private.test'};
  const api = client(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:18765/health');
    assert.deepEqual(plain(options.headers), {'X-FlowSketch-Token':'local-secret'});
    assert.equal(options.targetAddressSpace, 'loopback');
    return json({service:'flowsketch-local-relay',version:1});
  });
  assert.equal(await api.checkRelay(config), true);
  await assert.rejects(client(async () => json({service:'other',version:1})).checkRelay(config), /不是兼容/);
  await assert.rejects(client(async () => json({service:'flowsketch-local-relay',version:2})).checkRelay(config), /不是兼容/);
  await assert.rejects(client(async () => new Response('',{status:403})).checkRelay(config), /来源及连接口令/);
});

test('local failures never fall back to direct API or leak credentials', async () => {
  let count = 0;
  const api = client(async () => { count++;throw Error('secret-key local-secret'); });
  await assert.rejects(api.complete({config:{...config,connection:'local',relayToken:'local-secret'},messages:[]}), error => {
    assert.equal(error.code, 'LOCAL_RELAY_UNAVAILABLE');
    assert.match(error.message, /回环网络/);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  assert.equal(count, 1);
  for (const relayToken of ['', '\r\nsecret', 'a'.repeat(257)]) {
    await assert.rejects(api.complete({config:{...config,connection:'local',relayToken},messages:[]}), /连接口令/);
  }
  assert.equal(count, 1);
});
