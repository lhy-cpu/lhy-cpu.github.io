// ==UserScript==
// @name         AutoGetMedia
// @namespace    https://lhy-cpu.github.io
// @version      0.2.0
// @description  拦截网络请求，并筛选出其中的媒体文件（视频、音频等），支持 HLS/m3u8 清单识别、分片下载及合并。(Beta)
// @author       lhy-cpu
// @match        *://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect *
// @run-at       document-start
// @sandbox      raw
// @updateURL    https://lhy-cpu.github.io/Tampermonkey/AutoGetMedia.user.js
// @downloadURL  https://lhy-cpu.github.io/Tampermonkey/AutoGetMedia.user.js
// @homepage     https://lhy-cpu.github.io/Tampermonkey/index.html
// ==/UserScript==

(function() {
    'use strict';

    // 存储抓取到的媒体链接
    const mediaUrls = new Set();
    const mediaInfo = new Map();
    const hlsMime = /(?:application|audio)\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)/i;
    // 必须在可能同步调用 initUI() 之前初始化。
    let agmContainer = null;
    let agmList = null;
    let agmCount = null;

    // 常见的媒体文件扩展名正则 (匹配 .mp4, .m3u8, .ts, .mp3, .webm 等)
    const mediaExtensions = /\.(mp4|webm|ogg|mp3|wav|flac|aac|m3u8|ts|m4s)$/i;

    // 确定顶层主权域名，用于按主域名维度持久化存储“阻断开关”的状态
    let topHostname = window.location.hostname;
    if (window.top !== window.self) {
        try {
            if (location.ancestorOrigins && location.ancestorOrigins.length > 0) {
                topHostname = new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname;
            } else if (document.referrer) {
                topHostname = new URL(document.referrer).hostname;
            }
        } catch (e) {}
    }
    const blockKey = 'agm_block_' + topHostname;

    // 获取当前域名是否开启阻断
    function isBlockEnabled() {
        return GM_getValue(blockKey, false);
    }

    function normalizeUrl(value, base = document.baseURI) {
        try {
            const url = new URL(value, base);
            return /^(https?:)$/.test(url.protocol) ? url.href : null;
        } catch (e) { return null; }
    }

    function isHlsUrl(url) {
        return /\.m3u8(?:$|[?#])/i.test(url);
    }

    // 记录媒体及其来源页；返回是否需要阻断页面直连请求。
    function checkUrl(value, hls = false, referer = window.location.href) {
        if (typeof value !== 'string') return false;
        const url = normalizeUrl(value);
        if (!url) return false;
        const previous = mediaInfo.get(url);
        if (!hls && !(previous && previous.hls) && !mediaExtensions.test(new URL(url).pathname)) return false;
        const info = { hls: hls || isHlsUrl(url) || !!(previous && previous.hls), referer };
        mediaInfo.set(url, info);
        if (!mediaUrls.has(url)) {
            mediaUrls.add(url);
            console.log('[AutoGetMedia] 抓取到媒体资源:', url);
            if (window.top === window.self) updateUI(url);
        }
        if (window.top !== window.self && (!previous || previous.hls !== info.hls)) {
            window.top.postMessage({ type: 'AutoGetMedia_NEW_URL', url, hls: info.hls, referer }, '*');
        }
        return isBlockEnabled();
    }

    // 仅查看文本或 HLS 响应，避免为普通视频复制、读取整个二进制响应。
    async function inspectFetchResponse(response, requestUrl) {
        const type = response.headers.get('content-type') || '';
        const url = response.url || requestUrl;
        if (hlsMime.test(type)) { checkUrl(url, true); return; }
        if ((type && !/^(text\/|application\/(?:octet-stream|x-mpegurl))/i.test(type)) || !response.body) return;
        const reader = response.clone().body.getReader();
        const decoder = new TextDecoder();
        let prefix = '';
        try {
            // 只需识别清单开头，不缓存正文；clone 的取消不等待原流结束。
            while (prefix.length < 64) {
                const { value, done } = await reader.read();
                if (done) break;
                prefix += decoder.decode(value.subarray(0, 256), { stream: true });
                const start = prefix.replace(/^\uFEFF/, '').trimStart();
                if (start.length >= 7 || !'#EXTM3U'.startsWith(start)) break;
            }
            if (prefix.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) checkUrl(url, true);
        } finally { reader.cancel().catch(() => {}); }
    }

    /**
     * 1. 拦截 Fetch API
     */
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            const request = args[0];
            const url = request instanceof URL ? request.href : (typeof request === 'string' ? request : (request && request.url));
            if (checkUrl(url)) {
                console.warn('%c[AutoGetMedia] ⚡ 已阻断 Fetch 请求: ' + url, 'color: #ff5252; background: #333; font-weight: bold; padding: 2px 4px;');
                return Promise.reject(new Error('Blocked by AutoGetMedia (Fetch)'));
            }
        } catch (e) {
            console.error('[AutoGetMedia] Fetch拦截报错', e);
        }
        const response = await originalFetch.apply(this, args);
        const request = args[0];
        const requestUrl = request instanceof URL ? request.href : (typeof request === 'string' ? request : request && request.url);
        inspectFetchResponse(response, normalizeUrl(requestUrl)).catch(() => {});
        return response;
    };

    /**
     * 2. 拦截 XMLHttpRequest (Ajax)
     */
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        try {
            this._agmUrl = String(url);
            this._agmBlocked = false;
            if (!this._agmListening) {
                this._agmListening = true;
                this.addEventListener('load', () => {
                    try {
                        const type = this.getResponseHeader('Content-Type') || '';
                        const hls = hlsMime.test(type) || ((!this.responseType || this.responseType === 'text') &&
                            this.responseText.slice(0, 256).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U'));
                        checkUrl(this.responseURL || this._agmUrl, hls);
                    } catch (e) { /* 非文本响应不能读取 responseText。 */ }
                });
            }
            if (checkUrl(String(url))) {
                this._agmBlocked = true; // 命中匹配并且当前开启了拦截
            }
        } catch (e) {
            console.error('[AutoGetMedia] XHR open 拦截报错', e);
        }
        return originalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        if (this._agmBlocked) {
            console.warn('%c[AutoGetMedia] ⚡ 已阻断 XHR 请求: ' + this._agmUrl, 'color: #ff5252; background: #333; font-weight: bold; padding: 2px 4px;');
            // 模拟阻断状态，并触发可能的错误回调防止页面卡死
            Object.defineProperty(this, 'readyState', { value: XMLHttpRequest.DONE });
            Object.defineProperty(this, 'status', { value: 0 });
            if (typeof this.onerror === 'function') {
                this.onerror(new ProgressEvent('error'));
            } else if (typeof this.onreadystatechange === 'function') {
                this.onreadystatechange();
            }
            return; // 核心：终止送出请求
        }
        return originalXhrSend.apply(this, args);
    };

    /**
     * 3. 监听 Performance Resource Timing API
     * 这种方式可以捕获 HTML 标签如 <video src="..."> 或 <audio src="..."> 产生的真实资源请求，
     * 以及一些在脚本注入前就已经发起的请求。
     */
    if (window.PerformanceObserver) {
        const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            entries.forEach((entry) => {
                // entry.name 就是请求的完整 URL
                checkUrl(entry.name);
            });
        });
        // 监听资源加载
        observer.observe({ type: 'resource', buffered: true });
    }

    // 将抓取到的数据挂载到全局，方便在浏览器控制台(Console)里直接打印 `window.__MEDIA_URLS__` 查看
    window.__MEDIA_URLS__ = mediaUrls;

    // 可选：页面加载完毕后，在控制台总结一下
    window.addEventListener('load', () => {
        if (mediaUrls.size > 0) {
            console.log('[AutoGetMedia] 页面加载完毕，共抓取到 %d 个媒体资源。', mediaUrls.size, Array.from(mediaUrls));
        }
        if (window.top === window.self) {
            initUI();
        }
    });

    // 确保在 DOM 准备就绪时也尝试一次渲染（针对非刷新注入）
    // 仅在最外层主页面 (Top Window) 初始化 UI
    if (window.top === window.self) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initUI();
        } else {
            document.addEventListener('DOMContentLoaded', initUI);
        }
        
        // 监听来自 iframe 的消息，接收媒体链接
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'AutoGetMedia_NEW_URL') {
                // 只接受本页面的后代 frame；以消息来源确定防盗链页面。
                let source = event.source;
                try {
                    while (source && source !== window && source.parent !== source) source = source.parent;
                } catch (e) { return; }
                if (source !== window || event.source === window) return;
                let referer = /^https?:/.test(event.origin) ? event.origin + '/' : window.location.href;
                const sourcePage = normalizeUrl(event.data.referer);
                if (sourcePage && new URL(sourcePage).origin === event.origin) referer = sourcePage;
                checkUrl(event.data.url, event.data.hls === true, referer);
            }
        });
    }

    // --- UI 渲染及交互逻辑 ---
    function initUI() {
        if (agmContainer || document.getElementById('agm-container')) return;
        if (!document.body) return;

        agmContainer = document.createElement('div');
        agmContainer.id = 'agm-container';
        agmContainer.style.cssText = `
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            z-index: 2147483647 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
            width: 320px !important;
            pointer-events: none !important;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            background: #2b2b2b !important;
            color: #4CAF50 !important;
            padding: 8px 12px !important;
            cursor: pointer !important;
            border-radius: 6px !important;
            font-size: 14px !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3) !important;
            pointer-events: auto !important;
            border: 1px solid #4CAF50 !important;
        `;
        const isChecked = GM_getValue(blockKey, false) ? 'checked="checked"' : '';
        header.innerHTML = `
            <span style="font-weight: bold !important; display: flex !important; align-items: center !important;">
                URLs (<span id="agm-count">${mediaUrls.size}</span>)
            </span>
            <div style="display: flex !important; align-items: center !important; gap: 10px !important;">
                <label style="font-size:12px !important; display:flex !important; align-items:center !important; cursor:pointer !important; color: #ff6b6b !important; font-weight: normal !important; margin: 0 !important;" onclick="event.stopPropagation()">
                    <input type="checkbox" id="agm-block-switch" ${isChecked} style="margin-right: 4px !important; cursor: pointer !important; clip: auto !important; appearance: checkbox !important; width: 13px !important; height: 13px !important; opacity: 1 !important; visibility: visible !important; position: static !important;"> 阻断直连
                </label>
                <span id="agm-toggle">▼</span>
            </div>
        `;

        const listWrapper = document.createElement('div');
        listWrapper.id = 'agm-list-wrapper';
        listWrapper.style.cssText = `
            display: none !important;
            background: #fff !important;
            border: 1px solid #ddd !important;
            max-height: 400px !important;
            overflow-y: auto !important;
            margin-top: 8px !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
            pointer-events: auto !important;
        `;

        agmList = document.createElement('ul');
        agmList.style.cssText = `
            list-style: none !important;
            margin: 0 !important;
            padding: 10px !important;
            font-size: 12px !important;
            word-break: break-all !important;
        `;

        listWrapper.appendChild(agmList);
        agmContainer.appendChild(header);
        agmContainer.appendChild(listWrapper);
        document.body.appendChild(agmContainer);

        agmCount = document.getElementById('agm-count');
        const blockSwitch = document.getElementById('agm-block-switch');
        
        // 确保初始化时 DOM 状态与数据一致（修复 UI 显示不符问题）
        if (blockSwitch) {
            blockSwitch.checked = GM_getValue(blockKey, false);
            blockSwitch.addEventListener('change', (e) => {
                GM_setValue(blockKey, e.target.checked);
                console.log(`[AutoGetMedia] 域名 ${topHostname} 的阻断状态已切换为: ${e.target.checked}`);
            });
        }

        blockSwitch.closest('label').addEventListener('click', e => e.stopPropagation());

        // 绑定点击收起/展开事件
        header.addEventListener('click', () => {
            const isHidden = listWrapper.style.display === 'none';
            listWrapper.style.display = isHidden ? 'block' : 'none';
            document.getElementById('agm-toggle').innerText = isHidden ? '▲' : '▼';
        });

        // 渲染之前已经在请求列表中记录到的 URL
        mediaUrls.forEach(url => renderUrlItem(url));
    }

    function renderUrlItem(url) {
        if (!agmList) return;
        const li = document.createElement('li');
        li.style.cssText = 'margin-bottom: 8px !important; border-bottom: 1px dashed #eee !important; padding-bottom: 8px !important;';
        
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.cssText = 'color: #1a73e8 !important; text-decoration: none !important; display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; display: -webkit-box !important; -webkit-line-clamp: 3 !important; -webkit-box-orient: vertical !important;';
        a.innerText = url;
        
        // 自动解析类型按钮
        const opDiv = document.createElement('div');
        opDiv.style.cssText = 'margin-top: 4px !important; display: flex !important; gap: 8px !important;';
        
        const copyBtn = document.createElement('button');
        copyBtn.innerText = '复制链接';
        copyBtn.style.cssText = 'border: 1px solid #ccc !important; background: #f8f9fa !important; border-radius: 3px !important; cursor: pointer !important; padding: 2px 6px !important; font-size: 11px !important; color: #333 !important;';
        copyBtn.onclick = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(url).then(() => {
                const oldText = copyBtn.innerText;
                copyBtn.innerText = '已复制!';
                setTimeout(() => copyBtn.innerText = oldText, 2000);
            });
        };
        
        const downloadBtn = document.createElement('button');
        downloadBtn.innerText = ((mediaInfo.get(url) || {}).hls || isHlsUrl(url)) ? '下载媒体内容' : '下载资源';
        downloadBtn.style.cssText = 'border: 1px solid #1a73e8 !important; background: #e8f0fe !important; border-radius: 3px !important; cursor: pointer !important; padding: 2px 6px !important; font-size: 11px !important; color: #1a73e8 !important;';
        const status = document.createElement('div');
        status.style.cssText = 'color: #555 !important; margin-top: 4px !important; font-size: 11px !important; white-space: pre-wrap !important;';
        downloadBtn.onclick = async (e) => {
            e.preventDefault();
            const originalText = downloadBtn.innerText;
            downloadBtn.disabled = true;
            status.textContent = '';
            try {
                const info = mediaInfo.get(url) || {};
                if (info.hls || isHlsUrl(url)) {
                    status.textContent = await handleM3u8Download(url, downloadBtn);
                    downloadBtn.innerText = '已发起保存';
                } else {
                    downloadBtn.innerText = '下载中...';
                    const res = await requestMedia(url, 'blob', info.referer);
                    saveBlob(res.response, getFileName(url));
                    downloadBtn.innerText = '已发起保存';
                }
            } catch (err) {
                console.error('[AutoGetMedia] 下载出错:', err);
                downloadBtn.innerText = '下载失败';
                status.textContent = err.message;
            }
            setTimeout(() => {
                downloadBtn.innerText = originalText;
                downloadBtn.disabled = false;
            }, 3000);
        };
        
        opDiv.appendChild(copyBtn);
        opDiv.appendChild(downloadBtn);
        li.appendChild(a);
        li.appendChild(opDiv);
        li.appendChild(status);
        agmList.prepend(li); // 将最新的URL加在顶部
    }

    // 全局调用：每当收到新的 URL 时调用
    function updateUI(url) {
        if (agmCount) {
            agmCount.innerText = mediaUrls.size;
        }
        renderUrlItem(url);
    }
    window.updateUI = updateUI;

    // HLS 按 RFC 8216 解析；浏览器内合并容器，不进行转码或音视频混流。
    // https://www.rfc-editor.org/rfc/rfc8216
    async function requestMedia(url, responseType = 'text', referer = window.location.href, range = null) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await new Promise((resolve, reject) => {
                    const headers = { Referer: referer || window.location.href };
                    // 不把当前网页 document.cookie 发送给 CDN；由 GM 按目标域管理 Cookie。
                    if (range) headers.Range = `bytes=${range.start}-${range.end}`;
                    GM_xmlhttpRequest({
                        method: 'GET', url, headers, responseType, timeout: 30000,
                        onload: res => {
                            if (res.status >= 200 && res.status < 300) resolve(res);
                            else reject(Object.assign(new Error(`HTTP ${res.status}: ${url}`), {
                                retryable: res.status === 429 || res.status >= 500
                            }));
                        },
                        onerror: () => reject(Object.assign(new Error(`网络请求失败: ${url}`), { retryable: true })),
                        ontimeout: () => reject(Object.assign(new Error(`请求超时: ${url}`), { retryable: true })),
                        onabort: () => reject(new Error('下载请求已取消'))
                    });
                });
            } catch (error) {
                if (!error.retryable || attempt >= 2) throw error;
                await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
    }

    function getFileName(url) {
        let name = new URL(url).pathname.split('/').pop() || 'media_' + Date.now();
        try { name = decodeURIComponent(name); } catch (e) {}
        return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    }

    function saveBlob(blob, fileName) {
        const blobUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.style.display = 'none';
        anchor.href = blobUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // 立即 revoke 可能在浏览器读取 Blob 前释放数据。
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }

    function parseAttributes(text) {
        const attributes = {};
        const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
        for (const match of text.matchAll(pattern)) {
            attributes[match[1]] = match[2].replace(/^"|"$/g, '');
        }
        return attributes;
    }

    function hlsUrl(uri, base) {
        const url = normalizeUrl(uri, base);
        if (!url || uri.includes('{$')) throw new Error('清单包含不支持的 URL 或变量: ' + uri);
        return url;
    }

    function parseRange(value, url, previous) {
        const match = /^(\d+)(?:@(\d+))?$/.exec(value || '');
        if (!match) throw new Error('无效的 EXT-X-BYTERANGE: ' + value);
        if (match[2] === undefined && (!previous || previous.url !== url || !previous.range)) {
            throw new Error('字节范围缺少起点或同资源的前一个范围');
        }
        const start = match[2] === undefined ? previous.range.end + 1 : Number(match[2]);
        const length = Number(match[1]);
        const end = start + length - 1;
        if (length <= 0 || !Number.isSafeInteger(length) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
            throw new Error('无效或过大的字节范围');
        }
        return { start, end };
    }

    function makeIv(value, sequence) {
        if (value && !/^0x[0-9a-f]{1,32}$/i.test(value)) throw new Error('无效的 AES-128 IV');
        const number = value ? BigInt(value) : sequence;
        if (number < 0n || number >= (1n << 128n)) throw new Error('媒体序号超出 AES IV 范围');
        const hex = number.toString(16).padStart(32, '0');
        return Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16));
    }

    function parsePlaylist(text, base) {
        const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines[0] !== '#EXTM3U') throw new Error('响应不是有效的 m3u8 清单（可能已过期或需要登录）');
        const playlist = { url: base, variants: [], renditions: [], segments: [], live: !lines.includes('#EXT-X-ENDLIST') };
        let variant = null, key = null, map = null, range = null, previous = null, sequence = 0n;
        for (const line of lines.slice(1)) {
            const value = line.slice(line.indexOf(':') + 1);
            if (line.startsWith('#EXT-X-STREAM-INF:')) variant = parseAttributes(value);
            else if (line.startsWith('#EXT-X-MEDIA:')) playlist.renditions.push(parseAttributes(value));
            else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                if (!/^\d+$/.test(value)) throw new Error('无效的媒体序号');
                sequence = BigInt(value);
            } else if (line.startsWith('#EXT-X-KEY:')) {
                const attributes = parseAttributes(value);
                if (attributes.METHOD === 'NONE') key = null;
                else {
                    if (attributes.METHOD !== 'AES-128' || (attributes.KEYFORMAT && attributes.KEYFORMAT !== 'identity')) {
                        throw new Error('暂不支持此加密方式（SAMPLE-AES / DRM），无法直接合并');
                    }
                    if (!attributes.URI) throw new Error('AES-128 清单缺少密钥地址');
                    if (attributes.IV) makeIv(attributes.IV, 0n);
                    key = { url: hlsUrl(attributes.URI, base), iv: attributes.IV };
                }
            } else if (line.startsWith('#EXT-X-BYTERANGE:')) range = value;
            else if (line.startsWith('#EXT-X-MAP:')) {
                const attributes = parseAttributes(value);
                if (!attributes.URI) throw new Error('初始化片段缺少 URI');
                const url = hlsUrl(attributes.URI, base);
                const nextMap = { url, key, range: attributes.BYTERANGE ? parseRange(attributes.BYTERANGE, url, map) : null };
                if (key && !key.iv) throw new Error('加密的初始化片段必须提供显式 IV');
                if (map && JSON.stringify(map) !== JSON.stringify(nextMap)) {
                    throw new Error('清单中初始化片段发生变化，暂不支持直接合并');
                }
                map = nextMap;
            } else if (line === '#EXT-X-I-FRAMES-ONLY' || line.startsWith('#EXT-X-SKIP:') || line === '#EXT-X-GAP') {
                throw new Error('暂不支持仅关键帧、增量清单或含缺失片段的清单');
            } else if (line === '#EXT-X-DISCONTINUITY') playlist.discontinuity = true;
            else if (!line.startsWith('#')) {
                const url = hlsUrl(line, base);
                if (variant) {
                    playlist.variants.push({ url, attributes: variant });
                    variant = null;
                } else {
                    if (playlist.segments.length && !!map !== !!playlist.segments[0].map) {
                        throw new Error('清单中途切换容器，暂不支持直接合并');
                    }
                    const segment = { url, key, map, sequence, range: range ? parseRange(range, url, previous) : null };
                    playlist.segments.push(segment);
                    previous = segment;
                    sequence++;
                    range = null;
                }
            }
        }
        if (variant) throw new Error('主清单缺少子清单 URI');
        if (playlist.segments.some(segment => segment.map) && playlist.discontinuity) {
            throw new Error('fMP4 含时间线不连续点，需使用混流工具处理');
        }
        return playlist;
    }

    async function resolvePlaylist(url, referer, visited = new Set()) {
        if (visited.has(url) || visited.size >= 8) throw new Error('m3u8 子清单循环或层数过多');
        visited.add(url);
        const response = await requestMedia(url, 'text', referer);
        const base = response.finalUrl || url; // 相对地址基于重定向后的清单 URL。
        const playlist = parsePlaylist(response.responseText || response.response || '', base);
        if (!playlist.variants.length) {
            if (!playlist.segments.length) throw new Error('清单中没有完整媒体分片（低延迟直播可能尚未生成分片）');
            return { video: playlist, audio: null };
        }
        // 清单顺序不代表质量，按带宽选取最高码率。
        const selected = playlist.variants.sort((a, b) =>
            Number(b.attributes['AVERAGE-BANDWIDTH'] || b.attributes.BANDWIDTH || 0) -
            Number(a.attributes['AVERAGE-BANDWIDTH'] || a.attributes.BANDWIDTH || 0))[0];
        if (selected.attributes.VIDEO && playlist.renditions.some(item =>
            item.TYPE === 'VIDEO' && item['GROUP-ID'] === selected.attributes.VIDEO && item.URI)) {
            throw new Error('暂不支持主清单中的外置视频轨道');
        }
        const result = await resolvePlaylist(selected.url, referer, visited);
        const audioGroup = playlist.renditions.filter(item => item.TYPE === 'AUDIO' && item['GROUP-ID'] === selected.attributes.AUDIO);
        const audio = audioGroup.find(item => item.DEFAULT === 'YES') || audioGroup.find(item => item.AUTOSELECT === 'YES') || audioGroup[0];
        if (audio && audio.URI) {
            const audioResult = await resolvePlaylist(hlsUrl(audio.URI, base), referer, new Set(visited));
            result.audio = audioResult.video;
        }
        return result;
    }

    async function fetchBytes(item, referer) {
        const res = await requestMedia(item.url, 'arraybuffer', referer, item.range);
        const bytes = new Uint8Array(res.response);
        if (!bytes.byteLength) throw new Error('收到空的媒体分片: ' + item.url);
        if (!item.range) return bytes;
        const { start, end } = item.range;
        if (res.status === 206) {
            const match = /^content-range:\s*bytes\s+(\d+)-(\d+)\/(?:\d+|\*)\s*$/im.exec(res.responseHeaders || '');
            if (!match || Number(match[1]) !== start || Number(match[2]) !== end || bytes.length !== end - start + 1) {
                throw new Error('服务器返回了错误的分片字节范围');
            }
            return bytes;
        }
        // 有些服务器忽略 Range 返回整个文件，必须本地截取而非重复拼接完整文件。
        if (res.status === 200 && bytes.length > end) return bytes.slice(start, end + 1);
        throw new Error('服务器未提供请求的分片字节范围');
    }

    async function downloadPlaylist(playlist, referer, btnElement, label) {
        const keys = new Map();
        async function loadItem(item, sequence = 0n) {
            const bytes = await fetchBytes(item, referer);
            if (!item.key) return bytes;
            if (!globalThis.crypto || !globalThis.crypto.subtle) throw new Error('AES-128 解密需要支持 Web Crypto 的安全页面（HTTPS）');
            if (!keys.has(item.key)) {
                keys.set(item.key, (async () => {
                    const data = await fetchBytes({ url: item.key.url }, referer);
                    if (data.length !== 16) throw new Error('AES-128 密钥长度必须为 16 字节');
                    return crypto.subtle.importKey('raw', data, 'AES-CBC', false, ['decrypt']);
                })());
            }
            try {
                return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: makeIv(item.key.iv, sequence) }, await keys.get(item.key), bytes));
            } catch (error) { throw new Error('AES-128 解密失败: ' + error.message); }
        }
        const segments = playlist.segments;
        const chunks = new Array(segments.length);
        const init = segments[0].map ? await loadItem(segments[0].map) : null;
        let downloaded = 0;
        for (let i = 0; i < segments.length; i += 5) {
            // 等待本批请求全部结束后再报错，避免失败后仍有请求更新 UI。
            const batch = await Promise.allSettled(segments.slice(i, i + 5).map(async (segment, offset) => {
                chunks[i + offset] = await loadItem(segment, segment.sequence);
                btnElement.innerText = `${label} (${++downloaded}/${segments.length})`;
            }));
            const failure = batch.find(result => result.status === 'rejected');
            if (failure) throw failure.reason;
        }
        btnElement.innerText = '合并分片...';
        const pathname = new URL(segments[0].url).pathname;
        const first = chunks[0];
        const boxType = first.length >= 8 ? String.fromCharCode(...first.subarray(4, 8)) : '';
        if (!init && boxType === 'moof') throw new Error('fMP4 清单缺少 EXT-X-MAP 初始化片段');
        let extension = init || boxType === 'ftyp' ? 'mp4' : 'ts';
        if (!init && /\.(aac|mp3)$/i.test(pathname)) extension = pathname.match(/\.(aac|mp3)$/i)[1].toLowerCase();
        const type = extension === 'mp4' ? 'video/mp4' : extension === 'aac' ? 'audio/aac' : extension === 'mp3' ? 'audio/mpeg' : 'video/mp2t';
        return { blob: new Blob(init ? [init, ...chunks] : chunks, { type }), extension };
    }

    async function handleM3u8Download(m3u8Url, btnElement) {
        btnElement.innerText = '解析 m3u8...';
        const referer = (mediaInfo.get(m3u8Url) || {}).referer || window.location.href;
        const tracks = await resolvePlaylist(m3u8Url, referer);
        const notes = [];
        if (tracks.video.live || (tracks.audio && tracks.audio.live)) {
            notes.push('直播：仅保存本次清单中已有的片段，不持续录制。');
        }
        const video = await downloadPlaylist(tracks.video, referer, btnElement, '下载媒体');
        const audio = tracks.audio ? await downloadPlaylist(tracks.audio, referer, btnElement, '下载音轨') : null;
        const name = getFileName(m3u8Url).replace(/\.(m3u8?|[^.]+)$/i, '') || 'media_' + Date.now();
        saveBlob(video.blob, `${name}${tracks.video.live ? '_snapshot' : ''}.${video.extension}`);
        if (audio) {
            saveBlob(audio.blob, `${name}_audio.${audio.extension === 'mp4' ? 'm4a' : audio.extension}`);
            notes.push('独立音轨已单独保存为 _audio 文件；浏览器若拦截多个下载，请允许后重试。需要单个含声音的视频时，需再混流。');
        }
        notes.unshift('已发起媒体文件保存（按带宽选择最高码率）。');
        return notes.join('\n');
    }

})();
