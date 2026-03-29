// ==UserScript==
// @name         AutoGetMedia
// @namespace    https://lhy-cpu.github.io
// @version      0.1.1
// @description  拦截网络请求，并筛选出其中的媒体文件（视频、音频等），类似控制台的网络面板功能。(Beta)
// @author       lhy-cpu
// @match        *://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_log
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect *
// @run-at       document-start
// @updateURL    https://lhy-cpu.github.io/Tampermonkey/AutoGetMedia.user.js
// @downloadURL  https://lhy-cpu.github.io/Tampermonkey/AutoGetMedia.user.js
// @homepage     https://lhy-cpu.github.io/Tampermonkey/index.html
// ==/UserScript==

(function() {
    'use strict';

    // 存储抓取到的媒体链接
    const mediaUrls = new Set();

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

    /**
     * 检查并记录媒体 URL
     * @param {string} url - 需要检查的网址
     * @returns {boolean} 如果开启了阻断且匹配为媒体资源，则返回 true
     */
    function checkUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (url.startsWith('chrome-extension://')) return false; // 忽略扩展程序请求
        
        const isNew = !mediaUrls.has(url);

        // 去掉查询参数及哈希部分，只保留 path 以匹配后缀名
        const urlWithoutQuery = url.split('?')[0].split('#')[0];

        // 根据 URL 后缀或特征判断是否为媒体文件
        if (mediaExtensions.test(urlWithoutQuery)) {
            if (isNew) {
                mediaUrls.add(url);
                console.log('%c[AutoGetMedia] 抓取到媒体资源: ' + url, 'color: #00ff00; font-weight: bold; background: #333; padding: 2px 4px; border-radius: 3px;');
                if (window.top === window.self) {
                    if (typeof updateUI === 'function') updateUI(url);
                } else {
                    // 如果在 iframe 中，将链接发送给顶层主页面
                    window.top.postMessage({ type: 'AutoGetMedia_NEW_URL', url: url }, '*');
                }
            }
            return isBlockEnabled(); // 如果开启了阻断则返回 true 给拦截器
        }
        return false;
    }

    /**
     * 1. 拦截 Fetch API
     */
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            const request = args[0];
            const url = typeof request === 'string' ? request : (request && request.url);
            if (checkUrl(url)) {
                console.warn('%c[AutoGetMedia] ⚡ 已阻断 Fetch 请求: ' + url, 'color: #ff5252; background: #333; font-weight: bold; padding: 2px 4px;');
                return Promise.reject(new Error('Blocked by AutoGetMedia (Fetch)'));
            }
        } catch (e) {
            console.error('[AutoGetMedia] Fetch拦截报错', e);
        }
        return originalFetch.apply(this, args);
    };

    /**
     * 2. 拦截 XMLHttpRequest (Ajax)
     */
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        try {
            this._agmUrl = url;
            if (checkUrl(url)) {
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
        observer.observe({ entryTypes: ['resource'] });
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
                const url = event.data.url;
                if (!mediaUrls.has(url)) {
                    mediaUrls.add(url);
                    if (typeof updateUI === 'function') updateUI(url);
                }
            }
        });
    }

    // --- UI 渲染及交互逻辑 ---
    let agmContainer = null;
    let agmList = null;
    let agmCount = null;

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
        downloadBtn.innerText = '下载资源';
        downloadBtn.style.cssText = 'border: 1px solid #1a73e8 !important; background: #e8f0fe !important; border-radius: 3px !important; cursor: pointer !important; padding: 2px 6px !important; font-size: 11px !important; color: #1a73e8 !important;';
        downloadBtn.onclick = async (e) => {
            e.preventDefault();
            const originalText = downloadBtn.innerText;
            downloadBtn.disabled = true;
            try {
                const urlWithoutQuery = url.split('?')[0].split('#')[0];
                // 如果是 m3u8 则特殊处理，解析并合并分片
                if (urlWithoutQuery.toLowerCase().endsWith('.m3u8')) {
                    await handleM3u8Download(url, downloadBtn);
                    downloadBtn.innerText = '合并成功!';
                } else {
                    downloadBtn.innerText = '下载中...';
                    // 常规文件：使用 GM_xmlhttpRequest 绕过 CORS 跨域限制
                    const blob = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: url,
                            headers: {
                                'Referer': window.location.href,    // 强制设置防盗链 Referer 为当前页面
                                'Origin': window.location.origin,   // 强制设置 Origin
                                'Cookie': document.cookie           // 尝试携带当前页面的 Cookie
                            },
                            responseType: 'blob', // 关键：指定返回二进制数据
                            onload: (res) => {
                                if (res.status >= 200 && res.status < 300) {
                                    resolve(res.response);
                                } else {
                                    reject(new Error('请求失败，状态码: ' + res.status));
                                }
                            },
                            onerror: (err) => reject(new Error('网络请求出错：' + err)),
                            ontimeout: () => reject(new Error('请求超时'))
                        });
                    });
                    
                    const blobUrl = URL.createObjectURL(blob);
                    
                    // 借助 a 标签触发文件下载
                    const aDownload = document.createElement('a');
                    aDownload.style.display = 'none';
                    aDownload.href = blobUrl;
                    
                    // 从 URL 解析文件名
                    let fileName = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
                    if (!fileName || !fileName.includes('.')) {
                        fileName = 'media_download_' + Date.now();
                    }
                    aDownload.download = fileName;
                    
                    document.body.appendChild(aDownload);
                    aDownload.click();
                    
                    // 清理
                    document.body.removeChild(aDownload);
                    URL.revokeObjectURL(blobUrl);
                    downloadBtn.innerText = '成功!';
                }
            } catch (err) {
                console.error('[AutoGetMedia] 下载出错:', err);
                downloadBtn.innerText = '失败(看控制台)';
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
        agmList.prepend(li); // 将最新的URL加在顶部
    }

    // 全局调用：每当收到新的 URL 时调用
    window.updateUI = function(url) {
        if (agmCount) {
            agmCount.innerText = mediaUrls.size;
        }
        renderUrlItem(url);
    };

    /**
     * 解析并下载 m3u8，处理其包含的 ts 分片并合并为整段视频下载
     */
    async function handleM3u8Download(m3u8Url, btnElement) {
        btnElement.innerText = '解析m3u8...';
        
        // 1. 获取 m3u8 内容
        const m3u8Text = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: m3u8Url,
                headers: {
                    'Referer': window.location.href,
                    'Origin': window.location.origin,
                    'Cookie': document.cookie
                },
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                    else reject(new Error('获取 m3u8 失败: ' + res.status));
                },
                onerror: (err) => reject(new Error('网络请求出错: ' + err)),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });

        const lines = m3u8Text.split('\n').map(l => l.trim()).filter(l => l);
        
        // 判断是否为套娃 m3u8 (Master Playlist，通常包含 #EXT-X-STREAM-INF)
        if (lines.some(l => l.includes('#EXT-X-STREAM-INF'))) {
            // 简单取最后一个码率的 m3u8 链接进一步解析
            const subM3u8s = lines.filter(l => !l.startsWith('#'));
            if (subM3u8s.length > 0) {
                const subUrl = new URL(subM3u8s[subM3u8s.length - 1], m3u8Url).href;
                btnElement.innerText = '拉取子m3u8...';
                return handleM3u8Download(subUrl, btnElement); // 递归解析子 m3u8
            } else {
                throw new Error('未找到有效的子播放列表');
            }
        }

        // 解析当前列表中的分片 URL (通常是 .ts，也可能是其他格式)
        const segmentUrls = lines.filter(l => !l.startsWith('#')).map(sub => new URL(sub, m3u8Url).href);
        if (segmentUrls.length === 0) throw new Error('未在 m3u8 中找到任何媒体分片');

        const total = segmentUrls.length;
        const chunks = new Array(total);
        let downloaded = 0;
        const maxConcurrent = 5; // 控制并发数为 5，避免对服务器并发压力过大
        
        async function downloadChunk(chunkUrl, index) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: chunkUrl,
                    responseType: 'arraybuffer',
                    headers: {
                        'Referer': window.location.href,
                        'Origin': window.location.origin,
                        'Cookie': document.cookie
                    },
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            chunks[index] = res.response;
                            downloaded++;
                            // 动态更新按钮文字，显示下载进度
                            btnElement.innerText = `下载中 (${downloaded}/${total})`;
                            resolve();
                        } else {
                            reject(new Error('分片下载失败，状态码: ' + res.status));
                        }
                    },
                    onerror: (err) => reject(new Error('分片请求出错: ' + err)),
                    ontimeout: () => reject(new Error('分片请求超时'))
                });
            });
        }

        // 2. 控制并发下载所有分片
        for (let i = 0; i < total; i += maxConcurrent) {
            const batch = [];
            for (let j = 0; j < maxConcurrent && i + j < total; j++) {
                batch.push(downloadChunk(segmentUrls[i + j], i + j));
            }
            await Promise.all(batch);
        }

        btnElement.innerText = '合并分片...';

        // 3. 将所有下载的 ArrayBuffer 分片合并成一个视频 Blob
        const blob = new Blob(chunks, { type: 'video/mp2t' });
        
        let fileName = m3u8Url.substring(m3u8Url.lastIndexOf('/') + 1).split('?')[0];
        // 替换后缀名，将 m3u8 自动改成 ts 视频格式输出
        fileName = fileName.replace('.m3u8', '.ts');
        if (!fileName || fileName === '.ts') {
            fileName = 'video_merged_' + Date.now() + '.ts';
        }
        
        // 4. 执行浏览器本地下载
        const blobUrl = URL.createObjectURL(blob);
        const aDownload = document.createElement('a');
        aDownload.style.display = 'none';
        aDownload.href = blobUrl;
        aDownload.download = fileName;
        document.body.appendChild(aDownload);
        aDownload.click();
        
        document.body.removeChild(aDownload);
        URL.revokeObjectURL(blobUrl);
    }

})();
