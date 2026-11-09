// ==UserScript==
// @name         AutoGetMedia
// @namespace    https://lhy-cpu.github.io
// @version      0.4.3
// @description  拦截网络请求，并筛选出其中的媒体文件（视频、音频等），支持 HLS、分片下载、音视频混流与格式转换。(Beta)
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
    const PROCESSING_DEFAULTS = { format: 'original', videoMode: 'copy', audioMode: 'copy', videoCodec: 'libx264', audioCodec: 'aac' };
    const savedProcessing = GM_getValue('agm_processing_settings', {});
    const processingSettings = { ...PROCESSING_DEFAULTS, ...(savedProcessing && typeof savedProcessing === 'object' ? savedProcessing : {}) };
    const selectedSources = { video: null, audio: null };
    let mixerUI = null;
    let activeMediaJob = null;
    const resourceParents = new Map();
    const resourceChildren = new Map();
    const renderedItems = new Map();
    const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
    let renderTimer = null;
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
            url.hash = '';
            return /^(https?:)$/.test(url.protocol) ? url.href : null;
        } catch (e) { return null; }
    }

    function isHlsUrl(url) {
        return /\.m3u8(?:$|[?#])/i.test(url);
    }

    function recordResource(url, hls, referer, discovered = false, metadata = {}) {
        const previous = mediaInfo.get(url);
        const info = { ...previous, ...metadata, hls: hls || isHlsUrl(url) || !!(previous && previous.hls), referer };
        if (info.hls && info.bitrate && Number.isFinite(info.duration)) info.estimatedSize = Math.round(info.bitrate * info.duration / 8);
        if (info.hls) {
            delete info.size; // 清单响应体大小不等于实际媒体大小。
            if (metadata.kind === 'hls' && previous && ['audio', 'video'].includes(previous.kind)) info.kind = previous.kind;
        }
        mediaInfo.set(url, info);
        const isNew = !mediaUrls.has(url);
        if (isNew) {
            mediaUrls.add(url);
            if (!discovered) console.log('[AutoGetMedia] 抓取到媒体资源:', url);
        }
        const changed = !previous || JSON.stringify(previous) !== JSON.stringify(info);
        if (window.top === window.self && (isNew || changed)) updateUI();
        if (window.top !== window.self && !discovered && changed) {
            window.top.postMessage({ type: 'AutoGetMedia_NEW_URL', url, hls: info.hls, referer, metadata: info }, '*');
        }
    }

    // 同一 URL 的 Range/重复请求共用一个节点，查询参数保留（签名及不同流可能依赖它）。
    function checkUrl(value, hls = false, referer = window.location.href) {
        if (typeof value !== 'string') return false;
        const url = normalizeUrl(value);
        if (!url) return false;
        const previous = mediaInfo.get(url);
        if (!hls && !(previous && previous.hls) && !mediaExtensions.test(new URL(url).pathname)) return false;
        recordResource(url, hls, referer);
        return isBlockEnabled();
    }

    function cleanMetadata(metadata) {
        const result = {};
        if (!metadata || typeof metadata !== 'object') return result;
        for (const key of ['size', 'duration', 'width', 'height', 'bitrate', 'frameRate', 'sampleRate', 'estimatedSize']) {
            if (Number.isFinite(metadata[key]) && metadata[key] >= 0) result[key] = metadata[key];
        }
        for (const key of ['kind', 'mime', 'codecs', 'channels']) {
            if (typeof metadata[key] === 'string') result[key] = metadata[key].slice(0, 256);
        }
        if (typeof metadata.live === 'boolean') result.live = metadata.live;
        return result;
    }

    function updateResourceMetadata(value, metadata, referer = window.location.href, discovered = false) {
        const url = normalizeUrl(value);
        const clean = cleanMetadata(metadata);
        if (!url || !Object.keys(clean).length) return;
        if (!mediaUrls.has(url) && !clean.kind && !mediaExtensions.test(new URL(url).pathname)) return;
        recordResource(url, clean.kind === 'hls', referer, discovered, clean);
    }

    function linkResource(parent, child) {
        if (parent === child || resourceParents.has(child)) return;
        let ancestor = parent;
        const visited = new Set();
        while (ancestor) {
            if (ancestor === child || visited.has(ancestor)) return;
            visited.add(ancestor);
            ancestor = resourceParents.get(ancestor);
        }
        resourceParents.set(child, parent);
    }

    function registerPlaylistResources(text, value, referer = window.location.href) {
        const url = normalizeUrl(value);
        if (!url || typeof text !== 'string' || text.length > MAX_PLAYLIST_BYTES || !/^\uFEFF?\s*#EXTM3U(?:\s|$)/.test(text)) return;
        recordResource(url, true, referer, true, { kind: (mediaInfo.get(url) || {}).kind === 'audio' ? 'audio' : 'hls' });
        const children = resourceChildren.get(url) || new Set();
        resourceChildren.set(url, children);
        const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.trim());
        let variant = null, duration = 0, hasDuration = false, segmentDuration = null, byteRange = false;
        function add(uri, hls, metadata = {}) {
            const child = normalizeUrl(uri, url);
            if (!child || uri.includes('{$')) return;
            recordResource(child, hls, referer, true, metadata);
            linkResource(url, child);
            children.add(child);
        }
        for (const line of lines) {
            const value = line.slice(line.indexOf(':') + 1);
            if (line.startsWith('#EXT-X-STREAM-INF:')) variant = parseAttributes(value);
            else if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
                const attributes = parseAttributes(value);
                if (attributes.URI && attributes.TYPE !== 'SUBTITLES' && attributes.TYPE !== 'CLOSED-CAPTIONS') {
                    add(attributes.URI, true, { kind: attributes.TYPE === 'AUDIO' ? 'audio' : 'hls', ...(attributes.CHANNELS ? { channels: attributes.CHANNELS } : {}) });
                }
            } else if (line.startsWith('#EXT-X-MAP:') || line.startsWith('#EXT-X-PART:')) {
                const attributes = parseAttributes(value);
                if (attributes.URI) add(attributes.URI, false);
            } else if (line.startsWith('#EXT-X-BYTERANGE:')) byteRange = true;
            else if (line.startsWith('#EXTINF:')) {
                const seconds = Number(value.split(',')[0]);
                if (Number.isFinite(seconds) && seconds >= 0) { duration += seconds; hasDuration = true; segmentDuration = seconds; }
            } else if (line && !line.startsWith('#')) {
                const metadata = {};
                if (!variant && !byteRange && segmentDuration !== null) metadata.duration = segmentDuration;
                if (variant) {
                    const resolution = /^(\d+)x(\d+)$/.exec(variant.RESOLUTION || '');
                    if (resolution) { metadata.width = Number(resolution[1]); metadata.height = Number(resolution[2]); }
                    const bitrate = Number(variant['AVERAGE-BANDWIDTH'] || variant.BANDWIDTH);
                    if (Number.isFinite(bitrate) && bitrate > 0) metadata.bitrate = bitrate;
                    if (variant.CODECS) metadata.codecs = variant.CODECS;
                    const fps = Number(variant['FRAME-RATE']);
                    if (Number.isFinite(fps) && fps > 0) metadata.frameRate = fps;
                }
                add(line, !!variant || isHlsUrl(line), metadata);
                variant = null;
                segmentDuration = null;
                byteRange = false;
            }
        }
        const info = mediaInfo.get(url);
        if (hasDuration) {
            const metadata = { duration, live: !lines.includes('#EXT-X-ENDLIST') };
            if (info.bitrate) metadata.estimatedSize = Math.round(duration * info.bitrate / 8);
            updateResourceMetadata(url, metadata, referer, true);
        }
        if (window.top === window.self) updateUI();
        else window.top.postMessage({ type: 'AutoGetMedia_PLAYLIST', url, text, referer }, '*');
    }

    function fragmentGroup(url) {
        const parsed = new URL(url);
        const name = parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1);
        const match = /^(.*?)(\d+)(\.(?:ts|m4s|aac|mp4))$/i.exec(name);
        if (!match || (!/\.(ts|m4s)$/i.test(name) && !/(seg|chunk|part|frag)/i.test(match[1]))) return null;
        const directory = parsed.origin + parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/') + 1);
        return { key: directory + match[1] + '*' + match[3], directory };
    }

    function buildResourceTree() {
        const nodes = new Map(Array.from(mediaUrls, url => [url, { url, label: url, children: [] }]));
        const parents = new Map(resourceParents);
        const playlists = Array.from(mediaUrls).filter(url => (mediaInfo.get(url) || {}).hls);
        // 未读到正文时，仅将明显分片归入唯一、目录最接近的已捕获清单。
        for (const url of mediaUrls) {
            if (parents.has(url) || (mediaInfo.get(url) || {}).hls || !fragmentGroup(url)) continue;
            const candidates = playlists.map(parent => {
                const parsed = new URL(parent);
                return { parent, directory: parsed.origin + parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/') + 1) };
            })
                .filter(item => url.startsWith(item.directory)).sort((a, b) => b.directory.length - a.directory.length);
            if (candidates.length && (candidates.length === 1 || candidates[0].directory.length > candidates[1].directory.length)) {
                parents.set(url, candidates[0].parent);
            }
        }
        const groups = new Map();
        for (const url of mediaUrls) {
            if (parents.has(url) || (mediaInfo.get(url) || {}).hls) continue;
            const group = fragmentGroup(url);
            if (!group) continue;
            if (!groups.has(group.key)) groups.set(group.key, []);
            groups.get(group.key).push(url);
        }
        const roots = [];
        for (const [key, urls] of groups) {
            if (urls.length < 2) continue;
            const group = { url: null, key: 'group:' + key, label: '分段资源 · ' + key, synthetic: true, children: [] };
            roots.push(group);
            for (const url of urls) parents.set(url, group);
        }
        for (const [url, node] of nodes) {
            const parent = parents.get(url);
            const parentNode = typeof parent === 'string' ? nodes.get(parent) : parent;
            if (parentNode) parentNode.children.push(node);
            else roots.push(node);
        }
        for (const node of [...nodes.values(), ...roots.filter(item => item.synthetic)]) {
            const order = new Map(Array.from(resourceChildren.get(node.url) || [], (url, index) => [url, index]));
            node.children.sort((a, b) => (order.get(a.url) ?? Infinity) - (order.get(b.url) ?? Infinity) || a.label.localeCompare(b.label, undefined, { numeric: true }));
        }
        return roots;
    }

    async function inspectFetchResponse(response, requestUrl) {
        const url = response.url || requestUrl;
        const type = response.headers.get('content-type') || '';
        updateResourceMetadata(url, metadataFromHeaders(url, response.headers, response.status));
        if (hlsMime.test(type)) checkUrl(url, true);
        const mayBePlaylist = isHlsUrl(url) || hlsMime.test(type) || !type || /^(text\/|application\/octet-stream)/i.test(type);
        const mayBeAudio = /^audio\//i.test(type) || /\.(aac|wav)(?:$|[?#])/i.test(url);
        if ((!mayBePlaylist && !mayBeAudio) || !response.body) return;
        const reader = response.clone().body.getReader();
        const decoder = new TextDecoder();
        let text = '', length = 0, identified = false;
        try {
            while (length <= MAX_PLAYLIST_BYTES) {
                const { value, done } = await reader.read();
                if (done) {
                    text += decoder.decode();
                    if (identified) registerPlaylistResources(text, url);
                    break;
                }
                if (!length) updateResourceMetadata(url, metadataFromAudioPrefix(value.subarray(0, 256)));
                length += value.byteLength;
                if (length > MAX_PLAYLIST_BYTES) break;
                text += decoder.decode(value, { stream: true });
                const prefix = text.replace(/^\uFEFF/, '').trimStart();
                if (!identified && prefix.length >= 7) {
                    if (!prefix.startsWith('#EXTM3U')) break;
                    identified = true;
                    checkUrl(url, true);
                } else if (!identified && prefix && !'#EXTM3U'.startsWith(prefix)) break;
            }
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
                        const url = this.responseURL || this._agmUrl;
                        const type = this.getResponseHeader('Content-Type') || '';
                        updateResourceMetadata(url, metadataFromHeaders(url, { get: name => this.getResponseHeader(name) }, this.status));
                        if (hlsMime.test(type)) checkUrl(url, true);
                        if (!this.responseType || this.responseType === 'text') {
                            if (this.responseText.length <= MAX_PLAYLIST_BYTES) registerPlaylistResources(this.responseText, url);
                        } else if (this.responseType === 'blob' && this.response) {
                            const blob = this.response;
                            if (blob.size <= MAX_PLAYLIST_BYTES && (hlsMime.test(type) || isHlsUrl(url) || /^text\//i.test(type))) {
                                blob.text().then(text => registerPlaylistResources(text, url)).catch(() => {});
                            }
                            if (/^audio\//i.test(type)) {
                                blob.slice(0, 256).arrayBuffer().then(bytes => updateResourceMetadata(url, metadataFromAudioPrefix(bytes))).catch(() => {});
                            }
                        } else if (this.responseType === 'arraybuffer' && this.response) {
                            const prefix = new Uint8Array(this.response, 0, Math.min(this.response.byteLength, 256));
                            updateResourceMetadata(url, metadataFromAudioPrefix(prefix));
                            if (this.response.byteLength <= MAX_PLAYLIST_BYTES && new TextDecoder().decode(prefix).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) {
                                registerPlaylistResources(new TextDecoder().decode(this.response), url);
                            }
                        }
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

    // 仅在最外层主页面初始化 UI；也支持非刷新注入。
    if (window.top === window.self) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initUI();
        } else {
            document.addEventListener('DOMContentLoaded', initUI);
        }
    }

    // iframe 中的响应属性和清单关系一并同步。
    if (window.top === window.self) {
        window.addEventListener('message', event => {
            const data = event.data;
            if (!data || !['AutoGetMedia_NEW_URL', 'AutoGetMedia_PLAYLIST'].includes(data.type)) return;
            // Edge/油猴跨执行上下文时 source 可能为空或使用不同窗口包装对象。
            // 这里只接收已知消息类型，资源地址仍由 normalizeUrl 限制为 HTTP(S)。
            let referer = /^https?:/.test(event.origin) ? event.origin + '/' : window.location.href;
            const sourcePage = normalizeUrl(data.referer);
            if (sourcePage && new URL(sourcePage).origin === event.origin) referer = sourcePage;
            if (data.type === 'AutoGetMedia_PLAYLIST') registerPlaylistResources(data.text, data.url, referer);
            else {
                checkUrl(data.url, data.hls === true, referer);
                updateResourceMetadata(data.url, data.metadata, referer);
            }
        });
    }

    function inspectMediaElement(element) {
        if (!element || !/^(VIDEO|AUDIO)$/.test(element.tagName)) return;
        const url = normalizeUrl(element.currentSrc || element.src);
        if (!url) return;
        const metadata = { kind: element.tagName === 'AUDIO' ? 'audio' : 'video' };
        if (Number.isFinite(element.duration) && element.duration > 0) metadata.duration = element.duration;
        if (element.videoWidth > 0 && element.videoHeight > 0) {
            metadata.width = element.videoWidth;
            metadata.height = element.videoHeight;
        }
        updateResourceMetadata(url, metadata);
    }
    document.addEventListener('loadedmetadata', event => inspectMediaElement(event.target), true);
    function inspectExistingMedia() {
        document.querySelectorAll('video, audio').forEach(inspectMediaElement);
    }
    document.addEventListener('DOMContentLoaded', inspectExistingMedia);
    window.addEventListener('load', inspectExistingMedia);
    if (document.readyState !== 'loading') inspectExistingMedia();

    function getProcessingSettings() {
        return { ...processingSettings };
    }

    function markResource(role, url) {
        if (activeMediaJob) return;
        selectedSources[role] = selectedSources[role] === url ? null : url;
        const other = role === 'video' ? 'audio' : 'video';
        if (selectedSources[other] === url) selectedSources[other] = null;
        updateMixerPanel();
        updateUI();
    }

    function createMixerPanel(wrapper) {
        const panel = document.createElement('section');
        panel.id = 'agm-mixer';
        panel.style.cssText = 'border-top: 1px solid #ddd !important; padding: 12px !important; color: #333 !important; font-size: 12px !important;';
        const heading = document.createElement('div');
        heading.textContent = '下载输出';
        heading.style.cssText = 'font-weight: bold !important; margin-bottom: 8px !important;';
        panel.appendChild(heading);
        const controls = {};
        function selectField(key, label, choices) {
            const row = document.createElement('label');
            row.style.cssText = 'display: flex !important; align-items: center !important; gap: 6px !important; margin: 7px 0 !important;';
            const caption = document.createElement('span');
            caption.textContent = label;
            caption.style.cssText = 'width: 88px !important; flex-shrink: 0 !important;';
            const select = document.createElement('select');
            select.id = 'agm-mux-' + key;
            select.style.cssText = 'flex: 1 !important; min-width: 0 !important; font-size: 12px !important; color: #333 !important; background: #fff !important;';
            for (const [value, title] of choices) {
                const option = document.createElement('option');
                option.value = value; option.textContent = title;
                select.appendChild(option);
            }
            if (!choices.some(([value]) => value === processingSettings[key])) processingSettings[key] = PROCESSING_DEFAULTS[key];
            select.value = processingSettings[key];
            select.addEventListener('change', () => {
                processingSettings[key] = select.value;
                GM_setValue('agm_processing_settings', getProcessingSettings());
                updateMixerPanel();
            });
            row.appendChild(caption); row.appendChild(select); panel.appendChild(row);
            controls[key] = select;
        }
        selectField('format', '输出格式', [
            ['original', '原格式（混流默认 MP4）'], ['mp4', 'MP4'], ['mkv', 'MKV'], ['webm', 'WebM'], ['mov', 'MOV'], ['ts', 'MPEG-TS'],
            ['m4a', 'M4A（仅音频）'], ['mp3', 'MP3（仅音频）'], ['aac', 'AAC（仅音频）'], ['wav', 'WAV（仅音频）'], ['flac', 'FLAC（仅音频）'], ['ogg', 'OGG（仅音频）']
        ]);
        selectField('videoMode', '视频处理', [['copy', 'copy · 直接复制流'], ['encode', '重编码']]);
        selectField('videoCodec', '视频编码器', [['libx264', 'H.264 / libx264'], ['libx265', 'H.265 / libx265'], ['libvpx-vp9', 'VP9 / libvpx-vp9'], ['mpeg4', 'MPEG-4']]);
        selectField('audioMode', '音频处理', [['copy', 'copy · 直接复制流'], ['encode', '重编码']]);
        selectField('audioCodec', '音频编码器', [['aac', 'AAC'], ['libmp3lame', 'MP3 / LAME'], ['libopus', 'Opus'], ['flac', 'FLAC'], ['pcm_s16le', 'PCM 16-bit'], ['libvorbis', 'Vorbis']]);
        const encodingHint = document.createElement('div');
        encodingHint.id = 'agm-encoding-hint';
        encodingHint.textContent = '重编码速度较慢，尤其是长视频和 H.265。建议优先使用 copy 模式，仅在需要更换编码时重编码。';
        panel.appendChild(encodingHint);
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size: 11px !important; line-height: 1.5 !important; color: #666 !important; margin: 8px 0 !important;';
        hint.textContent = '以上设置适用于单项下载和下方混流。copy 不改变编码；容器不兼容时请改为重编码。首次转换需加载处理组件，媒体在浏览器本地处理。';
        panel.appendChild(hint);
        const divider = document.createElement('hr');
        divider.style.cssText = 'border: 0 !important; border-top: 1px solid #ddd !important; margin: 14px 0 !important;';
        panel.appendChild(divider);
        const mixerHeading = document.createElement('div');
        mixerHeading.textContent = '混流';
        mixerHeading.style.cssText = heading.style.cssText;
        panel.appendChild(mixerHeading);
        const sourceFields = {};
        for (const [role, label] of [['video', '视频'], ['audio', '音频']]) {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex !important; align-items: center !important; gap: 6px !important; margin-bottom: 6px !important;';
            const name = document.createElement('span');
            name.textContent = label + '：';
            const value = document.createElement('span');
            value.id = 'agm-mux-' + role;
            value.style.cssText = 'flex: 1 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; min-width: 0 !important;';
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.textContent = '清除';
            clear.onclick = () => { if (selectedSources[role]) markResource(role, selectedSources[role]); };
            row.appendChild(name); row.appendChild(value); row.appendChild(clear);
            panel.appendChild(row);
            sourceFields[role] = { value, clear };
        }
        const start = document.createElement('button');
        start.id = 'agm-mux-start'; start.type = 'button'; start.textContent = '混流并下载';
        start.style.cssText = 'color: #1a73e8 !important; padding: 4px 8px !important; margin-right: 8px !important;';
        const cancel = document.createElement('button');
        cancel.id = 'agm-mux-cancel'; cancel.type = 'button'; cancel.textContent = '取消处理';
        cancel.onclick = () => {
            if (!activeMediaJob) return;
            activeMediaJob.cancelled = true;
            cancelMediaFFmpeg();
            mixerUI.status.textContent = '已请求取消，正在结束当前操作…';
        };
        const status = document.createElement('div');
        status.id = 'agm-mux-status';
        status.style.cssText = 'margin-top: 8px !important; font-size: 11px !important; white-space: pre-wrap !important; word-break: break-word !important; color: #555 !important;';
        panel.appendChild(start); panel.appendChild(cancel); panel.appendChild(status);
        start.onclick = async () => {
            if (!selectedSources.video || !selectedSources.audio) return;
            const videoUrl = selectedSources.video, audioUrl = selectedSources.audio;
            const settings = getProcessingSettings();
            status.textContent = '';
            try {
                await runMediaJob(async job => {
                    const progress = progressTarget(message => reportMediaProgress(message, start));
                    const video = await prepareMediaResource(videoUrl, 'video', progress);
                    assertMediaJobActive(job);
                    const audio = await prepareMediaResource(audioUrl, 'audio', progress);
                    assertMediaJobActive(job);
                    const inputs = renameMediaInputs([...video.inputs, ...audio.inputs]);
                    await processAndSaveMedia(inputs, settings, video.base + '_muxed', job, message => reportMediaProgress(message, start));
                    status.textContent = ['已发起混流文件保存。', ...video.notes, ...audio.notes].join('\n');
                });
            } catch (error) { status.textContent = error.message; }
            finally { start.textContent = '混流并下载'; }
        };
        wrapper.appendChild(panel);
        mixerUI = { panel, sourceFields, controls, start, cancel, status, encodingHint };
        updateMixerPanel();
    }

    function updateMixerPanel() {
        if (!mixerUI) return;
        const busy = !!activeMediaJob;
        for (const role of ['video', 'audio']) {
            const url = selectedSources[role];
            mixerUI.sourceFields[role].value.textContent = url ? getFileName(url) : '在资源卡片中标记';
            mixerUI.sourceFields[role].value.title = url || '';
            mixerUI.sourceFields[role].clear.disabled = busy || !url;
        }
        for (const control of Object.values(mixerUI.controls)) control.disabled = busy;
        const audioOnly = ['m4a', 'mp3', 'aac', 'wav', 'flac', 'ogg'].includes(processingSettings.format);
        const reencoding = processingSettings.audioMode === 'encode' || (!audioOnly && processingSettings.videoMode === 'encode');
        mixerUI.encodingHint.style.cssText = `font-size: 11px !important; line-height: 1.5 !important; margin: 8px 0 !important; padding: 6px 8px !important; color: ${reencoding ? '#9a3412' : '#666'} !important; background: ${reencoding ? '#fff7ed' : '#f8f9fa'} !important; border-left: 3px solid ${reencoding ? '#f59e0b' : '#ddd'} !important;`;
        mixerUI.controls.videoMode.disabled = busy || audioOnly;
        mixerUI.controls.videoCodec.disabled = busy || audioOnly || processingSettings.videoMode === 'copy';
        mixerUI.controls.audioCodec.disabled = busy || processingSettings.audioMode === 'copy';
        mixerUI.start.disabled = busy || !selectedSources.video || !selectedSources.audio;
        mixerUI.cancel.disabled = !busy;
    }

    async function runMediaJob(work) {
        if (activeMediaJob) throw new Error('已有媒体处理任务，请等待完成或先取消。');
        const job = { cancelled: false };
        activeMediaJob = job;
        updateMixerPanel();
        try { return await work(job); }
        finally { activeMediaJob = null; updateMixerPanel(); }
    }

    function assertMediaJobActive(job) {
        if (job.cancelled) throw new Error('媒体处理已取消。');
    }

    function reportMediaProgress(message, button) {
        const text = String(message);
        const compact = text.split(' · ')[0];
        if (button) button.innerText = text.length > 32 ? (compact.length <= 32 ? compact : '处理中…') : text;
        if (mixerUI) mixerUI.status.textContent = text;
    }

    function progressTarget(report) {
        return { set innerText(text) { report(text); } };
    }

    function renameMediaInputs(inputs) {
        return inputs.map((input, index) => {
            const extension = /\.([a-z0-9]{1,8})$/i.exec(input.name);
            return { ...input, name: `input${index}.${extension ? extension[1].toLowerCase() : 'bin'}` };
        });
    }

    async function processAndSaveMedia(inputs, settings, base, job, report) {
        assertMediaJobActive(job);
        const command = buildMediaCommand(inputs, settings, base);
        const engineInputs = inputs.map((input, index) => ({ ...input, name: `input${index}` }));
        const blob = await runMediaFFmpeg(engineInputs, command.args, report);
        assertMediaJobActive(job);
        if (!blob || !blob.size) throw new Error('处理结果为空，未保存文件。');
        saveBlob(new Blob([blob], { type: command.mime }), command.outputName);
        if (report) report('处理完成，已发起文件保存。');
    }

    async function prepareMediaResource(url, role, button) {
        const info = mediaInfo.get(url) || {};
        const referer = info.referer || window.location.href;
        if (!info.hls && !isHlsUrl(url)) {
            button.innerText = '下载源文件…';
            const response = await requestMedia(url, 'blob', referer);
            return { inputs: [{ name: getFileName(url), blob: response.response, role, duration: (mediaInfo.get(url) || {}).duration }], base: getFileName(url).replace(/\.[^.]+$/, ''), notes: [] };
        }
        button.innerText = '解析 m3u8…';
        const tracks = await resolvePlaylist(url, referer);
        const notes = [];
        if (tracks.video.live || (tracks.audio && tracks.audio.live)) notes.push('直播：仅保存本次清单中已有的片段，不持续录制。');
        const rawBase = getFileName(url).replace(/\.m3u8?$/i, '') || 'media';
        const base = rawBase + (tracks.video.live ? '_snapshot' : '');
        const inputs = [];
        if (role === 'audio' && tracks.audio) {
            const audio = await downloadPlaylist(tracks.audio, referer, button, '下载音轨');
            inputs.push({ name: `${rawBase}_audio.${audio.extension}`, blob: audio.blob, role: 'audio', duration: audio.duration });
        } else {
            const video = await downloadPlaylist(tracks.video, referer, button, '下载媒体');
            inputs.push({ name: `${base}.${video.extension}`, blob: video.blob, role: role === 'auto' && tracks.audio ? 'video' : role, duration: video.duration });
            if (role === 'auto' && tracks.audio) {
                const audio = await downloadPlaylist(tracks.audio, referer, button, '下载音轨');
                inputs.push({ name: `${rawBase}_audio.${audio.extension === 'mp4' ? 'm4a' : audio.extension}`, blob: audio.blob, role: 'audio', duration: audio.duration });
            }
        }
        return { inputs, base, notes };
    }

    async function downloadMediaResource(url, button) {
        const settings = getProcessingSettings();
        const needsProcessing = settings.format !== 'original' || settings.videoMode !== 'copy' || settings.audioMode !== 'copy';
        async function download(job) {
            const prepared = await prepareMediaResource(url, 'auto', button);
            if (job) {
                assertMediaJobActive(job);
                await processAndSaveMedia(renameMediaInputs(prepared.inputs), settings, prepared.base, job, message => reportMediaProgress(message, button));
            } else {
                for (const input of prepared.inputs) saveBlob(input.blob, input.name);
                if (prepared.inputs.length > 1) prepared.notes.push('独立音轨已单独保存为 _audio 文件；也可标记视频/音频后在下方面板混流。');
            }
            const hls = (mediaInfo.get(url) || {}).hls || isHlsUrl(url);
            return [(hls ? '已发起媒体文件保存（按带宽选择最高码率）。' : '已发起文件保存。'), ...prepared.notes].join('\n');
        }
        return needsProcessing ? runMediaJob(download) : download(null);
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
            width: min(380px, calc(100vw - 40px)) !important;
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
            max-height: min(70vh, 640px) !important;
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
        createMixerPanel(listWrapper);
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
        renderResourceTree();
    }

    function createResourceItem(node) {
        const url = node.url;
        const li = document.createElement('li');
        li.style.cssText = 'list-style: none !important; margin: 0 0 8px !important; border: 1px solid #dce6f5 !important; border-radius: 6px !important; padding: 8px !important; background: #fff !important;';
        
        const a = document.createElement(url ? 'a' : 'span');
        if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.style.cssText = 'color: #1a73e8 !important; text-decoration: none !important; display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; display: -webkit-box !important; -webkit-line-clamp: 3 !important; -webkit-box-orient: vertical !important;';
        a.innerText = node.label;
        
        // 自动解析类型按钮
        const opDiv = document.createElement('div');
        opDiv.style.cssText = `margin-top: 4px !important; display: ${url ? 'flex' : 'none'} !important; gap: 8px !important; flex-wrap: wrap !important;`;
        
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
                status.textContent = await downloadMediaResource(url, downloadBtn);
                downloadBtn.innerText = '已发起保存';
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
        
        const markButtons = {};
        for (const [role, label] of [['video', '视频'], ['audio', '音频']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.style.cssText = copyBtn.style.cssText;
            button.onclick = e => { e.preventDefault(); markResource(role, url); };
            button.textContent = '标为' + label;
            markButtons[role] = button;
        }
        opDiv.appendChild(copyBtn);
        opDiv.appendChild(downloadBtn);
        opDiv.appendChild(markButtons.video);
        opDiv.appendChild(markButtons.audio);
        li.appendChild(a);
        const metadata = document.createElement('div');
        metadata.style.cssText = 'font-size: 11px !important; line-height: 1.6 !important; color: #666 !important; margin-top: 3px !important;';
        li.appendChild(metadata);
        li.appendChild(opDiv);
        li.appendChild(status);
        const details = document.createElement('details');
        details.style.cssText = 'margin-top: 6px !important; padding-left: 6px !important; border-left: 2px solid #dce6f5 !important;';
        const summary = document.createElement('summary');
        summary.style.cssText = 'cursor: pointer !important; font-size: 11px !important; color: #1a73e8 !important;';
        const children = document.createElement('ul');
        children.style.cssText = 'list-style: none !important; margin: 6px 0 0 !important; padding: 0 0 0 8px !important;';
        details.addEventListener('toggle', updateUI);
        details.appendChild(summary);
        details.appendChild(children);
        li.appendChild(details);
        // 原生 details 默认折叠；更新时复用节点，保留展开状态和正在下载的按钮。
        return { li, details, summary, children, metadata, downloadBtn, markButtons };
    }

    function renderResourceTree() {
        if (!agmList) return;
        function render(node) {
            const key = node.url || node.key;
            let item = renderedItems.get(key);
            if (!item) { item = createResourceItem(node); renderedItems.set(key, item); }
            item.metadata.textContent = node.url ? formatMediaMetadata(mediaInfo.get(node.url) || {}) : `${node.children.length} 个分片`;
            item.details.hidden = !node.children.length;
            item.summary.textContent = `${item.details.open ? '收起' : '展开'}子资源 (${node.children.length})`;
            if (!item.downloadBtn.disabled && ['下载资源', '下载媒体内容'].includes(item.downloadBtn.innerText)) {
                item.downloadBtn.innerText = (mediaInfo.get(node.url) || {}).hls ? '下载媒体内容' : '下载资源';
            }
            for (const [role, label] of [['video', '视频'], ['audio', '音频']]) {
                item.markButtons[role].textContent = selectedSources[role] === node.url ? '✓ 已标' + label : '标为' + label;
                item.markButtons[role].disabled = !!activeMediaJob;
            }
            item.children.replaceChildren(...(item.details.open ? node.children.map(render) : []));
            return item.li;
        }
        agmList.replaceChildren(...buildResourceTree().map(render));
        if (agmCount) agmCount.innerText = mediaUrls.size;
    }

    function updateUI() {
        if (agmCount) agmCount.innerText = mediaUrls.size;
        if (!agmList || renderTimer !== null) return;
        renderTimer = setTimeout(() => { renderTimer = null; renderResourceTree(); }, 50);
    }
    window.updateUI = updateUI;

    // --- 浏览器媒体处理引擎 ---
    // ffmpeg.wasm @ffmpeg/core 0.12.10 (single-thread), loaded only on demand.
    // https://github.com/ffmpegwasm/ffmpeg.wasm
    const mediaFFmpegEngine = (function(root) {

  "use strict";

  const CORE_VERSION = "0.12.10";
  const CORE_ASSET_SOURCES = Object.freeze([
    Object.freeze({
      cdn: "jsdelivr",
      js: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      wasm: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
    }),
    Object.freeze({
      cdn: "unpkg",
      js: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      wasm: `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
    }),
  ]);
  const REQUEST_TIMEOUT_MS = 120000;
  const REQUEST_RETRIES = 2;

  function makeError(message, name, cause) {
    const error = new Error(message);
    if (name) error.name = name;
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  function abortError(message) {
    return makeError(message || "FFmpeg task was cancelled", "AbortError");
  }

  function asError(value, fallback) {
    if (value instanceof Error) return value;
    if (value && typeof value.message === "string") {
      return makeError(value.message, value.name || "Error");
    }
    return makeError(fallback || String(value || "Unknown error"));
  }

  function notifyStatus(callback, payload) {
    if (typeof callback !== "function") return;
    try {
      callback(payload);
    } catch (_) {
      // A UI callback must not break a media task.
    }
  }

  function makeSignal() {
    let aborted = false;
    let reason = null;
    const listeners = new Set();
    return {
      get aborted() { return aborted; },
      get reason() { return reason; },
      abort(error) {
        if (aborted) return;
        aborted = true;
        reason = error || abortError();
        for (const listener of Array.from(listeners)) {
          try { listener(reason); } catch (_) { /* continue notifying */ }
        }
        listeners.clear();
      },
      onAbort(listener) {
        if (aborted) {
          listener(reason);
          return function noop() {};
        }
        listeners.add(listener);
        return function unsubscribe() { listeners.delete(listener); };
      },
    };
  }

  function subscribeAbort(signal, listener) {
    if (!signal) return function noop() {};
    if (typeof signal.onAbort === "function") return signal.onAbort(listener);
    if (signal.aborted) {
      listener(signal.reason || abortError());
      return function noop() {};
    }
    if (typeof signal.addEventListener === "function") {
      const wrapped = function onAbort() {
        listener(signal.reason || abortError());
      };
      signal.addEventListener("abort", wrapped, { once: true });
      return function unsubscribe() {
        signal.removeEventListener("abort", wrapped);
      };
    }
    return function noop() {};
  }

  function toArrayBuffer(value) {
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return value;
    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    throw makeError("Runtime download did not return an ArrayBuffer");
  }

  function responseBody(response, type) {
    if (type === "arraybuffer" || type === "wasm") {
      return toArrayBuffer(response && response.response);
    }
    const text = response && (typeof response.responseText === "string"
      ? response.responseText
      : response.response);
    if (typeof text !== "string" || text.length === 0) {
      throw makeError("Runtime download returned an empty text response");
    }
    return text;
  }

  function gmRequestFunction(environment) {
    if (environment && typeof environment.GM_xmlhttpRequest === "function") {
      return { fn: environment.GM_xmlhttpRequest, thisArg: environment };
    }
    if (environment && environment.GM && typeof environment.GM.xmlHttpRequest === "function") {
      return { fn: environment.GM.xmlHttpRequest, thisArg: environment.GM };
    }
    throw makeError("GM_xmlhttpRequest (or GM.xmlHttpRequest) is required to load FFmpeg");
  }

  function waitBeforeRetry(ms, environment, customSleep) {
    if (typeof customSleep === "function") return customSleep(ms);
    const setTimer = environment && typeof environment.setTimeout === "function"
      ? environment.setTimeout.bind(environment)
      : setTimeout;
    return new Promise((resolve) => setTimer(resolve, ms));
  }

  function requestRuntimeAsset(url, type, onStatus, environment, options) {
    const opts = options || {};
    const requestInfo = gmRequestFunction(environment);
    const signal = opts.signal;

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(signal.reason || abortError());
        return;
      }

      let settled = false;
      let requestHandle = null;
      let unsubscribe = function noop() {};

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        if (error) reject(error);
        else resolve(value);
      };

      const abortRequest = (reason) => {
        const error = reason || abortError();
        finish(error);
        try {
          if (requestHandle && typeof requestHandle.abort === "function") requestHandle.abort();
        } catch (_) {
          // Rejecting the task is enough if the userscript manager cannot abort the network call.
        }
      };

      unsubscribe = subscribeAbort(signal, abortRequest);

      const details = {
        method: "GET",
        url,
        responseType: type === "arraybuffer" || type === "wasm" ? "arraybuffer" : "text",
        timeout: REQUEST_TIMEOUT_MS,
        onprogress(event) {
          notifyStatus(onStatus, {
            phase: "runtime-download",
            url,
            loaded: Number(event && event.loaded) || 0,
            total: Number(event && event.total) || 0,
            lengthComputable: event && event.lengthComputable,
          });
        },
        onload(response) {
          const status = Number(response && response.status);
          if (!(status >= 200 && status < 300)) {
            finish(makeError(`HTTP ${status || "error"} while downloading FFmpeg runtime asset`));
            return;
          }
          try {
            finish(null, responseBody(response, type));
          } catch (error) {
            finish(asError(error, "Invalid FFmpeg runtime response"));
          }
        },
        onerror() { finish(makeError("Network error while downloading FFmpeg runtime asset")); },
        ontimeout() { finish(makeError("Timed out downloading FFmpeg runtime asset")); },
        onabort() { finish(abortError("FFmpeg runtime download was aborted")); },
      };

      try {
        requestHandle = requestInfo.fn.call(requestInfo.thisArg, details) || null;
        if (typeof opts.onRequest === "function") opts.onRequest(requestHandle);
        // Modern GM.xmlHttpRequest implementations can return a Promise instead of invoking callbacks.
        if (requestHandle && typeof requestHandle.then === "function") {
          requestHandle.then(details.onload, details.onerror);
        }
      } catch (error) {
        finish(asError(error, "Could not start FFmpeg runtime download"));
      }
    });
  }

  /** Download a text or ArrayBuffer asset through the userscript manager, with two retries. */
  async function downloadRuntimeAsset(url, type, onStatus, environment, options) {
    const env = environment || root;
    const opts = options || {};
    const retries = Number.isInteger(opts.retries) ? Math.max(0, opts.retries) : REQUEST_RETRIES;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (opts.signal && opts.signal.aborted) throw opts.signal.reason || abortError();
      try {
        return await requestRuntimeAsset(url, type, onStatus, env, opts);
      } catch (error) {
        lastError = asError(error, "FFmpeg runtime download failed");
        if (lastError.name === "AbortError" || (opts.signal && opts.signal.aborted)) throw lastError;
        if (attempt >= retries) break;
        notifyStatus(onStatus, {
          phase: "runtime-retry",
          url,
          attempt: attempt + 1,
          retries,
          message: lastError.message,
        });
        const delay = Array.isArray(opts.retryDelays)
          ? Number(opts.retryDelays[attempt]) || 0
          : attempt === 0 ? 250 : 750;
        await waitBeforeRetry(delay, env, opts.sleep);
      }
    }

    throw lastError || makeError("FFmpeg runtime download failed");
  }

  function normalizeFsPath(path, description) {
    if (typeof path !== "string" || path.length === 0) {
      throw makeError(`${description} filename must be a non-empty string`);
    }
    if (path.indexOf("\0") !== -1 || path.indexOf("\\") !== -1 || path.startsWith("/")) {
      throw makeError(`${description} filename must be a relative FFmpeg virtual path`);
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw makeError(`${description} filename contains an unsafe path segment`);
    }
    return path;
  }

  function prepareInputsAndArgs(inputs, args) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw makeError("At least one input Blob is required");
    }
    if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== "string")) {
      throw makeError("FFmpeg args must be a non-empty array of strings");
    }

    const normalizedInputs = inputs.map((input, index) => {
      if (!input || typeof input !== "object") throw makeError(`Input ${index + 1} is invalid`);
      const name = normalizeFsPath(input.name, `Input ${index + 1}`);
      if (!input.blob || typeof input.blob.arrayBuffer !== "function") {
        throw makeError(`Input ${index + 1} must contain a Blob`);
      }
      return { name, blob: input.blob };
    });
    const names = new Set();
    for (const input of normalizedInputs) {
      if (names.has(input.name)) throw makeError(`Duplicate input filename: ${input.name}`);
      names.add(input.name);
    }

    const cleanArgs = args.slice();
    const outputName = normalizeFsPath(cleanArgs[cleanArgs.length - 1], "Output");
    if (names.has(outputName)) throw makeError("Output filename must differ from every input filename");
    return { inputs: normalizedInputs, args: cleanArgs, outputName };
  }

  function mimeForOutput(filename) {
    const extension = filename.split(".").pop().toLowerCase();
    const types = {
      mp4: "video/mp4", m4v: "video/mp4", m4a: "audio/mp4",
      mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
      avi: "video/x-msvideo", mpeg: "video/mpeg", mpg: "video/mpeg",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
      opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac", m4b: "audio/mp4",
      gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    };
    return types[extension] || "application/octet-stream";
  }

  function mediaFFmpegWorker() {
    "use strict";
    let core = null;
    let currentTaskId = null;

    function send(message, transfer) {
      self.postMessage(message, transfer || []);
    }

    function serializeError(error) {
      return {
        name: error && error.name ? String(error.name) : "Error",
        message: error && error.message ? String(error.message) : String(error || "Unknown error"),
        stack: error && error.stack ? String(error.stack) : "",
      };
    }

    function normalizePath(path, description) {
      if (typeof path !== "string" || path.length === 0 || path.indexOf("\0") !== -1 ||
          path.indexOf("\\") !== -1 || path.startsWith("/")) {
        throw new Error(`${description} filename must be a relative FFmpeg virtual path`);
      }
      const parts = path.split("/");
      if (parts.some((part) => !part || part === "." || part === "..")) {
        throw new Error(`${description} filename contains an unsafe path segment`);
      }
      return path;
    }

    function ensureParentDirectories(path, madeDirectories) {
      const pieces = path.split("/");
      pieces.pop();
      let current = "";
      for (const piece of pieces) {
        current = current ? `${current}/${piece}` : piece;
        try {
          core.FS.mkdir(current);
          madeDirectories.push(current);
        } catch (error) {
          let exists = false;
          try {
            if (typeof core.FS.analyzePath === "function") exists = core.FS.analyzePath(current).exists;
            else if (typeof core.FS.stat === "function") { core.FS.stat(current); exists = true; }
          } catch (_) {
            exists = false;
          }
          if (!exists) throw error;
        }
      }
    }

    function cleanupFiles(files, directories) {
      for (const path of Array.from(files).reverse()) {
        try { core.FS.unlink(path); } catch (_) { /* absent or already removed */ }
      }
      for (const path of directories.slice().reverse()) {
        try { core.FS.rmdir(path); } catch (_) { /* non-empty or already removed */ }
      }
    }

    self.onmessage = async function handleMessage(event) {
      const message = event && event.data ? event.data : {};
      if (message.type === "init") {
        try {
          if (typeof self.importScripts !== "function") throw new Error("Worker importScripts is unavailable");
          self.importScripts(message.coreJsUrl);
          if (typeof self.createFFmpegCore !== "function") {
            throw new Error("The FFmpeg UMD core did not expose createFFmpegCore");
          }
          if (!(message.wasmBinary instanceof ArrayBuffer)) {
            throw new Error("The FFmpeg WASM payload is not an ArrayBuffer");
          }
          core = await self.createFFmpegCore({ wasmBinary: message.wasmBinary });
          if (!core || !core.FS || typeof core.exec !== "function" || typeof core.reset !== "function") {
            throw new Error("The FFmpeg core is missing its FS/exec/reset API");
          }
          core.setLogger(function onCoreLog(entry) {
            send({ type: "status", id: currentTaskId, status: { phase: "ffmpeg-log", data: entry } });
          });
          core.setProgress(function onCoreProgress(progress) {
            send({ type: "status", id: currentTaskId, status: { phase: "ffmpeg-progress", data: progress } });
          });
          send({ type: "ready" });
        } catch (error) {
          send({ type: "init-error", error: serializeError(error) });
        }
        return;
      }

      if (message.type !== "run") return;
      const id = message.id;
      const files = new Set();
      const directories = [];
      let error = null;
      let outputBuffer = null;
      let exitCode = -1;
      currentTaskId = id;
      try {
        if (!core) throw new Error("FFmpeg core is not initialized");
        if (!Array.isArray(message.inputs) || !Array.isArray(message.args) || message.args.length === 0) {
          throw new Error("Invalid FFmpeg task payload");
        }
        const inputs = message.inputs.map((input, index) => ({
          name: normalizePath(input && input.name, `Input ${index + 1}`),
          buffer: input && input.buffer,
        }));
        const args = message.args;
        const outputName = normalizePath(args[args.length - 1], "Output");
        const inputNames = new Set(inputs.map((input) => input.name));
        if (inputNames.size !== inputs.length) throw new Error("Duplicate input filenames are not allowed");
        if (inputNames.has(outputName)) throw new Error("Output filename must differ from every input filename");

        for (const input of inputs) {
          if (!(input.buffer instanceof ArrayBuffer)) throw new Error(`Input ${input.name} is not an ArrayBuffer`);
          ensureParentDirectories(input.name, directories);
          files.add(input.name);
          core.FS.writeFile(input.name, new Uint8Array(input.buffer));
        }
        ensureParentDirectories(outputName, directories);
        files.add(outputName);
        core.exec(...args);
        exitCode = Number(core.ret);
        if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
        const output = core.FS.readFile(outputName);
        if (!output || output.byteLength === 0) throw new Error("FFmpeg produced an empty output file");
        outputBuffer = Uint8Array.from(output).buffer;
      } catch (caught) {
        error = serializeError(caught);
        error.exitCode = exitCode;
      } finally {
        if (core) {
          cleanupFiles(files, directories);
          try { core.reset(); } catch (_) { /* next task will report a core failure if unusable */ }
        }
        currentTaskId = null;
      }

      if (error) send({ type: "job-error", id, error });
      else send({ type: "done", id, buffer: outputBuffer }, [outputBuffer]);
    };
  }

  function createMediaFFmpegEngine(options) {
    const opts = options || {};
    const environment = opts.globalObject || root;
    const WorkerCtor = opts.Worker || environment.Worker;
    const BlobCtor = opts.Blob || environment.Blob;
    const URLApi = opts.URL || environment.URL;
    const sources = Array.isArray(opts.sources) ? opts.sources : CORE_ASSET_SOURCES;
    const sleep = opts.sleep;
    const retryDelays = opts.retryDelays;
    const runtimeDownloader = typeof opts.downloadRuntimeAsset === "function"
      ? opts.downloadRuntimeAsset
      : function defaultRuntimeDownloader(url, type, onStatus, signal) {
        return downloadRuntimeAsset(url, type, onStatus, environment, {
          signal,
          sleep,
          retryDelays,
        });
      };

    let runtime = null;
    let pumping = false;
    let activeJob = null;
    let nextTaskId = 1;
    const queue = [];

    function ensurePlatformSupport() {
      if (typeof WorkerCtor !== "function") throw makeError("Classic Web Worker is unavailable in this browser");
      if (typeof BlobCtor !== "function") throw makeError("Blob is unavailable in this browser");
      if (!URLApi || typeof URLApi.createObjectURL !== "function" || typeof URLApi.revokeObjectURL !== "function") {
        throw makeError("Blob URL support is unavailable in this browser");
      }
    }

    function revoke(url) {
      if (!url) return;
      try { URLApi.revokeObjectURL(url); } catch (_) { /* resource is already gone */ }
    }

    function closeRuntime(target, reason) {
      if (!target || target.closed) return;
      target.closed = true;
      if (runtime === target) runtime = null;
      if (target.unsubscribeAbort) {
        target.unsubscribeAbort();
        target.unsubscribeAbort = null;
      }
      for (const url of target.blobUrls || []) revoke(url);
      target.blobUrls = [];
      try {
        if (target.worker) {
          target.worker.onmessage = null;
          target.worker.onerror = null;
          target.worker.terminate();
        }
      } catch (_) {
        // The worker may already have terminated itself.
      }
      if (target.currentTask) {
        const current = target.currentTask;
        target.currentTask = null;
        current.reject(reason || makeError("FFmpeg worker stopped"));
      }
    }

    function createWorkerAttempt(coreJsText, wasmBinary, source, job) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let ready = false;
        let worker = null;
        const blobUrls = [];
        const target = {
          worker: null,
          ready: false,
          closed: false,
          source,
          blobUrls,
          currentTask: null,
          unsubscribeAbort: null,
        };

        const cleanupAttempt = (error) => {
          if (settled) return;
          settled = true;
          if (target.unsubscribeAbort) {
            target.unsubscribeAbort();
            target.unsubscribeAbort = null;
          }
          target.closed = true;
          for (const url of blobUrls) revoke(url);
          blobUrls.length = 0;
          try {
            if (worker) {
              worker.onmessage = null;
              worker.onerror = null;
              worker.terminate();
            }
          } catch (_) { /* ignore termination errors */ }
          reject(error);
        };

        try {
          ensurePlatformSupport();
          const coreJsUrl = URLApi.createObjectURL(new BlobCtor([coreJsText], { type: "text/javascript" }));
          blobUrls.push(coreJsUrl);
          const workerText = `(${mediaFFmpegWorker.toString()})();`;
          const workerUrl = URLApi.createObjectURL(new BlobCtor([workerText], { type: "text/javascript" }));
          blobUrls.push(workerUrl);
          worker = new WorkerCtor(workerUrl);
          target.worker = worker;
        } catch (error) {
          cleanupAttempt(asError(error, "Could not create FFmpeg worker"));
          return;
        }

        target.unsubscribeAbort = subscribeAbort(job.signal, (error) => {
          cleanupAttempt(error || abortError());
        });
        if (job.signal.aborted) {
          cleanupAttempt(job.signal.reason || abortError());
          return;
        }

        worker.onmessage = (event) => {
          const message = event && event.data ? event.data : {};
          if (!ready) {
            if (message.type === "ready") {
              settled = true;
              ready = true;
              target.ready = true;
              if (target.unsubscribeAbort) {
                target.unsubscribeAbort();
                target.unsubscribeAbort = null;
              }
              for (const url of blobUrls) revoke(url);
              blobUrls.length = 0;
              resolve(target);
            } else if (message.type === "init-error") {
              const error = asError(message.error, "FFmpeg core initialization failed");
              cleanupAttempt(error);
            }
            return;
          }

          if (message.type === "status") {
            const task = target.currentTask;
            if (task && (message.id === null || message.id === task.id)) {
              notifyStatus(task.onStatus, message.status);
            }
            return;
          }

          const task = target.currentTask;
          if (!task || message.id !== task.id) return;
          if (message.type === "done") {
            target.currentTask = null;
            task.resolve(message.buffer);
          } else if (message.type === "job-error") {
            const error = asError(message.error, "FFmpeg task failed");
            if (message.error && Number.isFinite(Number(message.error.exitCode))) error.exitCode = Number(message.error.exitCode);
            target.currentTask = null;
            task.reject(error);
          }
        };

        worker.onerror = (event) => {
          const error = makeError(event && event.message ? event.message : "FFmpeg worker failed");
          if (!ready) cleanupAttempt(error);
          else closeRuntime(target, error);
        };

        try {
          const transferableWasm = wasmBinary.slice(0);
          worker.postMessage({ type: "init", coreJsUrl: blobUrls[0], wasmBinary: transferableWasm }, [transferableWasm]);
        } catch (error) {
          cleanupAttempt(asError(error, "Could not initialize FFmpeg worker"));
        }
      });
    }

    function throwIfCancelled(job) {
      if (job.signal.aborted) throw job.signal.reason || abortError();
    }

    async function ensureRuntime(job) {
      if (runtime && !runtime.closed) {
        notifyStatus(job.onStatus, { phase: 'runtime-ready', version: CORE_VERSION, cdn: runtime.source.cdn });
        return runtime;
      }
      ensurePlatformSupport();
      let lastError = null;
      for (const source of sources) {
        throwIfCancelled(job);
        notifyStatus(job.onStatus, {
          phase: "runtime-source",
          version: CORE_VERSION,
          cdn: source.cdn,
          message: `Loading FFmpeg core ${CORE_VERSION} from ${source.cdn}`,
        });
        try {
          const jsText = await runtimeDownloader(source.js, "text", job.onStatus, job.signal);
          throwIfCancelled(job);
          const wasmBinary = toArrayBuffer(await runtimeDownloader(source.wasm, "arraybuffer", job.onStatus, job.signal));
          throwIfCancelled(job);
          const loaded = await createWorkerAttempt(jsText, wasmBinary, source, job);
          throwIfCancelled(job);
          runtime = loaded;
          notifyStatus(job.onStatus, { phase: "runtime-ready", version: CORE_VERSION, cdn: source.cdn });
          return loaded;
        } catch (error) {
          lastError = asError(error, `Could not initialize FFmpeg core from ${source.cdn}`);
          if (job.signal.aborted || lastError.name === "AbortError") throw lastError;
          notifyStatus(job.onStatus, {
            phase: "runtime-source-error",
            version: CORE_VERSION,
            cdn: source.cdn,
            message: lastError.message,
          });
        }
      }
      throw makeError(`Could not load FFmpeg core ${CORE_VERSION} from either CDN`, "Error", lastError);
    }

    async function runWorkerTask(target, job) {
      const preparedInputs = await Promise.all(job.inputs.map(async (input) => ({
        name: input.name,
        buffer: await input.blob.arrayBuffer(),
      })));
      throwIfCancelled(job);

      return new Promise((resolve, reject) => {
        const id = nextTaskId++;
        let settled = false;
        let unsubscribeAbort = function noop() {};
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          unsubscribeAbort();
          if (target.currentTask && target.currentTask.id === id) target.currentTask = null;
          callback(value);
        };
        target.currentTask = {
          id,
          onStatus: job.onStatus,
          resolve: (buffer) => finish(resolve, buffer),
          reject: (error) => finish(reject, error),
        };
        unsubscribeAbort = subscribeAbort(job.signal, (error) => {
          closeRuntime(target, error || abortError());
        });
        if (job.signal.aborted) {
          closeRuntime(target, job.signal.reason || abortError());
          return;
        }

        try {
          const transfers = preparedInputs.map((input) => input.buffer);
          target.worker.postMessage({ type: "run", id, inputs: preparedInputs, args: job.args }, transfers);
        } catch (error) {
          target.currentTask.reject(asError(error, "Could not send FFmpeg task to worker"));
        }
      }).then((buffer) => {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
          throw makeError("FFmpeg returned empty output bytes");
        }
        throwIfCancelled(job);
        return new BlobCtor([buffer], { type: mimeForOutput(job.outputName) });
      });
    }

    async function pumpQueue() {
      if (pumping) return;
      pumping = true;
      try {
        while (queue.length) {
          const job = queue.shift();
          if (job.signal.aborted) {
            job.reject(job.signal.reason || abortError());
            continue;
          }
          activeJob = job;
          try {
            const currentRuntime = await ensureRuntime(job);
            throwIfCancelled(job);
            const result = await runWorkerTask(currentRuntime, job);
            job.resolve(result);
          } catch (error) {
            job.reject(asError(error, "FFmpeg task failed"));
          } finally {
            if (activeJob === job) activeJob = null;
          }
        }
      } finally {
        pumping = false;
        if (queue.length) void pumpQueue();
      }
    }

    function runMediaFFmpeg(inputs, args, onStatus) {
      let prepared;
      try {
        prepared = prepareInputsAndArgs(inputs, args);
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const signal = makeSignal();
        const job = {
          inputs: prepared.inputs,
          args: prepared.args,
          outputName: prepared.outputName,
          onStatus,
          signal,
          resolve(value) {
            if (settled) return;
            settled = true;
            resolve(value);
          },
          reject(error) {
            if (settled) return;
            settled = true;
            reject(error);
          },
        };
        queue.push(job);
        void pumpQueue();
      });
    }

    function cancelMediaFFmpeg() {
      const error = abortError();
      if (activeJob) {
        activeJob.signal.abort(error);
        activeJob.reject(error);
      }
      for (const job of queue.splice(0)) {
        job.signal.abort(error);
        job.reject(error);
      }
      if (runtime) closeRuntime(runtime, error);
    }

    return {
      runMediaFFmpeg,
      cancelMediaFFmpeg,
      downloadRuntimeAsset(url, type, onStatus, signal) {
        return runtimeDownloader(url, type, onStatus, signal);
      },
    };
  }

  const defaultEngine = createMediaFFmpegEngine();
  return {
    CORE_VERSION,
    CORE_ASSET_SOURCES,
    createMediaFFmpegEngine,
    downloadRuntimeAsset,
    mediaFFmpegWorker,
    runMediaFFmpeg: defaultEngine.runMediaFFmpeg,
    cancelMediaFFmpeg: defaultEngine.cancelMediaFFmpeg,
  };
    })({
        GM_xmlhttpRequest: details => GM_xmlhttpRequest(details),
        Worker: typeof Worker === 'function' ? Worker : undefined,
        Blob: typeof Blob === 'function' ? Blob : undefined,
        URL: typeof URL !== 'undefined' ? URL : undefined,
        setTimeout: (callback, delay) => setTimeout(callback, delay)
    });

    function createMediaProcessingProgress(inputs, args, notify) {
        const audioOnly = args.includes('-vn');
        const durations = inputs.filter(input => !audioOnly || input.role !== 'video').map(input => Number(input.duration)).filter(value => Number.isFinite(value) && value > 0);
        let duration = durations.length ? Math.max(...durations) : 0;
        let processed = 0, ratio = null, speed = 0, started = 0, active = false, lastMessage = '';
        function clock(seconds) {
            const value = Math.max(0, Math.floor(seconds));
            const hours = Math.floor(value / 3600);
            const minutes = Math.floor(value / 60) % 60;
            const parts = [String(minutes).padStart(2, '0'), String(value % 60).padStart(2, '0')];
            if (hours) parts.unshift(String(hours));
            return parts.join(':');
        }
        function parseTime(value) {
            const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
            return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
        }
        function show() {
            if (!active) return;
            const fraction = duration > 0 ? processed / duration : ratio;
            const parts = [fraction !== null ? `处理中 ${Math.max(0, Math.min(99, Math.floor(fraction * 100)))}%` : '处理中'];
            if (duration > 0) parts.push(`${clock(processed)} / ${clock(duration)}`);
            else if (processed > 0) parts.push(`已处理 ${clock(processed)}`);
            parts.push(`已耗时 ${clock((Date.now() - started) / 1000)}`);
            if (speed > 0) {
                parts.push(`${speed.toFixed(2)}x`);
                if (duration > processed) parts.push(`预计剩余 ${clock((duration - processed) / speed)}`);
            }
            const message = parts.join(' · ');
            if (message !== lastMessage) { lastMessage = message; notify(message); }
        }
        function start() {
            if (!active) { active = true; started = Date.now(); }
            show();
        }
        function onProgress(data) {
            if (!data) return;
            active = true;
            if (!started) started = Date.now();
            const time = Number(data.time);
            if (Number.isFinite(time) && time >= 0) processed = Math.max(processed, time / 1000000);
            const value = Number(data.progress);
            if (Number.isFinite(value) && value > 0 && value <= 1) ratio = Math.max(ratio || 0, value);
            show();
        }
        function onLog(line) {
            const text = String(line);
            const inputDuration = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(text);
            if (inputDuration && !durations.length) duration = Math.max(duration, parseTime(inputDuration[1]) || 0);
            const time = /(?:\btime=|^out_time=)\s*(\d+:\d+:\d+(?:\.\d+)?)/m.exec(text);
            const micros = /^out_time_(?:us|ms)=(\d+)/m.exec(text);
            if (time) processed = Math.max(processed, parseTime(time[1]) || 0);
            if (micros) processed = Math.max(processed, Number(micros[1]) / 1000000);
            const multiplier = /(?:\bspeed=)\s*([\d.]+)x/.exec(text);
            if (multiplier && Number(multiplier[1]) > 0) speed = Number(multiplier[1]);
            start();
        }
        // Worker 执行期间主线程仍可更新已耗时；不把等待/读取输入伪装成编码进度。
        const timer = typeof setInterval === 'function' ? setInterval(show, 1000) : null;
        return { start, onProgress, onLog, stop() { if (timer !== null) clearInterval(timer); } };
    }

    async function runMediaFFmpeg(inputs, args, report) {
        const logs = [];
        const unreliableTotals = new Set();
        const notify = text => { if (typeof report === 'function') report(text); };
        const processingProgress = createMediaProcessingProgress(inputs, args, notify);
        try {
            return await mediaFFmpegEngine.runMediaFFmpeg(inputs, args, event => {
                if (event.phase === 'runtime-source') notify('加载处理组件…首次约 31 MB');
                else if (event.phase === 'runtime-download') {
                    const amount = Number.isFinite(Number(event.loaded)) ? Math.max(0, Number(event.loaded)) : 0;
                    const total = Number(event.total);
                    // 压缩传输时 loaded 可能是解压后字节，total 却是压缩后长度。
                    // 同一资源一旦发现总量不可靠，后续只显示字节数，不冒充已完成。
                    if (event.lengthComputable === false || amount > total) unreliableTotals.add(event.url);
                    const canShowPercent = Number.isFinite(total) && total > 0 && !unreliableTotals.has(event.url);
                    notify(canShowPercent ? `加载处理组件 ${Math.floor(amount / total * 100)}%` : `加载处理组件 ${(amount / 1048576).toFixed(1)} MB`);
                } else if (event.phase === 'runtime-retry') notify('组件下载重试中…');
                else if (event.phase === 'runtime-source-error') notify('切换组件下载源…');
                else if (event.phase === 'runtime-ready') processingProgress.start();
                else if (event.phase === 'ffmpeg-progress') {
                    processingProgress.onProgress(event.data);
                } else if (event.phase === 'ffmpeg-log') {
                    const line = event.data && event.data.message;
                    if (line) {
                        logs.push(String(line)); if (logs.length > 6) logs.shift();
                        processingProgress.onLog(line);
                    }
                }
            });
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('媒体处理已取消。');
            const encodingError = /FFmpeg exited|empty output/i.test(error.message);
            const details = encodingError ? '\n' + logs.join('\n') : '';
            const cause = error.cause && error.cause.message ? '\n' + error.cause.message : '';
            throw new Error('媒体处理失败：' + error.message + cause + details + (encodingError ? '\ncopy 模式若不兼容输出格式，请改用匹配的编码器重编码。' : ''));
        } finally {
            processingProgress.stop();
        }
    }

    function cancelMediaFFmpeg() {
        mediaFFmpegEngine.cancelMediaFFmpeg();
    }
    // --- 浏览器媒体处理引擎结束 ---

    // --- 媒体处理命令 ---
    function buildMediaCommand(inputs, settings, outputBase = 'media') {
      const allowedFormats = new Set([
        'original', 'mp4', 'mkv', 'webm', 'mov', 'ts', 'm4a', 'mp3', 'aac', 'wav', 'flac', 'ogg',
      ]);
      const videoCodecs = new Set(['libx264', 'libx265', 'libvpx-vp9', 'mpeg4']);
      const audioCodecs = new Set(['aac', 'libmp3lame', 'libopus', 'flac', 'pcm_s16le', 'libvorbis']);
      const audioOnlyFormats = new Set(['m4a', 'mp3', 'aac', 'wav', 'flac', 'ogg']);
      const supportedExtensions = new Set([
        'mp4', 'mkv', 'webm', 'mov', 'ts', 'm4a', 'mp3', 'aac', 'wav', 'flac', 'ogg',
      ]);
      const muxers = {
        mp4: 'mp4', mkv: 'matroska', webm: 'webm', mov: 'mov', ts: 'mpegts',
        m4a: 'ipod', mp3: 'mp3', aac: 'adts', wav: 'wav', flac: 'flac', ogg: 'ogg',
      };
      const mimeTypes = {
        mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime',
        ts: 'video/mp2t', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac',
        wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
      };

      if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new TypeError('inputs must be a non-empty array');
      }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new TypeError('settings must be an object');
      }

      const requestedFormat = settings.format;
      if (!allowedFormats.has(requestedFormat)) {
        throw new RangeError(`unknown format: ${String(requestedFormat)}`);
      }
      for (const [key, mode] of [['videoMode', settings.videoMode], ['audioMode', settings.audioMode]]) {
        if (mode !== 'copy' && mode !== 'encode') {
          throw new RangeError(`unknown ${key}: ${String(mode)}`);
        }
      }
      if (!videoCodecs.has(settings.videoCodec)) {
        throw new RangeError(`unknown video encoder: ${String(settings.videoCodec)}`);
      }
      if (!audioCodecs.has(settings.audioCodec)) {
        throw new RangeError(`unknown audio encoder: ${String(settings.audioCodec)}`);
      }

      const normalizedInputs = inputs.map((input, index) => {
        if (!input || typeof input !== 'object') {
          throw new TypeError(`input ${index} must be an object`);
        }
        const role = input.role === undefined ? 'auto' : input.role;
        if (role !== 'auto' && role !== 'video' && role !== 'audio') {
          throw new RangeError(`unknown input role at index ${index}: ${String(role)}`);
        }
        if (input.name !== undefined && typeof input.name !== 'string') {
          throw new TypeError(`input ${index} name must be a string`);
        }
        return { role, name: input.name || '' };
      });

      const sourceExtension = (name) => {
        // name can be a local filename or URL. Only the extension is inspected; the
        // original value is never copied into args.
        let pathname = name;
        try {
          pathname = new URL(name).pathname;
        } catch (_) {
          pathname = String(name).split(/[?#]/, 1)[0];
        }
        const lastSegment = pathname.split(/[\\/]/).pop() || '';
        const dot = lastSegment.lastIndexOf('.');
        return dot >= 0 ? lastSegment.slice(dot + 1).toLowerCase() : '';
      };

      let format = requestedFormat;
      if (format === 'original') {
        if (normalizedInputs.length > 1) {
          format = 'mp4';
        } else {
          const extension = sourceExtension(normalizedInputs[0].name);
          format = supportedExtensions.has(extension) ? extension : 'mp4';
        }
      }

      const isAudioOnly = audioOnlyFormats.has(format);
      const hasVideo = !isAudioOnly && normalizedInputs.some((input) => input.role !== 'audio');
      const hasAudio = normalizedInputs.some((input) => input.role !== 'video');
      if (!hasAudio && isAudioOnly) {
        throw new RangeError(`format ${format} requires an audio input`);
      }

      // These are intentionally conservative re-encode compatibility checks. Copy
      // mode remains explicit and leaves source/container compatibility to FFmpeg.
      const compatibleVideo = {
        mp4: new Set(['libx264', 'libx265', 'mpeg4']),
        mov: new Set(['libx264', 'libx265', 'mpeg4']),
        mkv: videoCodecs,
        webm: new Set(['libvpx-vp9']),
        ts: new Set(['libx264', 'libx265', 'mpeg4']),
      };
      const compatibleAudio = {
        mp4: new Set(['aac', 'libmp3lame', 'libopus']),
        mov: new Set(['aac', 'libmp3lame', 'libopus', 'pcm_s16le']),
        mkv: audioCodecs,
        webm: new Set(['libopus', 'libvorbis']),
        ts: new Set(['aac', 'libmp3lame']),
        m4a: new Set(['aac', 'libmp3lame']),
        mp3: new Set(['libmp3lame']),
        aac: new Set(['aac']),
        wav: new Set(['pcm_s16le']),
        flac: new Set(['flac']),
        ogg: new Set(['libvorbis', 'libopus', 'flac']),
      };
      if (hasVideo && settings.videoMode === 'encode' && !compatibleVideo[format]?.has(settings.videoCodec)) {
        throw new RangeError(`video encoder ${settings.videoCodec} is incompatible with ${format}`);
      }
      if (hasAudio && settings.audioMode === 'encode' && !compatibleAudio[format]?.has(settings.audioCodec)) {
        throw new RangeError(`audio encoder ${settings.audioCodec} is incompatible with ${format}`);
      }

      const extensionForFormat = format === 'ts' ? 'ts' : format;
      const safeBase = (() => {
        let base = String(outputBase === undefined || outputBase === null ? 'media' : outputBase)
          .split(/[?#]/, 1)[0]
          .split(/[\\/]/)
          .pop()
          .replace(/\.(mp4|mkv|webm|mov|ts|m4a|mp3|aac|wav|flac|ogg)$/i, '');
        base = base
          .normalize('NFKD')
          .replace(/[^A-Za-z0-9._-]+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^[._-]+|[._-]+$/g, '');
        return base && base !== '.' && base !== '..' ? base : 'media';
      })();
      const outputName = `${safeBase}.${extensionForFormat}`;

      const args = ['-hide_banner', '-y', '-progress', 'pipe:1', '-stats_period', '0.5'];
      normalizedInputs.forEach((_, index) => {
        // Stable virtual names let the executor bind each selected File/Blob without
        // leaking user-provided paths or URLs into the FFmpeg command.
        args.push('-i', `input${index}`);
      });

      if (isAudioOnly) {
        normalizedInputs.forEach((input, index) => {
          if (input.role === 'audio') args.push('-map', `${index}:a:0`);
          else if (input.role === 'auto') args.push('-map', `${index}:a:0?`);
        });
        args.push('-vn');
      } else if (normalizedInputs.length === 1 && normalizedInputs[0].role === 'auto') {
        args.push('-map', '0:v:0?', '-map', '0:a:0?');
      } else {
        normalizedInputs.forEach((input, index) => {
          if (input.role === 'video') args.push('-map', `${index}:v:0`);
          else if (input.role === 'audio') args.push('-map', `${index}:a:0`);
          else {
            args.push('-map', `${index}:v:0?`, '-map', `${index}:a:0?`);
          }
        });
      }

      if (hasVideo) {
        if (settings.videoMode === 'copy') {
          args.push('-c:v', 'copy');
        } else {
          args.push('-c:v', settings.videoCodec);
          if (settings.videoCodec === 'libx264') {
            args.push('-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
          } else if (settings.videoCodec === 'libx265') {
            args.push('-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p');
          } else if (settings.videoCodec === 'libvpx-vp9') {
            args.push('-crf', '32', '-b:v', '0');
          } else if (settings.videoCodec === 'mpeg4') {
            args.push('-q:v', '5', '-pix_fmt', 'yuv420p');
          }
        }
      }
      if (hasAudio) {
        if (settings.audioMode === 'copy') {
          args.push('-c:a', 'copy');
        } else {
          args.push('-c:a', settings.audioCodec);
          if (settings.audioCodec === 'aac') args.push('-b:a', '192k');
          else if (settings.audioCodec === 'libmp3lame') args.push('-b:a', '192k');
          else if (settings.audioCodec === 'libopus') args.push('-b:a', '128k');
          else if (settings.audioCodec === 'libvorbis') args.push('-q:a', '5');
        }
      }

      args.push('-threads', '1');
      if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart');
      args.push('-f', muxers[format], outputName);
      return { args, outputName, mime: mimeTypes[format] };
    }

    // --- 媒体处理命令结束 ---

    // --- 媒体属性纯函数 ---
    /* Pure media metadata helpers. Safe to paste into a userscript IIFE. */
    function metadataFromHeaders(url, headers, status) {
      const result = {};
      const getHeader = makeHeaderGetter(headers);
      const contentType = getHeader('content-type');
      const parsedType = parseContentType(contentType);
      const pathname = String(url == null ? '' : url);
      const extension = mediaExtension(pathname);
      const hls = isHlsMime(parsedType.mime) || extension === 'm3u8';
      const mimeKind = kindFromMime(parsedType.mime);
      const extensionKind = kindFromExtension(extension);
      const kind = hls ? 'hls' : (mimeKind || extensionKind);

      if (kind) result.kind = kind;
      if (parsedType.mime) result.mime = parsedType.mime;
      if (parsedType.codecs) result.codecs = parsedType.codecs;

      const rangeTotal = parseContentRangeTotal(getHeader('content-range'));
      const responseStatus = statusCode(status);
      const length = parseUnsignedInteger(getHeader('content-length'));
      if (!hls && rangeTotal !== undefined) {
        result.size = rangeTotal;
      } else if (!hls && length !== undefined && responseStatus !== 206 &&
          (responseStatus === undefined || (responseStatus >= 200 && responseStatus < 300))) {
        result.size = length;
      }

      const duration = firstDuration(getHeader, [
        'content-duration', 'x-content-duration', 'x-video-duration', 'x-audio-duration', 'x-duration'
      ]);
      if (duration !== undefined) result.duration = duration;

      const width = firstUnsigned(getHeader, ['x-video-width', 'video-width', 'x-frame-width']);
      const height = firstUnsigned(getHeader, ['x-video-height', 'video-height', 'x-frame-height']);
      if (width !== undefined) result.width = width;
      if (height !== undefined) result.height = height;
      const resolution = firstHeader(getHeader, ['x-video-resolution', 'video-resolution', 'x-resolution']);
      if (resolution) {
        const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(resolution);
        if (match) {
          if (result.width === undefined) result.width = safePositiveInteger(match[1]);
          if (result.height === undefined) result.height = safePositiveInteger(match[2]);
        }
      }

      const bitrate = firstUnsigned(getHeader, ['x-bitrate', 'content-bitrate', 'x-audio-bitrate', 'x-video-bitrate']);
      if (bitrate !== undefined) result.bitrate = bitrate;
      else {
        const icyKbps = parseUnsignedInteger(getHeader('icy-br'));
        if (icyKbps !== undefined && icyKbps <= Number.MAX_SAFE_INTEGER / 1000) result.bitrate = icyKbps * 1000;
      }

      const frameRate = firstRate(getHeader, ['x-frame-rate', 'video-frame-rate', 'x-video-frame-rate']);
      if (frameRate !== undefined) result.frameRate = frameRate;

      const sampleRate = firstUnsigned(getHeader, ['x-audio-sample-rate', 'audio-samplerate', 'x-sample-rate', 'sample-rate']);
      if (sampleRate !== undefined) result.sampleRate = sampleRate;
      const channels = firstHeader(getHeader, ['x-audio-channels', 'audio-channels', 'x-channels', 'channels']);
      if (channels && /^[\w.+ -]{1,32}$/.test(channels)) result.channels = channels;

      const liveValue = firstHeader(getHeader, ['x-stream-live', 'x-live', 'content-live']);
      if (isTruthyFlag(liveValue) || getHeader('icy-metaint') !== undefined) result.live = true;
      else if (isFalseFlag(liveValue)) result.live = false;

      if (result.size === undefined && result.duration !== undefined && result.bitrate !== undefined) {
        const estimated = result.duration * result.bitrate / 8;
        if (Number.isFinite(estimated) && estimated >= 0 && estimated <= Number.MAX_SAFE_INTEGER) {
          result.estimatedSize = Math.round(estimated);
        }
      }

      return result;
    }

    function metadataFromAudioPrefix(bytes) {
      const data = asByteView(bytes);
      if (!data || data.byteLength < 4) return {};
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const ascii = (offset, length) => {
        let out = '';
        for (let i = 0; i < length && offset + i < data.byteLength; i++) out += String.fromCharCode(data[offset + i]);
        return out;
      };

      if (data.byteLength >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') {
        let offset = 12;
        while (offset + 8 <= data.byteLength) {
          const chunkId = ascii(offset, 4);
          const chunkSize = view.getUint32(offset + 4, true);
          const body = offset + 8;
          if (chunkId === 'fmt ') {
            if (chunkSize < 16 || body + 16 > data.byteLength) return {};
            const formatTag = view.getUint16(body, true);
            const channels = view.getUint16(body + 2, true);
            const sampleRate = view.getUint32(body + 4, true);
            const byteRate = view.getUint32(body + 8, true);
            if (!channels || !sampleRate || !byteRate) return {};
            const result = {
              kind: 'audio',
              mime: 'audio/wav',
              channels: String(channels),
              sampleRate,
              bitrate: byteRate * 8
            };
            if (formatTag === 1) result.codecs = 'PCM';
            else if (formatTag === 3) result.codecs = 'IEEE Float';
            else if (formatTag === 0xfffe && chunkSize >= 40 && body + 40 <= data.byteLength) {
              const subFormat = view.getUint16(body + 24, true);
              if (subFormat === 1) result.codecs = 'PCM';
              else if (subFormat === 3) result.codecs = 'IEEE Float';
            }
            return result;
          }
          const next = body + chunkSize + (chunkSize & 1);
          if (!Number.isSafeInteger(next) || next <= offset || next > data.byteLength) return {};
          offset = next;
        }
        return {};
      }

      // ADTS fixed header. Require the full 7-byte header (9 bytes when CRC follows).
      if (data.byteLength < 7 || data[0] !== 0xff || (data[1] & 0xf6) !== 0xf0) return {};
      const protectionAbsent = data[1] & 1;
      const headerLength = protectionAbsent ? 7 : 9;
      if (data.byteLength < headerLength) return {};
      const sampleIndex = (data[2] >> 2) & 0x0f;
      const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const sampleRate = sampleRates[sampleIndex];
      if (!sampleRate) return {};
      const frameLength = ((data[3] & 3) << 11) | (data[4] << 3) | ((data[5] >> 5) & 7);
      if (frameLength < headerLength) return {};
      const channelConfig = ((data[2] & 1) << 2) | ((data[3] >> 6) & 3);
      const result = { kind: 'audio', mime: 'audio/aac', sampleRate };
      // ADTS profile is the MPEG-4 Audio Object Type minus one.
      const profileNames = ['AAC Main', 'AAC-LC', 'AAC SSR', 'AAC LTP'];
      result.codecs = profileNames[(data[2] >> 6) & 3];
      const channelCounts = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 8 };
      if (channelCounts[channelConfig] !== undefined) result.channels = String(channelCounts[channelConfig]);
      return result;
    }

    function formatMediaMetadata(info) {
      if (!info || typeof info !== 'object') return '';
      const parts = [];
      const kindNames = { video: '视频', audio: '音频', hls: 'HLS' };
      if (info.hls && info.kind !== 'hls') parts.push('HLS');
      if (info.kind) parts.push(kindNames[info.kind] || String(info.kind));
      if (info.mime) parts.push(String(info.mime));
      if (isNonnegativeFinite(info.size)) parts.push('大小 ' + formatBytes(info.size));
      else if (isNonnegativeFinite(info.estimatedSize)) parts.push('估算大小 ' + formatBytes(info.estimatedSize));
      if (isNonnegativeFinite(info.duration)) {
        const label = info.live ? '当前清单时长 ' : '时长 ';
        parts.push(label + formatDuration(info.duration));
      }
      if (isPositiveFinite(info.width) && isPositiveFinite(info.height)) parts.push('分辨率 ' + info.width + '×' + info.height);
      if (isPositiveFinite(info.bitrate)) parts.push('码率 ' + formatRate(info.bitrate) + ' bit/s');
      if (info.codecs) parts.push('编码 ' + String(info.codecs));
      if (isPositiveFinite(info.frameRate)) parts.push('帧率 ' + trimDecimal(info.frameRate) + ' fps');
      if (isPositiveFinite(info.sampleRate)) parts.push('采样率 ' + formatRate(info.sampleRate) + ' Hz');
      if (info.channels !== undefined && info.channels !== null && String(info.channels).trim()) parts.push('声道 ' + String(info.channels).trim());
      if (info.live && info.duration === undefined) parts.push('直播');
      return parts.join(' · ');
    }

    function makeHeaderGetter(headers) {
      if (headers && typeof headers.get === 'function') {
        return (name) => {
          const value = headers.get(name);
          return value == null ? undefined : String(value).trim();
        };
      }
      const map = Object.create(null);
      if (typeof headers === 'string') {
        for (const line of headers.split(/\r?\n/)) {
          const colon = line.indexOf(':');
          if (colon <= 0) continue;
          const name = line.slice(0, colon).trim().toLowerCase();
          const value = line.slice(colon + 1).trim();
          if (name && map[name] === undefined) map[name] = value;
        }
      } else if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
          map[key.toLowerCase()] = Array.isArray(headers[key]) ? headers[key].join(', ') : String(headers[key]);
        }
      }
      return (name) => map[String(name).toLowerCase()];
    }

    function parseContentType(value) {
      if (!value) return { mime: '', codecs: '' };
      const parts = splitSemicolonParameters(String(value));
      const mime = (parts.shift() || '').trim().toLowerCase();
      const validMime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : '';
      let codecs = '';
      for (const item of parts) {
        const match = /^\s*codecs\s*=\s*(.*?)\s*$/i.exec(item);
        if (!match) continue;
        codecs = unquote(match[1]).trim();
        break;
      }
      return { mime: validMime, codecs };
    }

    function splitSemicolonParameters(value) {
      const parts = [];
      let start = 0;
      let quoted = false;
      let escaped = false;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && quoted) { escaped = true; continue; }
        if (ch === '"') quoted = !quoted;
        else if (ch === ';' && !quoted) { parts.push(value.slice(start, i)); start = i + 1; }
      }
      parts.push(value.slice(start));
      return parts;
    }

    function unquote(value) {
      if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
        return value.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      return value;
    }

    function mediaExtension(url) {
      const match = /(?:^|\/|\\)([^/?#\\]+)\.(m3u8|mp4|m4v|mov|mkv|webm|avi|ts|mp3|wav|wave|aac|m4a|flac|ogg|oga|opus|wma)(?:$|[?#])/i.exec(String(url || ''));
      return match ? match[2].toLowerCase() : '';
    }

    function kindFromMime(mime) {
      if (isHlsMime(mime)) return 'hls';
      if (mime.indexOf('video/') === 0) return 'video';
      if (mime.indexOf('audio/') === 0) return 'audio';
      return '';
    }

    function isHlsMime(mime) {
      return /^(application|audio)\/(vnd\.apple\.mpegurl|x-mpegurl|mpegurl)$/.test(mime);
    }

    function kindFromExtension(extension) {
      if (extension === 'm3u8') return 'hls';
      if (['mp3', 'wav', 'wave', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus', 'wma'].includes(extension)) return 'audio';
      if (['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ts'].includes(extension)) return 'video';
      return '';
    }

    function parseContentRangeTotal(value) {
      if (!value) return undefined;
      const match = /^\s*bytes\s+(?:\d+-\d+|\*)\/(\d+)\s*$/i.exec(value);
      return match ? parseUnsignedInteger(match[1]) : undefined;
    }

    function statusCode(status) {
      const candidate = status && typeof status === 'object' ? status.status : status;
      const parsed = parseUnsignedInteger(candidate);
      return parsed;
    }

    function parseUnsignedInteger(value) {
      if (value === undefined || value === null) return undefined;
      const text = String(value).trim();
      if (!/^\d+$/.test(text)) return undefined;
      const number = Number(text);
      return Number.isSafeInteger(number) ? number : undefined;
    }

    function safePositiveInteger(value) {
      const number = parseUnsignedInteger(value);
      return number > 0 ? number : undefined;
    }

    function firstUnsigned(getHeader, names) {
      for (const name of names) {
        const number = safePositiveInteger(getHeader(name));
        if (number !== undefined) return number;
      }
      return undefined;
    }

    function firstHeader(getHeader, names) {
      for (const name of names) {
        const value = getHeader(name);
        if (value !== undefined && value !== '') return String(value).trim();
      }
      return '';
    }

    function firstDuration(getHeader, names) {
      for (const name of names) {
        const parsed = parseDuration(getHeader(name));
        if (parsed !== undefined) return parsed;
      }
      return undefined;
    }

    function parseDuration(value) {
      if (value === undefined || value === null) return undefined;
      const text = String(value).trim();
      if (/^\d+(?:\.\d+)?$/.test(text)) {
        const number = Number(text);
        return Number.isFinite(number) ? number : undefined;
      }
      const match = /^(?:(\d+):)?([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/.exec(text);
      if (!match) return undefined;
      const hours = Number(match[1] || 0);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const total = hours * 3600 + minutes * 60 + seconds;
      return Number.isFinite(total) ? total : undefined;
    }

    function firstRate(getHeader, names) {
      for (const name of names) {
        const value = getHeader(name);
        const number = parseRate(value);
        if (number !== undefined) return number;
      }
      return undefined;
    }

    function parseRate(value) {
      if (value === undefined || value === null) return undefined;
      const text = String(value).trim();
      let number;
      const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
      if (fraction) {
        const denominator = Number(fraction[2]);
        if (!denominator) return undefined;
        number = Number(fraction[1]) / denominator;
      } else if (/^\d+(?:\.\d+)?$/.test(text)) number = Number(text);
      else return undefined;
      return Number.isFinite(number) && number > 0 ? number : undefined;
    }

    function isTruthyFlag(value) {
      return value !== undefined && /^(1|true|yes|live|event)$/i.test(String(value).trim());
    }

    function isFalseFlag(value) {
      return value !== undefined && /^(0|false|no|vod|ended)$/i.test(String(value).trim());
    }

    function asByteView(bytes) {
      if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
      if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (Array.isArray(bytes)) return Uint8Array.from(bytes);
      return null;
    }

    function formatBytes(size) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = Number(size);
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
      return (unit === 0 ? String(Math.round(value)) : trimDecimal(value)) + ' ' + units[unit];
    }

    function formatDuration(seconds) {
      const whole = Math.floor(seconds);
      const hours = Math.floor(whole / 3600);
      const minutes = Math.floor((whole % 3600) / 60);
      const remainder = whole % 60;
      const pad = (value) => String(value).padStart(2, '0');
      return hours ? hours + ':' + pad(minutes) + ':' + pad(remainder) : pad(minutes) + ':' + pad(remainder);
    }

    function formatRate(value) {
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    function trimDecimal(value) {
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    function isNonnegativeFinite(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    }

    function isPositiveFinite(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0;
    }

    // --- 媒体属性纯函数结束 ---

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
                            if (res.status >= 200 && res.status < 300) {
                                updateResourceMetadata(url, metadataFromHeaders(url, res.responseHeaders, res.status), referer);
                                resolve(res);
                            }
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
        const text = response.responseText || response.response || '';
        registerPlaylistResources(text, base, referer);
        const playlist = parsePlaylist(text, base);
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
        return { blob: new Blob(init ? [init, ...chunks] : chunks, { type }), extension, duration: (mediaInfo.get(playlist.url) || {}).duration };
    }

    async function handleM3u8Download(m3u8Url, btnElement) {
        return downloadMediaResource(m3u8Url, btnElement);
    }

})();
