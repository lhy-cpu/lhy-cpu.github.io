/* Local relay instructions. Downloaded source is displayed as text and never evaluated. */
(function (root) {
  'use strict';
  const MAX_SOURCE = 65536;
  function detectOS(nav) {
    const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
    if (/android|iphone|ipad|ipod/i.test(nav.userAgent || '') || (/Mac/i.test(platform) && nav.maxTouchPoints > 1)) return 'other';
    if (/win/i.test(platform)) return 'windows';
    if (/mac/i.test(platform)) return 'macos';
    if (/linux/i.test(platform)) return 'linux';
    return 'other';
  }
  function originValue(value) {
    if (value === 'null') return value;
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !/^https?:\/\/[a-zA-Z0-9.:[\]-]+$/.test(value) || url.origin !== value || url.username || url.password) throw Error('网页来源必须是完整的 HTTP/HTTPS origin，或 null。');
    return url.origin;
  }
  function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
  function commands(os, origin, source) {
    origin = originValue(origin);
    const q = quote(origin);
    return {
      primary: os === 'windows' ? 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\server.ps1 --origin ' + q : 'node ./server.cjs --origin ' + q,
      python: (os === 'windows' ? 'py -3' : 'python3') + ' ./server.py --origin ' + q,
      paste: source === undefined ? '' : os === 'windows' ? "@'\n" + source + "\n'@ | py -3 - --origin " + q : 'python3 - --origin ' + q + " <<'FLOWSKETCH_RELAY_PY'\n" + source + '\nFLOWSKETCH_RELAY_PY'
    };
  }
  function validateSource(source) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE || !source.startsWith('#!/usr/bin/env python3\n') || source.includes('\0') || source.split(/\r?\n/).some(line => line === 'FLOWSKETCH_RELAY_PY' || line === "'@")) throw Error('Python 源码格式或大小不符合预期。');
    return source;
  }
  function sourceLoader(fetcher, base) {
    let cached, pending;
    return function () {
      if (cached !== undefined) return Promise.resolve(cached);
      if (pending) return pending;
      const url = new URL('tools/local-relay/server.py', base);
      if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(base).origin) return Promise.reject(Error('当前页面无法读取源码，请直接下载 Python 服务。'));
      pending = (async () => {
        const response = await fetcher(url.href, { credentials: 'omit', redirect: 'error', mode: 'same-origin' });
        if (!response.ok) throw Error('无法读取 Python 源码。');
        if (Number(response.headers?.get('content-length')) > MAX_SOURCE) throw Error('Python 源码过大。');
        let source = '';
        if (response.body?.getReader) {
          const reader = response.body.getReader(), decoder = new TextDecoder();
          let bytes = 0;
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > MAX_SOURCE) throw Error('Python 源码过大。');
              source += decoder.decode(part.value, { stream: true });
            }
            source += decoder.decode();
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        } else source = await response.text();
        cached = validateSource(source);
        return cached;
      })().finally(() => { pending = undefined; });
      return pending;
    };
  }
  let loadSource, activeCleanup;
  function open(options) {
    const doc = root.document;
    const origin = originValue(options.origin ?? root.location.origin);
    activeCleanup?.(false);
    const previous = doc.activeElement;
    options.show('本地转发下载与使用帮助', `<article class="help-doc relay-help"><header class="help-intro"><strong>让浏览器通过本机访问 AI 服务</strong><span>按系统选择一个独立服务文件，在终端运行后回到 AI 设置填写连接信息。</span></header><section class="help-section"><div class="relay-os-tabs" role="tablist" aria-label="操作系统"><button class="btn" role="tab" id="relay-tab-windows" data-os="windows">Windows</button><button class="btn" role="tab" id="relay-tab-macos" data-os="macos">macOS</button><button class="btn" role="tab" id="relay-tab-linux" data-os="linux">Linux</button></div><p id="relay-os-note"></p><div role="tabpanel" id="relay-os-panel"><h4 id="relay-recommendation"></h4><ol class="help-steps"><li><a class="btn primary" id="relay-download" download>下载独立服务文件</a><p id="relay-runtime"></p></li><li>在下载文件所在目录打开终端，运行：<pre class="relay-command"><code id="relay-command"></code></pre></li><li>启动后会自动生成随机 Token，无需输入密码。保持终端打开，把 Token 粘贴到 AI 设置一次；停止服务时按 Ctrl+C。</li></ol></div></section><section class="help-section"><h4>Python 备用方案</h4><p>已安装 Python 3 时可直接使用，无需额外依赖。</p><a class="btn" href="tools/local-relay/server.py" download>下载 server.py</a><pre class="relay-command"><code id="relay-python-command"></code></pre><details id="relay-paste-details"><summary>Python 直接粘贴运行 · 无需下载文件</summary><p>展开后可审阅完整源码，再手动复制到终端运行。不会在浏览器执行源码。</p><textarea id="relay-paste-source" readonly spellcheck="false" aria-label="完整 Python 源码与运行命令"></textarea><div class="relay-copy-row"><button class="btn" id="relay-copy" disabled>复制完整命令</button><button class="btn" id="relay-retry" hidden>重试读取源码</button><span id="relay-source-status" role="status" aria-live="polite"></span></div></details></section><section class="help-section"><h4>回到 AI 设置</h4><p>本地服务地址填写终端显示的本机地址（通常为 http://127.0.0.1:18765），连接口令（Token） 填写终端生成的值。API URL 继续填写 AI 服务商地址，API Key 继续填写服务商密钥。</p><div class="help-note">从 HTTPS 网页连接本机时，浏览器可能询问“本地网络访问”权限，请允许当前网页访问本机。若连接失败，确认终端仍在运行且允许的网页来源与当前页面一致。</div></section></article>`, '<button class="btn primary" id="relay-close">关闭</button>');
    const backdrop = doc.getElementById('modal'), modal = backdrop.querySelector('.modal');
    modal.classList.add('help-modal', 'relay-help-modal');
    const saved = new Map(['role', 'aria-modal', 'aria-labelledby', 'tabindex'].map(key => [key, modal.getAttribute(key)]));
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'modalTitle'); modal.setAttribute('tabindex', '-1');
    const get = id => doc.getElementById(id);
    let alive = true, source, os = detectOS(root.navigator), request = 0;
    const unknown = os === 'other';
    if (unknown) os = 'linux';
    function render() {
      for (const button of modal.querySelectorAll('[data-os]')) { const selected = button.dataset.os === os; button.setAttribute('aria-selected', String(selected)); button.setAttribute('aria-controls', 'relay-os-panel'); button.tabIndex = selected ? 0 : -1; }
      get('relay-os-panel').setAttribute('aria-labelledby', 'relay-tab-' + os);
      get('relay-os-note').textContent = unknown ? '未识别到桌面系统，请选择运行转发服务的电脑系统。' : '已按当前系统选择；也可手动切换。';
      const windows = os === 'windows', cmd = commands(os, origin, source);
      get('relay-recommendation').textContent = windows ? '推荐：Windows PowerShell 原生服务' : '推荐：Node.js 独立服务';
      get('relay-runtime').textContent = windows ? '使用 Windows 自带 PowerShell，无需安装 Node.js。' : '适合已安装 Node.js 的电脑；没有 Node.js 可使用下方 Python 方案。';
      get('relay-download').href = windows ? 'tools/local-relay/server.ps1' : 'tools/local-relay/server.cjs';
      get('relay-download').textContent = windows ? '下载 server.ps1' : '下载 server.cjs';
      get('relay-command').textContent = cmd.primary;
      get('relay-python-command').textContent = cmd.python;
      get('relay-paste-source').value = cmd.paste;
    }
    async function load() {
      const ticket = ++request;
      get('relay-source-status').textContent = '正在读取本站 Python 源码…';
      get('relay-retry').hidden = true;
      try {
        loadSource ||= sourceLoader(root.fetch.bind(root), root.location.href);
        const text = await loadSource();
        if (!alive || ticket !== request) return;
        source = text; render(); get('relay-copy').disabled = false;
        get('relay-source-status').textContent = '完整源码已就绪，可审阅后复制。';
      } catch (_) {
        if (!alive || ticket !== request) return;
        get('relay-source-status').textContent = '源码读取失败，可重试或直接下载上方 server.py。';
        get('relay-retry').hidden = false;
      }
    }
    for (const button of modal.querySelectorAll('[data-os]')) {
      button.onclick = () => { os = button.dataset.os; render(); if (source !== undefined) get('relay-source-status').textContent = '运行文本已按所选系统更新，请重新复制。'; };
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const list = ['windows', 'macos', 'linux'];
        os = event.key === 'Home' ? list[0] : event.key === 'End' ? list[2] : list[(list.indexOf(os) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
        render(); get('relay-tab-' + os).focus();
        if (source !== undefined) get('relay-source-status').textContent = '运行文本已按所选系统更新，请重新复制。';
      };
    }
    get('relay-paste-details').ontoggle = () => { if (get('relay-paste-details').open && source === undefined) load(); };
    get('relay-retry').onclick = load;
    get('relay-copy').onclick = async () => {
      const area = get('relay-paste-source'), text = area.value;
      try {
        if (!root.navigator.clipboard?.writeText) throw Error('clipboard unavailable');
        await root.navigator.clipboard.writeText(text);
        if (alive) get('relay-source-status').textContent = area.value === text ? '已复制完整命令。' : '系统已切换，请重新复制当前命令。';
      } catch (_) {
        if (!alive) return;
        area.focus(); area.select(); get('relay-source-status').textContent = '请按 Ctrl+C（macOS 为 ⌘C）复制选中的完整命令。';
      }
    };
    function trap(event) {
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href], textarea, summary, [tabindex="0"]')].filter(el => el.getClientRects().length && el.tabIndex >= 0);
      if (!focusable.length) { event.preventDefault(); modal.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (doc.activeElement === first || !modal.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || !modal.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
    }
    const observer = new root.MutationObserver(() => { if (!backdrop.classList.contains('show') || !modal.classList.contains('relay-help-modal') || !get('relay-close')) cleanup(!backdrop.classList.contains('show')); });
    function cleanup(restore) {
      if (!alive) return;
      alive = false; observer.disconnect(); modal.removeEventListener('keydown', trap); modal.classList.remove('relay-help-modal');
      for (const [key, value] of saved) { if (value === null) modal.removeAttribute(key); else modal.setAttribute(key, value); }
      activeCleanup = undefined;
      if (restore && previous?.isConnected) previous.focus();
    }
    activeCleanup = cleanup;
    get('relay-close').onclick = () => { options.close(); cleanup(true); };
    observer.observe(backdrop, { attributes: true, childList: true, subtree: true });
    modal.addEventListener('keydown', trap);
    render(); get('relay-tab-' + os).focus();
  }
  const api = { open };
  root.FlowSketchAIRelayHelp = api;
  if (typeof module === 'object' && module.exports) module.exports = { ...api, detectOS, originValue, commands, validateSource, sourceLoader };
})(typeof window !== 'undefined' ? window : globalThis);
