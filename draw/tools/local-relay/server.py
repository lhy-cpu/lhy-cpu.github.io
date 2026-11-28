#!/usr/bin/env python3
"""Dependency-free fallback. Never log request paths, headers, bodies, or exceptions."""
import argparse
import base64
import hmac
import http.client
import json
import os
import re
import secrets
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

MAX_BODY = 40 * 1024 * 1024
MAX_TIME = 3600
DEFAULT_ORIGINS = ('https://draw.lhye.work', 'https://github.lhye.work', 'null')


def exact_origin(value):
    if value == 'null':
        return True
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        return False
    host = f'[{parsed.hostname}]' if ':' in parsed.hostname else parsed.hostname
    default = 443 if parsed.scheme == 'https' else 80
    return value == f'{parsed.scheme}://{host}' + (f':{port}' if port and port != default else '')


def parse_proxy(value, source):
    parsed = urlsplit(value)
    try:
        parsed.port
    except ValueError:
        parsed = None
    if not parsed or parsed.scheme != 'http' or not parsed.hostname or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError(f'{source} must be an http:// proxy URL such as http://127.0.0.1:7890')
    return parsed


def proxy_settings(explicit, env):
    def pick(*names):
        for name in names:
            if env.get(name):
                return env[name], name
        return None
    fixed = (explicit, '--proxy') if explicit is not None else None
    chosen = {'https': fixed or pick('HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'),
              'http': fixed or pick('HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy')}
    proxies, notes = {}, []
    for scheme, entry in chosen.items():
        if not entry:
            continue
        try:
            proxies[scheme] = (parse_proxy(entry[0], entry[1]), entry[1])
        except ValueError:
            if entry[1] == '--proxy':
                raise
            notes.append(f'{entry[1]} ignored: only http:// proxies are supported.')
    bypass = [] if fixed else [x.strip().lower() for x in (env.get('NO_PROXY') or env.get('no_proxy') or '').split(',') if x.strip()]

    def for_target(target):
        entry = proxies.get(target.scheme)
        host = (target.hostname or '').lower()
        if not entry or host in ('localhost', '::1') or host.startswith('127.'):
            return None
        port = target.port or (443 if target.scheme == 'https' else 80)
        for rule in bypass:
            bare = rule[2:] if rule.startswith('*.') else rule.lstrip('.')
            if rule == '*' or rule == f'{host}:{port}' or host == bare or host.endswith('.' + bare):
                return None
        return entry[0]
    active = sorted({f'{p.hostname}:{p.port or 80} ({source})' for p, source in proxies.values()})
    description = '\n'.join([f"Upstream proxy: {', '.join(active)}" if active else 'Upstream proxy: none (direct connection)', *notes])
    return for_target, description


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', action='append', dest='origins')
    parser.add_argument('--port', type=int, default=18765)
    parser.add_argument('--proxy')
    args = parser.parse_args()
    origins = tuple(dict.fromkeys(args.origins)) if args.origins else DEFAULT_ORIGINS
    if not all(exact_origin(origin) for origin in origins):
        parser.error('--origin must be the exact webpage origin (lowercase host, no default port or path), or null for file://')
    if not 1 <= args.port <= 65535:
        parser.error('--port must be 1..65535')
    try:
        proxy_for, proxy_info = proxy_settings(args.proxy, os.environ)
    except ValueError as error:
        parser.error(str(error))
    token = secrets.token_hex(32)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.0'
        timeout = 30

        def log_message(self, *_args):
            pass

        def finish(self):
            try:
                super().finish()
            except (OSError, ValueError):
                pass

        def reply(self, status, message=None, headers=None, raw=None):
            body = raw if raw is not None else json.dumps({'error': message}).encode()
            self.send_response(status)
            if self.headers.get('Origin') in origins:
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
                self.send_header('Access-Control-Expose-Headers', 'X-FlowSketch-Relay-Error')
                self.send_header('Vary', 'Origin')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            if status >= 400:
                self.send_header('X-FlowSketch-Relay-Error', '1')
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.handle_relay()

        def do_GET(self):
            self.handle_relay()

        def do_POST(self):
            self.handle_relay()

        def handle_relay(self):
            upstream = None
            stopped = threading.Event()
            sent = False
            expired = threading.Event()

            def expire():
                expired.set()
                if not sent:
                    try:
                        self.connection.shutdown(socket.SHUT_RD)
                    except OSError:
                        pass
                else:
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                if upstream:
                    if upstream.sock:
                        try:
                            upstream.sock.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
                    upstream.close()

            deadline = time.monotonic() + MAX_TIME
            timeout = threading.Timer(MAX_TIME, expire)
            timeout.daemon = True
            timeout.start()
            try:
                self.connection.settimeout(30)
                if self.headers.get('Host') not in (f'127.0.0.1:{args.port}', f'localhost:{args.port}', f'[::1]:{args.port}') or self.headers.get('Origin') not in origins:
                    return self.reply(403, 'Origin or Host rejected.')
                if self.path not in ('/health', '/proxy'):
                    return self.reply(404, 'Not found.')
                if self.command == 'OPTIONS':
                    requested = [x.strip().lower() for x in self.headers.get('Access-Control-Request-Headers', '').split(',') if x.strip()]
                    if self.headers.get('Access-Control-Request-Method') not in ('GET', 'POST') or any(x not in ('content-type', 'authorization', 'accept', 'x-flowsketch-token', 'x-flowsketch-target') for x in requested):
                        return self.reply(403, 'Preflight rejected.')
                    return self.reply(204, headers={'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-FlowSketch-Token, X-FlowSketch-Target', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600'}, raw=b'')
                if not hmac.compare_digest(self.headers.get('X-FlowSketch-Token', '').encode(), token.encode()):
                    return self.reply(401, 'Relay token required.')
                if self.command == 'GET' and self.path == '/health':
                    return self.reply(200, raw=b'{"service":"flowsketch-local-relay","version":1}')
                if self.command != 'POST' or self.path != '/proxy':
                    return self.reply(405, 'Method not allowed.')
                if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
                    return self.reply(415, 'JSON required.')
                raw_target = self.headers.get('X-FlowSketch-Target', '')
                try:
                    target = urlsplit(raw_target)
                    if target.scheme not in ('http', 'https') or not target.hostname or target.username or target.password or '?' in raw_target or '#' in raw_target or not re.search(r'/chat/completions/?$', target.path):
                        raise ValueError()
                    if target.hostname in ('127.0.0.1', 'localhost', '::1') and (target.port or (443 if target.scheme == 'https' else 80)) == args.port:
                        raise ValueError()
                    target_port = target.port
                except ValueError:
                    return self.reply(400, 'Target must be a full HTTP(S) /chat/completions URL without credentials, query, or fragment.')
                if self.headers.get('Transfer-Encoding') or not self.headers.get('Content-Length', '').isdigit():
                    return self.reply(411, 'Content-Length required.')
                size = int(self.headers['Content-Length'])
                if size > MAX_BODY:
                    return self.reply(413, 'Request exceeds 40 MiB.')
                body = self.rfile.read(size)
                try:
                    def invalid_constant(_value):
                        raise ValueError()
                    if len(body) != size or not isinstance(json.loads(body, parse_constant=invalid_constant), dict):
                        raise ValueError()
                except (ValueError, UnicodeError):
                    return self.reply(400, 'A JSON object is required.')
                proxy = proxy_for(target)
                headers = {'Content-Type': 'application/json', 'Accept-Encoding': 'identity'}
                request_path = target.path
                if proxy:
                    auth = {}
                    if proxy.username or proxy.password:
                        auth['Proxy-Authorization'] = 'Basic ' + base64.b64encode(f'{unquote(proxy.username or "")}:{unquote(proxy.password or "")}'.encode()).decode()
                    if target.scheme == 'https':
                        upstream = http.client.HTTPSConnection(proxy.hostname, proxy.port or 80, timeout=MAX_TIME)
                        upstream.set_tunnel(target.hostname, target_port or 443, headers=auth)
                    else:
                        upstream = http.client.HTTPConnection(proxy.hostname, proxy.port or 80, timeout=MAX_TIME)
                        request_path = raw_target
                        headers.update(auth, Host=target.netloc)
                else:
                    upstream = (http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection)(target.hostname, target_port, timeout=MAX_TIME)

                def monitor():
                    while not stopped.wait(0.1):
                        try:
                            ready = select.select([self.connection], [], [], 0)[0]
                            if time.monotonic() >= deadline or (ready and self.connection.recv(1, socket.MSG_PEEK) == b''):
                                if upstream.sock:
                                    upstream.sock.shutdown(socket.SHUT_RDWR)
                                upstream.close()
                                return
                        except OSError:
                            return

                threading.Thread(target=monitor, daemon=True).start()
                for name in ('Authorization', 'Accept'):
                    if self.headers.get(name):
                        headers[name] = self.headers[name]
                upstream.request('POST', request_path, body, headers)
                response = upstream.getresponse()
                self.send_response(response.status)
                self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
                self.send_header('Access-Control-Expose-Headers', 'X-FlowSketch-Relay-Error')
                self.send_header('Vary', 'Origin')
                self.send_header('Cache-Control', 'no-store')
                for name in ('Content-Type', 'Content-Encoding', 'Retry-After'):
                    if response.getheader(name):
                        self.send_header(name, response.getheader(name))
                self.end_headers()
                sent = True
                while True:
                    chunk = response.read1(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except (OSError, http.client.HTTPException, ValueError):
                if not sent:
                    try:
                        if expired.is_set() or time.monotonic() >= deadline:
                            self.reply(504, 'Upstream time limit reached.')
                        else:
                            self.reply(502, 'Upstream connection failed. Check the endpoint, network and proxy.')
                    except OSError:
                        pass
            finally:
                timeout.cancel()
                stopped.set()
                if upstream:
                    upstream.close()

    class QuietServer(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, *_args):
            pass

    try:
        server = QuietServer(('127.0.0.1', args.port), Handler)
    except OSError:
        parser.exit(1, 'Cannot start relay. Check that the port is available.\n')
    allowed = ', '.join(origins)
    print(f'FlowSketch local relay: http://127.0.0.1:{args.port}\nAllowed webpage origins: {allowed}\nToken (paste into AI settings): {token}\n{proxy_info}\nKeep this window open. Stop with Ctrl+C. No API keys or request bodies are logged.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
