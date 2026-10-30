'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');
const { createRelay, parseArgs } = require('../tools/local-relay/server.cjs');
const ORIGIN = 'https://drawing.example';

test('relay CLI requires exact origin and bounded port', () => {
    assert.deepEqual(parseArgs(['--origin', 'null']), { origin: 'null', port: 18765 });
    for (const args of [[], ['--origin', '*'], ['--origin', ORIGIN + '/'], ['--origin', ORIGIN, '--port', '0']]) assert.throws(() => parseArgs(args));
});

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
const powershellAvailable = process.platform === 'win32' && spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;
for (const runtime of ['node', 'python', 'powershell']) {
    const skip = runtime === 'python' && !pythonAvailable ? 'Python 3 is unavailable' :
        runtime === 'powershell' && !powershellAvailable ? 'Requires Windows with native Windows PowerShell' : false;
    test(`${runtime}: local relay integration`, { skip }, async t => {
        let upstream, relay, child, relayPort, token, captured, cancellation;
        t.after(async () => {
            child?.kill();
            relay?.closeAllConnections();
            if (relay) await new Promise(resolve => relay.close(resolve));
            if (upstream) {
                upstream.closeAllConnections();
                await new Promise(resolve => upstream.close(resolve));
            }
        });
        upstream = http.createServer((req, res) => {
            captured = { method: req.method, headers: req.headers, body: '' };
            req.on('data', b => captured.body += b);
            req.on('end', () => {
                const body = JSON.parse(captured.body);
                if (body.mode === 'stream' || body.mode === 'cancel') {
                    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                    res.write('data: {"delta":"first"}\n\n');
                    if (body.mode === 'stream') setTimeout(() => res.end('data: [DONE]\n\n'), 250);
                    else {
                        const timer = setInterval(() => res.write(': heartbeat\n\n'), 100);
                        res.on('close', () => { clearInterval(timer); cancellation?.(); });
                    }
                } else if (body.mode === 'redirect') { res.writeHead(307, { Location: 'http://never.example/chat/completions' }); res.end('{}'); }
                else { res.writeHead(429, { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=no', 'Retry-After': '2' }); res.end('{"error":"rate limit"}'); }
            });
        });
        upstream.listen(0, '127.0.0.1');
        await once(upstream, 'listening');
        const target = `http://127.0.0.1:${upstream.address().port}/v1/chat/completions`;
        if (runtime === 'node') {
            ({ server: relay, token } = createRelay({ origin: ORIGIN, port: 0 }));
            relay.listen(0, '127.0.0.1');
            await once(relay, 'listening');
            relayPort = relay.address().port;
        } else {
            const placeholder = http.createServer(); placeholder.listen(0, '127.0.0.1'); await once(placeholder, 'listening');
            relayPort = placeholder.address().port; await new Promise(resolve => placeholder.close(resolve));
            const command = runtime === 'powershell' ? 'powershell.exe' : 'python3';
            const launchArgs = runtime === 'powershell' ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../tools/local-relay/server.ps1')] : [path.join(__dirname, '../tools/local-relay/server.py')];
            child = spawn(command, [...launchArgs, '--origin', ORIGIN, '--port', String(relayPort)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            await new Promise((resolve, reject) => {
                let output = '', diagnostics = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error(`${runtime} startup timeout: ${diagnostics}`)); }, runtime === 'powershell' ? 20000 : 5000);
                child.stdout.on('data', bytes => { output += bytes; const match = output.match(/Token \(paste into AI settings\): ([a-f0-9]+)/); if (match) { token = match[1]; clearTimeout(timer); resolve(); } });
                child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-4000); });
                child.once('error', error => { clearTimeout(timer); reject(error); });
                child.once('exit', code => { clearTimeout(timer); reject(new Error(`${runtime} exited ${code}: ${diagnostics}`)); });
            });
        }
        function request({ method = 'GET', route = '/health', headers = {}, body } = {}) {
            return new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port: relayPort, path: route, method, headers: { Origin: ORIGIN, 'X-FlowSketch-Token': token, ...headers } }, res => {
                    const chunks = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
                    res.on('error', reject);
                });
                req.on('error', reject);
                req.end(body);
            });
        }
        const proxyHeaders = { 'X-FlowSketch-Target': target, 'Content-Type': 'application/json', Authorization: 'Bearer private-key', Accept: 'text/event-stream', Cookie: 'browser-secret', Referer: ORIGIN + '/private' };
        const post = (value, extra = {}) => { const body = JSON.stringify(value); return request({ method: 'POST', route: '/proxy', headers: { ...proxyHeaders, 'Content-Length': Buffer.byteLength(body), ...extra }, body }); };

        await t.test('health and exact origin/token/host boundaries', async () => {
            const result = await request();
            assert.deepEqual(JSON.parse(result.body), { service: 'flowsketch-local-relay', version: 1 });
            assert.equal(result.headers['access-control-allow-origin'], ORIGIN);
            const denied = await request({ headers: { 'X-FlowSketch-Token': '' } });
            assert.equal(denied.status, 401);
            assert.equal(denied.headers['x-flowsketch-relay-error'], '1');
            assert.equal(denied.headers['access-control-expose-headers'], 'X-FlowSketch-Relay-Error');
            assert.equal((await request({ headers: { Origin: 'https://evil.example' } })).status, 403);
            assert.equal((await request({ headers: { Host: `evil.example:${relayPort}` } })).status, 403);
            assert.equal((await request({ route: '/proxy', method: 'GET' })).status, 405);
        });
        await t.test('browser CORS/private-network preflight without token', async () => {
            const result = await request({ method: 'OPTIONS', route: '/proxy', headers: { 'X-FlowSketch-Token': '', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-flowsketch-token,x-flowsketch-target', 'Access-Control-Request-Private-Network': 'true' } });
            assert.equal(result.status, 204);
            assert.equal(result.headers['access-control-allow-private-network'], 'true');
            assert.equal((await request({ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 403);
        });
        await t.test('preserve JSON HTTP errors and whitelist upstream headers', async () => {
            const result = await post({ messages: [{ content: 'private body' }] });
            assert.equal(result.status, 429);
            assert.equal(result.headers['x-flowsketch-relay-error'], undefined);
            assert.equal(result.headers['retry-after'], '2');
            assert.equal(result.headers['set-cookie'], undefined);
            assert.equal(captured.method, 'POST');
            assert.equal(captured.headers.authorization, 'Bearer private-key');
            for (const name of ['origin', 'cookie', 'referer', 'x-flowsketch-token', 'x-flowsketch-target']) assert.equal(captured.headers[name], undefined, name);
        });
        await t.test('reject malformed JSON, wrong content type and unsafe targets', async () => {
            for (const value of ['https://user:key@example.com/v1/chat/completions', target + '?key=secret', target + '#x', 'file:///chat/completions', target.replace('/chat/completions', '/models')]) {
                assert.equal((await post({}, { 'X-FlowSketch-Target': value })).status, 400, value);
            }
            assert.equal((await post({}, { 'Content-Type': 'text/plain' })).status, 415);
            assert.equal((await request({ method: 'POST', route: '/proxy', headers: { ...proxyHeaders, 'Content-Length': '1' }, body: '{' })).status, 400);
            assert.equal((await post([])).status, 400);
            assert.equal((await post({}, { 'Content-Length': String(40 * 1024 * 1024 + 1) })).status, 413);
        });
        await t.test('does not follow upstream redirect', async () => assert.equal((await post({ mode: 'redirect' })).status, 307));
        await t.test('SSE forwards first chunk before upstream finishes; cancellation closes upstream', async () => {
            let firstAt;
            const body = JSON.stringify({ mode: 'stream' });
            const response = await new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port: relayPort, path: '/proxy', method: 'POST', headers: { ...proxyHeaders, Origin: ORIGIN, 'X-FlowSketch-Token': token, 'Content-Length': Buffer.byteLength(body) } }, res => {
                    let data = ''; res.on('data', chunk => { firstAt ??= Date.now(); data += chunk; }); res.on('end', () => resolve(data)); res.on('error', reject);
                }); req.on('error', reject); req.end(body);
            });
            assert.ok(Date.now() - firstAt >= 150, 'first SSE data must arrive before delayed final chunk');
            assert.match(response, /\[DONE\]/);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('upstream was not cancelled')), 2500);
                cancellation = () => { clearTimeout(timer); resolve(); };
                const cancelBody = JSON.stringify({ mode: 'cancel' });
                const req = http.request({ host: '127.0.0.1', port: relayPort, path: '/proxy', method: 'POST', headers: { ...proxyHeaders, Origin: ORIGIN, 'X-FlowSketch-Token': token, 'Content-Length': Buffer.byteLength(cancelBody) } }, res => res.once('data', () => res.destroy()));
                req.on('error', () => {}); req.end(cancelBody);
            });
        });
    });
}
