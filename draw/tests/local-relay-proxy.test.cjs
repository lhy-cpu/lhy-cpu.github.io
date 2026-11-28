'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { proxySettings } = require('../tools/local-relay/server.cjs');
const ORIGIN = 'https://drawing.example';
const RELAYS = path.join(__dirname, '../tools/local-relay');

test('proxy settings: --proxy wins, environment fallback, NO_PROXY and loopback bypass', () => {
    const env = { HTTPS_PROXY: 'http://env.proxy:8080', HTTP_PROXY: 'http://plain.proxy:3128', NO_PROXY: 'internal.example,.corp' };
    const route = (settings, url) => settings.for(new URL(url))?.host || null;
    const fromEnv = proxySettings(undefined, env);
    assert.equal(route(fromEnv, 'https://api.example/v1/chat/completions'), 'env.proxy:8080');
    assert.equal(route(fromEnv, 'http://api.example/v1/chat/completions'), 'plain.proxy:3128');
    for (const direct of ['https://internal.example/x', 'https://a.b.corp/x', 'http://127.0.0.1:11434/v1/chat/completions', 'http://localhost:1/x', 'http://[::1]:1/x']) assert.equal(route(fromEnv, direct), null, direct);
    const fixed = proxySettings('http://user:pass@127.0.0.1:7890', env);
    assert.equal(route(fixed, 'https://internal.example/x'), '127.0.0.1:7890');
    assert.match(fixed.describe(), /127\.0\.0\.1:7890 \(--proxy\)/);
    assert.doesNotMatch(fixed.describe(), /pass/);
    assert.throws(() => proxySettings('socks5://127.0.0.1:1080', {}));
    assert.match(proxySettings(undefined, { HTTPS_PROXY: 'socks5://x:1' }).describe(), /ignored/);
    assert.match(proxySettings(undefined, {}).describe(), /none \(direct connection\)/);
});

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;

test('python relay rejects origins that browsers never send', { skip: !pythonAvailable && 'Python 3 is unavailable' }, () => {
    for (const origin of ['https://Drawing.Example', 'https://drawing.example:443', 'http://drawing.example:80', 'https://drawing.example/', 'https://drawing.example:99999']) {
        const result = spawnSync('python3', [path.join(RELAYS, 'server.py'), '--origin', origin, '--port', '1'], { encoding: 'utf8', timeout: 5000 });
        assert.equal(result.status, 2, origin);
    }
});

test('python relay allows built-in origins by default and echoes the request origin', { skip: !pythonAvailable && 'Python 3 is unavailable' }, async t => {
    const holder = net.createServer(); holder.listen(0, '127.0.0.1'); await once(holder, 'listening');
    const port = holder.address().port; await new Promise(resolve => holder.close(resolve));
    const child = spawn('python3', [path.join(RELAYS, 'server.py'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill());
    let output = '';
    const token = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('relay startup timeout: ' + output)), 5000);
        child.stdout.on('data', b => { output += b; const m = output.match(/Token \(paste into AI settings\): ([a-f0-9]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`relay exited ${code}`)); });
    });
    assert.match(output, /Allowed webpage origins: https:\/\/draw\.lhye\.work, https:\/\/github\.lhye\.work, null/);
    const health = origin => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/health', headers: { Origin: origin, 'X-FlowSketch-Token': token } }, res => {
            res.resume(); res.on('end', () => resolve({ status: res.statusCode, allow: res.headers['access-control-allow-origin'] }));
        }).on('error', reject);
    });
    for (const origin of ['https://draw.lhye.work', 'https://github.lhye.work', 'null']) assert.deepEqual(await health(origin), { status: 200, allow: origin });
    assert.equal((await health(ORIGIN)).status, 403);
});

function certificate(dir) {
    const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=upstream.test', '-addext', 'subjectAltName=DNS:upstream.test'], { stdio: 'ignore' });
    return made.status === 0 ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert), certFile: cert } : null;
}

