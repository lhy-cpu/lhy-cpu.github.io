# Windows PowerShell 5.1 / .NET Framework; no installation or URL ACL is needed.
# Intentionally never logs request bodies, upstream errors, or API credentials.
$ErrorActionPreference = 'Stop'
$relayOrigin = $null
$relayPort = 18765
try {
    for ($i = 0; $i -lt $args.Count; $i++) {
        switch ($args[$i]) {
            '--origin' { $i++; if ($i -ge $args.Count) { throw 'Missing origin.' }; $relayOrigin = [string]$args[$i] }
            '--port' { $i++; if ($i -ge $args.Count) { throw 'Missing port.' }; $relayPort = [int]$args[$i] }
            default { throw 'Unknown argument.' }
        }
    }
    if ($relayPort -lt 1 -or $relayPort -gt 65535) { throw 'Invalid port.' }
    if ($relayOrigin -ne 'null') {
        $originUri = $null
        if (-not [Uri]::TryCreate($relayOrigin, [UriKind]::Absolute, [ref]$originUri) -or
            $originUri.Scheme -notin @('http', 'https') -or $originUri.UserInfo -or
            $originUri.GetLeftPart([UriPartial]::Authority) -cne $relayOrigin) {
            throw 'Invalid origin.'
        }
    }
} catch {
    Write-Error 'Usage: powershell -File server.ps1 --origin https://your-page.example [--port 18765]. Use origin null for file://.'
    exit 1
}

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Web.Extensions
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::DefaultConnectionLimit = 64
# Include framework references explicitly: custom reference lists replace the
# compiler defaults on some Windows PowerShell versions.
Add-Type -ReferencedAssemblies System,System.Core,System.Net.Http,System.Web.Extensions -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public static class FlowSketchLocalRelay {
    const int MaxBody = 40 * 1024 * 1024;
    const int MaxHeader = 32 * 1024;
    static readonly Encoding Utf8 = new UTF8Encoding(false, true);
    static readonly HttpClient Upstream = CreateClient();
    static string Origin, Token;
    static int Port;

    static HttpClient CreateClient() {
        var handler = new HttpClientHandler {
            AllowAutoRedirect = false, UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None
        };
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }
    public static void Run(string origin, int port) {
        Origin = origin; Port = port;
        var random = new byte[32];
        using (var rng = RandomNumberGenerator.Create()) { rng.GetBytes(random); }
        Token = BitConverter.ToString(random).Replace("-", "").ToLowerInvariant();
        var listener = new TcpListener(IPAddress.Loopback, port);
        try { listener.Start(); }
        catch { throw new InvalidOperationException("Cannot start relay. Check that the port is available."); }
        Console.WriteLine("FlowSketch local relay: http://127.0.0.1:" + port);
        Console.WriteLine("Allowed webpage origin: " + origin);
        Console.WriteLine("Token (paste into AI settings): " + Token);
        Console.WriteLine("Keep this window open. Stop with Ctrl+C. No API keys or request bodies are logged.");
        try { AcceptLoop(listener).GetAwaiter().GetResult(); }
        finally { listener.Stop(); }
    }
    static async Task AcceptLoop(TcpListener listener) {
        while (true) {
            var client = await listener.AcceptTcpClientAsync().ConfigureAwait(false);
            // Handle owns the socket and contains all per-request exceptions.
            var ignored = Handle(client);
        }
    }
    sealed class Request {
        public string Method, Path;
        public Dictionary<string,string> Headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        public string Get(string name) { string value; return Headers.TryGetValue(name, out value) ? value : ""; }
    }
    sealed class RequestError : Exception {
        public int Status; public RequestError(int status, string text) : base(text) { Status = status; }
    }
    // Read headers without over-reading: body bytes remain in the network stream.
    static async Task<Request> ReadHeaders(NetworkStream stream, CancellationToken ct) {
        var bytes = new List<byte>(); var one = new byte[1];
        while (bytes.Count < MaxHeader) {
            if (await stream.ReadAsync(one, 0, 1, ct).ConfigureAwait(false) == 0) throw new IOException();
            bytes.Add(one[0]); int n = bytes.Count;
            if (n >= 4 && bytes[n-4] == 13 && bytes[n-3] == 10 && bytes[n-2] == 13 && bytes[n-1] == 10) break;
        }
        if (bytes.Count >= MaxHeader) throw new RequestError(431, "Request headers too large.");
        var lines = Encoding.ASCII.GetString(bytes.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
        var first = lines[0].Split(' ');
        if (first.Length != 3 || first[2] != "HTTP/1.1") throw new RequestError(400, "Invalid HTTP request.");
        var req = new Request { Method = first[0], Path = first[1] };
        for (int i = 1; i < lines.Length && lines[i].Length > 0; i++) {
            int colon = lines[i].IndexOf(':');
            if (colon <= 0) throw new RequestError(400, "Invalid HTTP headers.");
            string name = lines[i].Substring(0, colon), value = lines[i].Substring(colon + 1).Trim();
            for (int j = 0; j < name.Length; j++) {
                char ch = name[j];
                if (!(char.IsLetterOrDigit(ch) && ch < 128) && "!#$%&'*+-.^_`|~".IndexOf(ch) < 0)
                    throw new RequestError(400, "Invalid HTTP headers.");
            }
            foreach (char ch in value) if (ch < 32 && ch != '\t' || ch == 127) throw new RequestError(400, "Invalid HTTP headers.");
            if (req.Headers.ContainsKey(name)) throw new RequestError(400, "Duplicate HTTP headers.");
            req.Headers.Add(name, value);
        }
        return req;
    }
    static string Cors(bool allowed) {
        return allowed ? "Access-Control-Allow-Origin: " + Origin + "\r\nAccess-Control-Expose-Headers: X-FlowSketch-Relay-Error\r\nVary: Origin\r\n" : "";
    }
    static async Task WriteText(NetworkStream stream, int status, string json, bool cors, string extra) {
        byte[] body = Encoding.UTF8.GetBytes(json);
        string head = "HTTP/1.1 " + status + " " + Reason(status) + "\r\nConnection: close\r\nCache-Control: no-store\r\n" + Cors(cors) +
            "Content-Type: application/json\r\nContent-Length: " + body.Length + "\r\n" + (status >= 400 ? "X-FlowSketch-Relay-Error: 1\r\n" : "") + extra + "\r\n";
        byte[] header = Encoding.ASCII.GetBytes(head);
        await stream.WriteAsync(header, 0, header.Length).ConfigureAwait(false);
        await stream.WriteAsync(body, 0, body.Length).ConfigureAwait(false);
    }
    static string Reason(int status) {
        switch (status) {
            case 200: return "OK"; case 204: return "No Content"; case 400: return "Bad Request";
            case 401: return "Unauthorized"; case 403: return "Forbidden"; case 404: return "Not Found";
            case 405: return "Method Not Allowed"; case 413: return "Payload Too Large";
            case 415: return "Unsupported Media Type"; case 431: return "Request Header Fields Too Large";
            case 502: return "Bad Gateway"; case 504: return "Gateway Timeout"; default: return "Upstream Response";
        }
    }
    static bool TokenMatches(string supplied) {
        int difference = supplied.Length ^ Token.Length;
        for (int i = 0; i < Token.Length; i++) difference |= Token[i] ^ (i < supplied.Length ? supplied[i] : 0);
        return difference == 0;
    }
    static Uri Target(string raw) {
        Uri uri;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") ||
            uri.UserInfo.Length != 0 || raw.IndexOfAny(new[] {'?', '#'}) >= 0 ||
            !(uri.AbsolutePath.EndsWith("/chat/completions", StringComparison.Ordinal) || uri.AbsolutePath.EndsWith("/chat/completions/", StringComparison.Ordinal)) ||
            ((uri.Host == "localhost" || uri.Host == "127.0.0.1" || uri.Host == "[::1]" || uri.Host == "::1") && uri.Port == Port))
            throw new RequestError(400, "Target must be a full HTTP(S) /chat/completions URL without credentials, query, or fragment.");
        return uri;
    }
    // JavaScriptSerializer accepts JavaScript extensions (single quotes, bare keys).
    // Validate JSON grammar directly so the relay only accepts JSON objects.
    sealed class StrictJson {
        readonly string text; int pos;
        public StrictJson(string value) { text = value; }
        void Fail() { throw new FormatException(); }
        void Space() { while (pos < text.Length && (text[pos] == ' ' || text[pos] == '\t' || text[pos] == '\r' || text[pos] == '\n')) pos++; }
        bool Take(char value) { Space(); if (pos < text.Length && text[pos] == value) { pos++; return true; } return false; }
        void Need(char value) { if (!Take(value)) Fail(); }
        public void ValidateObject() {
            Space(); if (pos >= text.Length || text[pos] != '{') Fail();
            Value(0); Space(); if (pos != text.Length) Fail();
        }
        void String() {
            Need('"');
            while (pos < text.Length) {
                char ch = text[pos++];
                if (ch == '"') return;
                if (ch < 32) Fail();
                if (ch == '\\') {
                    if (pos >= text.Length) Fail();
                    ch = text[pos++];
                    if (ch == 'u') {
                        for (int i = 0; i < 4; i++) {
                            if (pos >= text.Length || "0123456789abcdefABCDEF".IndexOf(text[pos++]) < 0) Fail();
                        }
                    } else if ("\"\\/bfnrt".IndexOf(ch) < 0) Fail();
                }
            }
            Fail();
        }
        bool Digit() { return pos < text.Length && text[pos] >= '0' && text[pos] <= '9'; }
        void Number() {
            if (pos < text.Length && text[pos] == '-') pos++;
            if (pos < text.Length && text[pos] == '0') pos++;
            else { if (!Digit() || text[pos] == '0') Fail(); while (Digit()) pos++; }
            if (pos < text.Length && text[pos] == '.') { pos++; if (!Digit()) Fail(); while (Digit()) pos++; }
            if (pos < text.Length && (text[pos] == 'e' || text[pos] == 'E')) {
                pos++; if (pos < text.Length && (text[pos] == '+' || text[pos] == '-')) pos++;
                if (!Digit()) Fail(); while (Digit()) pos++;
            }
        }
        void Value(int depth) {
            if (depth > 512) Fail(); Space(); if (pos >= text.Length) Fail();
            char ch = text[pos];
            if (ch == '{') {
                pos++; if (Take('}')) return;
                do { String(); Need(':'); Value(depth + 1); if (Take('}')) return; Need(','); } while (true);
            }
            if (ch == '[') {
                pos++; if (Take(']')) return;
                do { Value(depth + 1); if (Take(']')) return; Need(','); } while (true);
            }
            if (ch == '"') { String(); return; }
            foreach (string literal in new[] { "true", "false", "null" }) {
                if (pos + literal.Length <= text.Length && string.CompareOrdinal(text, pos, literal, 0, literal.Length) == 0) { pos += literal.Length; return; }
            }
            Number();
        }
    }
    static async Task WatchDisconnect(TcpClient client, CancellationTokenSource stop) {
        try {
            while (!stop.IsCancellationRequested) {
                await Task.Delay(250, stop.Token).ConfigureAwait(false);
                if (client.Client.Poll(0, SelectMode.SelectRead) && client.Client.Available == 0) { stop.Cancel(); return; }
            }
        } catch (OperationCanceledException) { } catch { stop.Cancel(); }
    }
    static async Task Handle(TcpClient client) {
        bool cors = false, started = false;
        Task watcher = null;
        int pendingErrorStatus = 0;
        string pendingErrorJson = null;
        using (client)
        using (var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3600)))
        using (var stop = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token)) {
            NetworkStream stream = client.GetStream();
            // Closing the socket also interrupts .NET Framework reads which ignore cancellation.
            using (stop.Token.Register(() => { try { client.Close(); } catch { } })) {
                try {
                    Request req;
                    using (var headerDeadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token)) {
                        headerDeadline.CancelAfter(TimeSpan.FromSeconds(30));
                        using (headerDeadline.Token.Register(() => { try { client.Close(); } catch { } }))
                            req = await ReadHeaders(stream, headerDeadline.Token).ConfigureAwait(false);
                    }
                    if ((req.Get("Host") != "127.0.0.1:" + Port && req.Get("Host") != "localhost:" + Port && req.Get("Host") != "[::1]:" + Port) || req.Get("Origin") != Origin)
                        throw new RequestError(403, "Origin or Host rejected.");
                    cors = true;
                    if (req.Path != "/health" && req.Path != "/proxy") throw new RequestError(404, "Not found.");
                    if (req.Method == "OPTIONS") {
                        string method = req.Get("Access-Control-Request-Method");
                        var allowed = new HashSet<string>(new[] { "content-type", "authorization", "accept", "x-flowsketch-token", "x-flowsketch-target" });
                        if (method != "GET" && method != "POST") throw new RequestError(403, "Preflight rejected.");
                        foreach (string name in req.Get("Access-Control-Request-Headers").Split(','))
                            if (name.Trim().Length > 0 && !allowed.Contains(name.Trim().ToLowerInvariant())) throw new RequestError(403, "Preflight rejected.");
                        await WriteText(stream, 204, "", true, "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, Accept, X-FlowSketch-Token, X-FlowSketch-Target\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n").ConfigureAwait(false);
                        return;
                    }
                    if (!TokenMatches(req.Get("X-FlowSketch-Token"))) throw new RequestError(401, "Relay token required.");
                    if (req.Method == "GET" && req.Path == "/health") {
                        await WriteText(stream, 200, "{\"service\":\"flowsketch-local-relay\",\"version\":1}", true, "").ConfigureAwait(false); return;
                    }
                    if (req.Method != "POST" || req.Path != "/proxy") throw new RequestError(405, "Method not allowed.");
                    if (req.Get("Content-Type").Split(';')[0].Trim().ToLowerInvariant() != "application/json") throw new RequestError(415, "JSON required.");
                    Uri target = Target(req.Get("X-FlowSketch-Target"));
                    long length;
                    if (req.Get("Transfer-Encoding").Length != 0 || !long.TryParse(req.Get("Content-Length"), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out length) || length < 0)
                        throw new RequestError(400, "A Content-Length JSON request is required.");
                    if (length > MaxBody) throw new RequestError(413, "Request exceeds 40 MiB.");
                    byte[] body = new byte[(int)length]; int offset = 0;
                    while (offset < body.Length) {
                        int n = await stream.ReadAsync(body, offset, body.Length - offset, stop.Token).ConfigureAwait(false);
                        if (n == 0) throw new IOException(); offset += n;
                    }
                    try { new StrictJson(Utf8.GetString(body)).ValidateObject(); }
                    catch { throw new RequestError(400, "A JSON object is required."); }
                    watcher = WatchDisconnect(client, stop);
                    using (var message = new HttpRequestMessage(HttpMethod.Post, target)) {
                        message.Content = new ByteArrayContent(body);
                        message.Content.Headers.TryAddWithoutValidation("Content-Type", req.Get("Content-Type"));
                        if (req.Get("Authorization").Length > 0) message.Headers.TryAddWithoutValidation("Authorization", req.Get("Authorization"));
                        if (req.Get("Accept").Length > 0) message.Headers.TryAddWithoutValidation("Accept", req.Get("Accept"));
                        using (var response = await Upstream.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, stop.Token).ConfigureAwait(false))
                        using (stop.Token.Register(() => response.Dispose())) {
                            var head = new StringBuilder("HTTP/1.1 " + (int)response.StatusCode + " " + Reason((int)response.StatusCode) + "\r\nConnection: close\r\nCache-Control: no-store\r\n" + Cors(true));
                            foreach (string name in new[] { "Content-Type", "Content-Encoding" }) {
                                IEnumerable<string> values;
                                if (response.Content.Headers.TryGetValues(name, out values)) head.Append(name + ": " + string.Join(", ", values).Replace("\r", "").Replace("\n", "") + "\r\n");
                            }
                            IEnumerable<string> retry;
                            if (response.Headers.TryGetValues("Retry-After", out retry)) head.Append("Retry-After: " + string.Join(", ", retry).Replace("\r", "").Replace("\n", "") + "\r\n");
                            head.Append("\r\n"); byte[] header = Encoding.ASCII.GetBytes(head.ToString());
                            started = true;
                            await stream.WriteAsync(header, 0, header.Length, stop.Token).ConfigureAwait(false);
                            using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false)) {
                                byte[] buffer = new byte[8192]; int n;
                                while ((n = await input.ReadAsync(buffer, 0, buffer.Length, stop.Token).ConfigureAwait(false)) > 0)
                                    await stream.WriteAsync(buffer, 0, n, stop.Token).ConfigureAwait(false);
                            }
                        }
                    }
                } catch (RequestError error) {
                    if (!started) {
                        pendingErrorStatus = error.Status;
                        pendingErrorJson = new JavaScriptSerializer().Serialize(new { error = error.Message });
                    }
                } catch {
                    if (!started && !stop.IsCancellationRequested) {
                        pendingErrorStatus = 502;
                        pendingErrorJson = "{\"error\":\"Upstream connection failed. Check the endpoint and network.\"}";
                    }
                }
                // Windows PowerShell 5.1's framework compiler supports C# 5:
                // await is permitted in try, but never in catch or finally.
                if (pendingErrorJson != null) {
                    try { await WriteText(stream, pendingErrorStatus, pendingErrorJson, cors, "").ConfigureAwait(false); }
                    catch { }
                }
                stop.Cancel();
                if (watcher != null) await watcher.ConfigureAwait(false);
            }
        }
    }
}
'@
try {
    [FlowSketchLocalRelay]::Run($relayOrigin, $relayPort)
} catch {
    Write-Error 'Relay stopped or could not start. Check that the port is available.'
    exit 1
}
