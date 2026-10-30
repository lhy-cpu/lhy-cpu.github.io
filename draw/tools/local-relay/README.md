# FlowSketch 单文件本地转发服务

按电脑环境只下载对应的一份服务文件。三份文件各自独立，不需要其他脚本、npm 包或解压操作，不会自动安装运行环境。

- Windows 优先下载 `server.ps1`，使用系统自带 Windows PowerShell 5.1 / .NET。
- macOS / Linux 已有 Node.js 时，下载 `server.cjs`；此文件也能在已有 Node.js 的 Windows 上运行。
- 前述环境不可用时，下载 `server.py`，使用 Python 3。

在下载文件所在目录打开终端，选择对应命令。将示例网页来源 `https://draw.example` 替换为网页设置中显示的准确来源：

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1 --origin https://draw.example
```

已有 Node.js：

```sh
node ./server.cjs --origin https://draw.example
```

最后回退到 Python 3：

```sh
python3 ./server.py --origin https://draw.example
```

Windows 的 Python 也可以使用 `py -3 .\server.py --origin https://draw.example`。

来源必须精确匹配协议、主机和端口，不含路径、末尾斜杠或通配符。例如 `https://draw.example/editor/index.html` 的来源为 `https://draw.example`；本机网页可能为 `http://127.0.0.1:8765`；直接打开 `file://` 页面时使用 `--origin null`。

## 连接网页

服务启动时**不用填密码**。它会自动生成随机连接口令（Token），并显示本地地址 `http://127.0.0.1:18765`。

1. 保持终端运行，在网页 AI 设置选择「本地转发」。
2. 填写本地地址，将终端输出的 Token 粘贴到「连接口令」，点击「测试本地连接」。此测试不会请求模型。
3. API URL、API Key 和模型仍填写供应商的原始配置，重新发送消息即可。
4. 使用完毕，在终端按 `Ctrl+C` 停止服务。网页关闭或刷新不会停止服务进程。

Token 不是供应商 API Key，不用填写到服务脚本中；网页只在本页内存保留它，刷新页面或重启服务后需重新粘贴。服务只监听 `127.0.0.1`，不会向局域网开放。端口占用时，可在运行命令末尾加 `--port 18766`，同时修改网页本地地址。网页来源变化后需停止服务，再用新来源启动。

HTTPS 网页可连接 HTTP 回环地址。浏览器可能要求允许当前站点的本地网络／回环网络访问；站点 CSP 或组织策略仍可能阻止连接。参考 [Chrome Local Network Access 说明](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)。

PowerShell 命令的 `ExecutionPolicy Bypass` 只作用于这次进程，不修改系统持久设置。组织策略禁止运行时，应检查策略要求；服务不会修改策略或系统代理。

## 请求和隐私

- 业务接口为 `GET /health` 和 `POST /proxy`，都检查准确的 Origin、Host 和随机 Token。CORS `OPTIONS` 预检不需要 Token，也不会发给上游。
- 网页通过 `X-FlowSketch-Target` 指定完整 HTTP(S) `/chat/completions` 地址，不允许 URL 用户名、密码、查询参数或片段，不跟随重定向。
- 转发 JSON 请求体、`Authorization` 和 `Accept` 等必要协议头。浏览器 Cookie、Referer、Origin、服务 Token 不发给上游，也不转发上游 Cookie。
- 请求包含用户发送的聊天、画布及启用的图片，API Key 经本机服务传给配置的接口。服务不保存配置、不记录请求日志或正文，不显示 API Key。
- 请求最多 40 MiB、最长 3600 秒，支持 JSON / SSE 流式返回；网页取消后终止上游请求。网页可设置更短的整轮超时。PowerShell 和 Python 要求普通浏览器 JSON 字符串上传的 Content-Length，不接受手写 chunked 上传。
- 仅信任获授权的网页；该网页中的脚本可以使用页面持有的 Token。HTTP 上游的传输不加密，仍建议 API 使用 HTTPS。

## 验证

在项目根目录执行 `node --test tests/local-relay.test.cjs`。集成测试通过本地模拟接口验证健康检查、JSON、SSE 首块及时到达、HTTP 状态、来源与口令限制、上游请求头隔离、预检、重定向和取消。

当前 macOS 环境已验证 Node.js 和 Python。测试在 Windows 上会额外运行原生 PowerShell 后端，在其他系统明确跳过；PowerShell 尚未在真实 Windows 执行。跨系统运行和不同浏览器的 HTTPS 本地网络权限仍需对应环境实测。