for (const runtime of ['node', 'python']) {
    test(`${runtime}: relay reaches upstreams through an HTTP proxy`, { skip: runtime === 'python' && !pythonAvailable && 'Python 3 is unavailable' }, async t => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-proxy-'));
        const tlsMaterial = certificate(dir);
        const children = [], servers = [];
        t.after(async () => {
            children.forEach(child => child.kill());
            tunnels.forEach(socket => socket.destroy());
            for (const server of servers) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
            fs.rmSync(dir, { recursive: true, force: true });
        });
        const seen = [];
        const handler = (req, res) => { let body = ''; req.on('data', b => body += b); req.on('end', () => { seen.push({ url: req.url, host: req.headers.host, auth: req.headers.authorization }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }); };
        const plain = http.createServer(handler); plain.listen(0, '127.0.0.1'); await once(plain, 'listening'); servers.push(plain);
        let secure = null;
        if (tlsMaterial) { secure = https.createServer({ key: tlsMaterial.key, cert: tlsMaterial.cert }, handler); secure.listen(0, '127.0.0.1'); await once(secure, 'listening'); servers.push(secure); }
        const hits = [], tunnels = [];
        const proxy = http.createServer((req, res) => {
            hits.push({ kind: 'absolute', url: req.url, auth: req.headers['proxy-authorization'] });
            const url = new URL(req.url);
            const upstream = http.request({ host: '127.0.0.1', port: url.port, path: url.pathname, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
            req.pipe(upstream);
        });
        proxy.on('connect', (req, socket) => {
            tunnels.push(socket);
            hits.push({ kind: 'connect', url: req.url, auth: req.headers['proxy-authorization'] });
            const port = Number(req.url.split(':').pop());
            const upstream = net.connect(port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); upstream.pipe(socket); socket.pipe(upstream); });
            upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
        });
        proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); servers.push(proxy);
        const proxyURL = `http://user:secret@127.0.0.1:${proxy.address().port}`;

        async function relay(args, env = {}) {
            const holder = net.createServer(); holder.listen(0, '127.0.0.1'); await once(holder, 'listening');
            const port = holder.address().port; await new Promise(resolve => holder.close(resolve));
            const script = runtime === 'node' ? [path.join(RELAYS, 'server.cjs')] : [path.join(RELAYS, 'server.py')];
            const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k)));
            const child = spawn(runtime === 'node' ? process.execPath : 'python3', [...script, '--origin', ORIGIN, '--port', String(port), ...args],
                { env: { ...cleanEnv, ...(tlsMaterial ? { NODE_EXTRA_CA_CERTS: tlsMaterial.certFile, SSL_CERT_FILE: tlsMaterial.certFile } : {}), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
            children.push(child);
            let output = '';
            const token = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('relay startup timeout: ' + output)), 5000);
                child.stdout.on('data', b => { output += b; const m = output.match(/Token \(paste into AI settings\): ([a-f0-9]+)/); if (m && /Upstream proxy:/.test(output)) { clearTimeout(timer); resolve(m[1]); } });
                child.once('exit', code => { clearTimeout(timer); reject(new Error(`relay exited ${code}`)); });
            });
            const post = target => new Promise((resolve, reject) => {
                const body = '{"model":"m"}';
                const req = http.request({ host: '127.0.0.1', port, path: '/proxy', method: 'POST', headers: { Host: `127.0.0.1:${port}`, Origin: ORIGIN, 'X-FlowSketch-Token': token, 'X-FlowSketch-Target': target, 'Content-Type': 'application/json', 'Content-Length': body.length, Authorization: 'Bearer k' } }, res => {
                    let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
                });
                req.on('error', reject); req.end(body);
            });
            return { post, output };
        }

        const explicit = await relay(['--proxy', proxyURL]);
        assert.match(explicit.output, /Upstream proxy: 127\.0\.0\.1:\d+ \(--proxy\)/);
        assert.doesNotMatch(explicit.output, /secret/);
        const plainTarget = `http://upstream.test:${plain.address().port}/v1/chat/completions`;
        assert.equal((await explicit.post(plainTarget)).status, 200);
        assert.deepEqual(hits.at(-1), { kind: 'absolute', url: plainTarget, auth: 'Basic ' + Buffer.from('user:secret').toString('base64') });
        assert.equal(seen.at(-1).host, `upstream.test:${plain.address().port}`);
        assert.equal(seen.at(-1).auth, 'Bearer k');
        if (secure) {
            const secureTarget = `https://upstream.test:${secure.address().port}/v1/chat/completions`;
            const result = await explicit.post(secureTarget);
            assert.equal(result.status, 200, result.body);
            assert.deepEqual(hits.at(-1), { kind: 'connect', url: `upstream.test:${secure.address().port}`, auth: 'Basic ' + Buffer.from('user:secret').toString('base64') });
            assert.equal(seen.at(-1).auth, 'Bearer k');
        }
        const before = hits.length;
        assert.equal((await explicit.post(`http://127.0.0.1:${plain.address().port}/v1/chat/completions`)).status, 200);
        assert.equal(hits.length, before, 'loopback targets are never proxied');

        const fromEnv = await relay([], { HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: 'skip.test' });
        assert.equal((await fromEnv.post(plainTarget)).status, 200);
        assert.equal(hits.at(-1).url, plainTarget);
        const count = hits.length;
        assert.equal((await fromEnv.post(`http://skip.test:${plain.address().port}/v1/chat/completions`)).status, 502);
        assert.equal(hits.length, count, 'NO_PROXY hosts connect directly');
    });
}
