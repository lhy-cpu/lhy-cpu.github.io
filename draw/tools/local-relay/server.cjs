#!/usr/bin/env node
'use strict';
// Deliberately dependency-free: no project data, request bodies, or credentials are logged.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const tls = require('node:tls');
const net = require('node:net');
const MAX_BODY = 40 * 1024 * 1024;
const MAX_TIME = 3600 * 1000;
const DEFAULT_ORIGINS = Object.freeze(['https://draw.lhye.work', 'https://github.lhye.work', 'null']);

function parseArgs(args) {
    const options = { port: 18765 }, origins = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--origin') origins.push(args[++i]);
        else if (args[i] === '--port') options.port = Number(args[++i]);
        else if (args[i] === '--proxy') options.proxy = args[++i];
        else throw new Error('Usage: [--origin https://your-page.example ...] [--port 18765] [--proxy http://127.0.0.1:7890]');
    }
    for (const origin of origins) {
        if (origin === 'null') continue;
        let url;
        try { url = new URL(origin); } catch { throw new Error('Supply --origin with the exact webpage origin, or null for file://.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('--origin must be an exact HTTP(S) origin without a path.');
    }
    options.origins = origins.length ? [...new Set(origins)] : DEFAULT_ORIGINS;
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be 1..65535.');
    if (options.proxy !== undefined) parseProxy(options.proxy, '--proxy');
    return options;
}

function parseProxy(value, source) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${source} must be an http:// proxy URL such as http://127.0.0.1:7890.`); }
    if (url.protocol !== 'http:' || url.pathname !== '/' || url.search || url.hash) throw new Error(`${source} must be an http:// proxy URL such as http://127.0.0.1:7890.`);
    return url;
}

const isLoopback = host => host === 'localhost' || host === '[::1]' || /^127\./.test(host);

