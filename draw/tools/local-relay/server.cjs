#!/usr/bin/env node
'use strict';
// Deliberately dependency-free: no project data, request bodies, or credentials are logged.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const MAX_BODY = 40 * 1024 * 1024;
const MAX_TIME = 3600 * 1000;

function parseArgs(args) {
    const options = { port: 18765 };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--origin') options.origin = args[++i];
        else if (args[i] === '--port') options.port = Number(args[++i]);
        else throw new Error('Usage: --origin https://your-page.example [--port 18765]');
    }
    if (options.origin !== 'null') {
        let url;
        try { url = new URL(options.origin); } catch { throw new Error('Supply --origin with the exact webpage origin, or null for file://.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== options.origin) throw new Error('--origin must be an exact HTTP(S) origin without a path.');
    }
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be 1..65535.');
    return options;
}

function createRelay({ origin, token = crypto.randomBytes(32).toString('hex'), port = 18765, maxTime = MAX_TIME }) {
    const server = http.createServer((req, res) => {
        res.setHeader('Connection', 'close');
        const actualPort = server.address().port;
        const hostOK = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`].includes(req.headers.host);
        const reply = (status, message) => {
            if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-FlowSketch-Relay-Error': '1' }); res.end(JSON.stringify({ error: message })); }
            else res.destroy();
        };
        if (!hostOK || req.headers.origin !== origin) return reply(403, 'Origin or Host rejected.');
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
            upstream = (target.protocol === 'https:' ? https : http).request(target, { method: 'POST', headers }, response => {
                // No redirect following; forward only response metadata needed by the API client.
                const output = {};
                for (const name of ['content-type', 'content-encoding', 'retry-after']) if (response.headers[name]) output[name] = response.headers[name];
                res.writeHead(response.statusCode, output);
                res.flushHeaders();
                response.on('error', () => { cleanup(); res.destroy(); });
                response.on('end', cleanup);
                response.pipe(res);
            });
            upstream.on('error', () => { cleanup(); if (!res.destroyed) reply(502, 'Upstream connection failed. Check the endpoint and network.'); });
            upstream.end(body);
        });
    });
    server.requestTimeout = MAX_TIME;
    server.headersTimeout = 30000;
    return { server, token, port };
}

if (require.main === module) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const { server, token } = createRelay(options);
        server.on('error', () => { console.error('Cannot start relay. Check that the port is available.'); process.exitCode = 1; });
        server.listen(options.port, '127.0.0.1', () => {
            console.log(`FlowSketch local relay: http://127.0.0.1:${options.port}\nAllowed webpage origin: ${options.origin}\nToken (paste into AI settings): ${token}\nKeep this window open. Stop with Ctrl+C. No API keys or request bodies are logged.`);
        });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createRelay, parseArgs };
