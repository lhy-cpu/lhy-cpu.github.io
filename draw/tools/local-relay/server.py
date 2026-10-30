#!/usr/bin/env python3
"""Dependency-free fallback. Never log request paths, headers, bodies, or exceptions."""
import argparse
import hmac
import http.client
import json
import secrets
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

MAX_BODY = 40 * 1024 * 1024
MAX_TIME = 3600


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', required=True)
    parser.add_argument('--port', type=int, default=18765)
    args = parser.parse_args()
    parsed = urlsplit(args.origin)
    if args.origin != 'null' and (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or args.origin != f'{parsed.scheme}://{parsed.netloc}'):
        parser.error('--origin must be the exact webpage origin, or null for file://')
    if not 1 <= args.port <= 65535:
        parser.error('--port must be 1..65535')
    token = secrets.token_hex(32)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.0'

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
            if self.headers.get('Origin') == args.origin:
                self.send_header('Access-Control-Allow-Origin', args.origin)
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

            def expire():
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

            timeout = threading.Timer(MAX_TIME, expire)
            timeout.daemon = True
            timeout.start()
            try:
                self.connection.settimeout(30)
                if self.headers.get('Host') not in (f'127.0.0.1:{args.port}', f'localhost:{args.port}', f'[::1]:{args.port}') or self.headers.get('Origin') != args.origin:
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
                    if target.scheme not in ('http', 'https') or not target.hostname or target.username or target.password or '?' in raw_target or '#' in raw_target or not target.path.rstrip('/').endswith('/chat/completions'):
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
                upstream = (http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection)(target.hostname, target_port, timeout=MAX_TIME)
                deadline = time.monotonic() + MAX_TIME

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
                headers = {'Content-Type': 'application/json', 'Accept-Encoding': 'identity'}
                for name in ('Authorization', 'Accept'):
                    if self.headers.get(name):
                        headers[name] = self.headers[name]
                upstream.request('POST', target.path, body, headers)
                response = upstream.getresponse()
                self.send_response(response.status)
                self.send_header('Access-Control-Allow-Origin', args.origin)
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
                        self.reply(502, 'Upstream connection failed. Check the endpoint and network.')
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
    print(f'FlowSketch local relay: http://127.0.0.1:{args.port}\nAllowed webpage origin: {args.origin}\nToken (paste into AI settings): {token}\nKeep this window open. Stop with Ctrl+C. No API keys or request bodies are logged.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