function proxySettings(explicit, env = process.env) {
    const pick = (...names) => { for (const name of names) if (env[name]) return { value: env[name], source: name }; return null; };
    const fixed = explicit !== undefined ? { value: explicit, source: '--proxy' } : null;
    const forProtocol = {
        'https:': fixed || pick('HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'),
        'http:': fixed || pick('HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'),
    };
    const parsed = {};
    for (const [protocol, entry] of Object.entries(forProtocol)) {
        if (!entry) continue;
        try { parsed[protocol] = { url: parseProxy(entry.value, entry.source), source: entry.source }; }
        catch (error) { if (entry.source === '--proxy') throw error; parsed[protocol] = { error: `${entry.source} ignored: only http:// proxies are supported.` }; }
    }
    const bypass = fixed ? [] : String(env.NO_PROXY || env.no_proxy || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    return {
        describe() {
            const notes = Object.values(parsed).filter(x => x.error).map(x => x.error);
            const active = [...new Set(Object.values(parsed).filter(x => x.url).map(x => `${x.url.host} (${x.source})`))];
            return [active.length ? `Upstream proxy: ${active.join(', ')}` : 'Upstream proxy: none (direct connection)', ...notes].join('\n');
        },
        for(target) {
            const entry = parsed[target.protocol];
            if (!entry?.url || isLoopback(target.hostname)) return null;
            const host = target.hostname.toLowerCase(), port = target.port || (target.protocol === 'https:' ? '443' : '80');
            if (bypass.some(rule => rule === '*' || rule === `${host}:${port}` || rule.replace(/^\*?\./, '') === host || host.endsWith('.' + rule.replace(/^\*?\./, '')))) return null;
            return entry.url;
        },
    };
}

function proxyAuthorization(proxy) {
    if (!proxy.username && !proxy.password) return {};
    const user = decodeURIComponent(proxy.username), pass = decodeURIComponent(proxy.password);
    return { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
}

function sendUpstream(target, proxy, headers, body, onResponse, onError) {
    const transport = target.protocol === 'https:' ? https : http;
    if (!proxy) {
        const request = transport.request(target, { method: 'POST', headers }, onResponse);
        request.on('error', onError);
        request.end(body);
        return { destroy: () => request.destroy() };
    }
    const proxyPort = Number(proxy.port || 80), auth = proxyAuthorization(proxy);
    if (target.protocol === 'http:') {
        const request = http.request({ host: proxy.hostname, port: proxyPort, method: 'POST', path: target.href, headers: { ...headers, Host: target.host, ...auth } }, onResponse);
        request.on('error', onError);
        request.end(body);
        return { destroy: () => request.destroy() };
    }
    const hostname = target.hostname.replace(/^\[|\]$/g, ''), authority = `${target.hostname}:${target.port || 443}`;
    let request;
    const connect = http.request({ host: proxy.hostname, port: proxyPort, method: 'CONNECT', path: authority, headers: { Host: authority, ...auth } });
    connect.on('connect', (response, socket) => {
        if (response.statusCode !== 200) { socket.destroy(); return onError(new Error('Proxy refused the tunnel.')); }
        request = https.request(target, { method: 'POST', headers: { ...headers, Connection: 'close' }, createConnection: () => tls.connect({ socket, host: hostname, servername: net.isIP(hostname) ? undefined : hostname }) }, onResponse);
        request.on('error', onError);
        request.on('close', () => socket.destroy());
        request.end(body);
    });
    connect.on('error', onError);
    connect.end();
    return { destroy: () => { connect.destroy(); request?.destroy(); } };
}

function createRelay({ origins = DEFAULT_ORIGINS, token = crypto.randomBytes(32).toString('hex'), port = 18765, maxTime = MAX_TIME, proxy, env = process.env }) {
    const proxies = proxySettings(proxy, env);
    const server = http.createServer((req, res) => {
        res.setHeader('Connection', 'close');
        const actualPort = server.address().port;
        const hostOK = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`].includes(req.headers.host);
        const reply = (status, message) => {
            if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-FlowSketch-Relay-Error': '1' }); res.end(JSON.stringify({ error: message })); }
            else res.destroy();
        };
        const origin = req.headers.origin;
        if (!hostOK || !origins.includes(origin)) return reply(403, 'Origin or Host rejected.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Expose-Headers', 'X-FlowSketch-Relay-Error');
        res.setHeader('Vary', 'Origin');
        res.setHeader('Cache-Control', 'no-store');
        if (!['/health', '/proxy'].includes(req.url)) return reply(404, 'Not found.');
        if (req.method === 'OPTIONS') {
            const method = req.headers['access-control-request-method'];
            const requested = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
            if (!['GET', 'POST'].includes(method) || requested.some(x => !['content-type', 'authorization', 'accept', 'x-flowsketch-token', 'x-flowsketch-target'].includes(x))) return reply(403, 'Preflight rejected.');
            res.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-FlowSketch-Token, X-FlowSketch-Target',
                'Access-Control-Allow-Private-Network': 'true',
                'Access-Control-Max-Age': '600'
            });
            return res.end();
        }
        const supplied = Buffer.from(req.headers['x-flowsketch-token'] || '');
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return reply(401, 'Relay token required.');
        if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ service: 'flowsketch-local-relay', version: 1 }));
        }
        if (req.method !== 'POST' || req.url !== '/proxy') return reply(405, 'Method not allowed.');
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, 'JSON required.');
        if (Number(req.headers['content-length']) > MAX_BODY) return reply(413, 'Request exceeds 40 MiB.');
        let target;
        try {
            const raw = req.headers['x-flowsketch-target'];
            target = new URL(raw);
            if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || /[?#]/.test(raw) || !/\/chat\/completions\/?$/.test(target.pathname)) throw new Error();
            if (['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && Number(target.port || (target.protocol === 'https:' ? 443 : 80)) === actualPort) throw new Error();
        } catch { return reply(400, 'Target must be a full HTTP(S) /chat/completions URL without credentials, query, or fragment.'); }
        let size = 0;
        const chunks = [];
        let upstream;
        let timer = setTimeout(() => { upstream?.destroy(); reply(504, 'Upstream time limit reached.'); }, maxTime);
        const cleanup = () => { clearTimeout(timer); timer = null; };
        res.on('close', () => { cleanup(); upstream?.destroy(); });
        req.on('aborted', () => { cleanup(); upstream?.destroy(); });
        req.on('error', () => { cleanup(); upstream?.destroy(); });
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY) { chunks.length = 0; cleanup(); reply(413, 'Request exceeds 40 MiB.'); req.removeAllListeners('data'); req.resume(); }
            else chunks.push(chunk);
        });
        req.on('end', () => {
            if (size > MAX_BODY || res.destroyed || res.writableEnded) return;
            const body = Buffer.concat(chunks);
            try { const value = JSON.parse(body.toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); }
            catch { cleanup(); return reply(400, 'A JSON object is required.'); }
            const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Accept-Encoding': 'identity' };
            if (req.headers.authorization) headers.Authorization = req.headers.authorization;
            if (req.headers.accept) headers.Accept = req.headers.accept;
            upstream = sendUpstream(target, proxies.for(target), headers, body, response => {
                // No redirect following; forward only response metadata needed by the API client.
                const output = {};
                for (const name of ['content-type', 'content-encoding', 'retry-after']) if (response.headers[name]) output[name] = response.headers[name];
                res.writeHead(response.statusCode, output);
                res.flushHeaders();
                response.on('error', () => { cleanup(); res.destroy(); });
                response.on('end', cleanup);
                response.pipe(res);
            }, () => { cleanup(); if (!res.destroyed) reply(502, 'Upstream connection failed. Check the endpoint, network and proxy.'); });
        });
    });
    server.requestTimeout = MAX_TIME;
    server.headersTimeout = 30000;
    return { server, token, port, proxyInfo: proxies.describe() };
}

if (require.main === module) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const { server, token, proxyInfo } = createRelay(options);
        server.on('error', () => { console.error('Cannot start relay. Check that the port is available.'); process.exitCode = 1; });
        server.listen(options.port, '127.0.0.1', () => {
            console.log(`FlowSketch local relay: http://127.0.0.1:${options.port}\nAllowed webpage origins: ${options.origins.join(', ')}\nToken (paste into AI settings): ${token}\n${proxyInfo}\nKeep this window open. Stop with Ctrl+C. No API keys or request bodies are logged.`);
        });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createRelay, parseArgs, proxySettings, DEFAULT_ORIGINS };
