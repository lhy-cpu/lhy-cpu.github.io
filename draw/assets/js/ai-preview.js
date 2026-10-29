(function (root) {
  'use strict';

  const bound = new WeakMap();
  let dialog, picture, viewport, sizeButton, closeButton, origin;
  let mode = 0;
  let previousOverflow = '';
  let cropButton, cropPanel, sendButton, resetButton, selection, status, fields;
  let context = null, generation = 0, cropping = false, busy = false, region = null, drag = null;

  function permitted() {
    try { return !!context && typeof context.onCrop === 'function' && typeof context.canCrop === 'function' && context.canCrop() === true; }
    catch (_) { return false; }
  }

  function dimensions() { return { width: picture.naturalWidth, height: picture.naturalHeight }; }

  function normalize(value) {
    const { width, height } = dimensions();
    const number = (n, fallback) => Number.isFinite(Number(n)) ? Math.round(Number(n)) : fallback;
    const x = Math.max(0, Math.min(width - 1, number(value.x, 0)));
    const y = Math.max(0, Math.min(height - 1, number(value.y, 0)));
    return { x, y, w: Math.max(1, Math.min(width - x, number(value.w, width))), h: Math.max(1, Math.min(height - y, number(value.h, height))) };
  }

  function renderRegion(updateFields = true) {
    if (!cropping || !region || !picture.naturalWidth || !picture.naturalHeight) return;
    const bounds = picture.getBoundingClientRect();
    const parent = viewport.getBoundingClientRect();
    selection.style.left = bounds.left - parent.left + viewport.scrollLeft + region.x / picture.naturalWidth * bounds.width + 'px';
    selection.style.top = bounds.top - parent.top + viewport.scrollTop + region.y / picture.naturalHeight * bounds.height + 'px';
    selection.style.width = region.w / picture.naturalWidth * bounds.width + 'px';
    selection.style.height = region.h / picture.naturalHeight * bounds.height + 'px';
    if (updateFields) for (const key of ['x', 'y', 'w', 'h']) fields[key].value = String(region[key]);
  }

  function resetRegion() {
    region = normalize({ x: 0, y: 0, w: picture.naturalWidth, h: picture.naturalHeight });
    renderRegion();
  }

  function beginCrop() {
    if (!permitted() || busy) return;
    if (!picture.naturalWidth || !picture.naturalHeight) { status.textContent = '图片尚未加载，请稍后重试。'; return; }
    cropping = true; mode = 0; setSize();
    dialog.dataset.cropping = 'true'; cropPanel.hidden = selection.hidden = false;
    sizeButton.disabled = true;
    status.textContent = '拖动图片框选局部，或输入原图像素坐标。';
    resetRegion();
  }

  function point(event) {
    const bounds = picture.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return { x: Math.max(0, Math.min(picture.naturalWidth, (event.clientX - bounds.left) / bounds.width * picture.naturalWidth)),
      y: Math.max(0, Math.min(picture.naturalHeight, (event.clientY - bounds.top) / bounds.height * picture.naturalHeight)) };
  }

  async function sendCrop() {
    if (busy || !cropping || !region || !permitted()) { if (cropping && !busy) status.textContent = '当前无法发送局部图片，请结束生成或重新选择图片。'; return; }
    const token = generation, callback = context.onCrop, chosen = normalize(Object.fromEntries(['x','y','w','h'].map(key => [key, fields[key].value])));
    busy = true; sendButton.disabled = resetButton.disabled = true;
    status.textContent = '正在准备局部图片…';
    try {
      const payload = await Promise.resolve(crop(picture, chosen));
      if (token !== generation || dialog.hidden) return;
      if (!permitted()) throw new Error('当前无法发送局部图片，请结束生成或重新选择图片。');
      await callback(payload);
      if (token === generation && !dialog.hidden) close();
    } catch (error) {
      if (token === generation && !dialog.hidden) status.textContent = error && error.message ? error.message : '发送局部图片失败，请重试。';
    } finally {
      if (token === generation) { busy = false; sendButton.disabled = resetButton.disabled = false; }
    }
  }

  function setSize() {
    dialog.dataset.size = ['fit', 'actual', 'zoom'][mode];
    picture.style.width = mode && picture.naturalWidth ? picture.naturalWidth * (mode === 2 ? 2 : 1) + 'px' : '';
    picture.style.height = mode && picture.naturalHeight ? picture.naturalHeight * (mode === 2 ? 2 : 1) + 'px' : '';
    sizeButton.textContent = ['原尺寸', '放大 200%', '适应窗口'][mode];
    sizeButton.setAttribute('aria-label', ['以原尺寸查看图片', '放大图片至 200%', '使图片适应窗口'][mode]);
  }

  function close() {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    generation++; context = null; drag = null; busy = false;
    root.document.body.style.overflow = previousOverflow;
    picture.removeAttribute('src');
    if (origin && origin.isConnected) origin.focus({ preventScroll: true });
    origin = null;
  }

  function create() {
    const document = root.document;
    const element = (tag, id, className) => {
      const node = document.createElement(tag);
      node.id = id;
      node.className = className;
      return node;
    };
    dialog = element('div', 'aiImagePreviewDialog', 'ai-image-preview');
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '图片预览');
    dialog.tabIndex = -1;
    const toolbar = element('div', 'aiImagePreviewToolbar', 'ai-image-preview-toolbar');
    sizeButton = element('button', 'aiImagePreviewSize', 'ai-image-preview-button');
    closeButton = element('button', 'aiImagePreviewClose', 'ai-image-preview-button');
    sizeButton.type = closeButton.type = 'button';
    closeButton.textContent = '关闭';
    closeButton.setAttribute('aria-label', '关闭图片预览');
    viewport = element('div', 'aiImagePreviewViewport', 'ai-image-preview-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '预览图片，放大后可滚动查看');
    picture = element('img', 'aiImagePreviewImage', 'ai-image-preview-image');
    picture.draggable = false;
    picture.addEventListener('load', () => { setSize(); if (cropping) resetRegion(); });
    cropButton = element('button', 'aiImagePreviewCrop', 'ai-image-preview-button');
    cropButton.type = 'button'; cropButton.textContent = '框选局部';
    cropPanel = element('div', 'aiImagePreviewCropPanel', 'ai-image-preview-crop-panel'); cropPanel.hidden = true;
    fields = {};
    for (const key of ['x', 'y', 'w', 'h']) {
      const label = element('label', 'aiImagePreviewLabel' + key, 'ai-image-preview-crop-field');
      label.textContent = key.toUpperCase() + ' ';
      const input = element('input', 'aiImagePreviewCrop' + key.toUpperCase(), '');
      input.type = 'number'; input.step = '1'; input.min = key === 'x' || key === 'y' ? '0' : '1';
      input.setAttribute('aria-label', ({x:'原图左边坐标',y:'原图上边坐标',w:'裁剪宽度',h:'裁剪高度'})[key]);
      fields[key] = input; label.appendChild(input); cropPanel.appendChild(label);
      input.addEventListener('input', () => {
        if (busy || !region) return;
        region = normalize(Object.fromEntries(['x','y','w','h'].map(name => [name, fields[name].value]))); renderRegion(false);
      });
      input.addEventListener('change', () => {
        if (busy || !region) return;
        region = normalize(Object.fromEntries(['x','y','w','h'].map(name => [name, fields[name].value]))); renderRegion();
      });
    }
    resetButton = element('button', 'aiImagePreviewResetCrop', 'ai-image-preview-button'); resetButton.type = 'button'; resetButton.textContent = '重置全图';
    sendButton = element('button', 'aiImagePreviewSendCrop', 'ai-image-preview-button'); sendButton.type = 'button'; sendButton.textContent = '发送局部图片';
    cropPanel.appendChild(resetButton); cropPanel.appendChild(sendButton);
    status = element('div', 'aiImagePreviewStatus', 'ai-image-preview-status'); status.setAttribute('role', 'status');
    selection = element('div', 'aiImagePreviewSelection', 'ai-image-preview-selection'); selection.hidden = true;
    viewport.appendChild(selection);
    cropButton.addEventListener('click', beginCrop); resetButton.addEventListener('click', () => { if (!busy) resetRegion(); });
    sendButton.addEventListener('click', sendCrop);
    picture.addEventListener('pointerdown', event => {
      if (!cropping || busy || !permitted() || (event.button !== undefined && event.button !== 0)) return;
      drag = point(event); if (!drag) return; event.preventDefault();
      if (picture.setPointerCapture) picture.setPointerCapture(event.pointerId);
    });
    picture.addEventListener('pointermove', event => {
      if (!drag || busy) return;
      const end = point(event); if (!end) return;
      region = normalize({ x: Math.min(drag.x,end.x), y: Math.min(drag.y,end.y), w: Math.abs(end.x-drag.x), h: Math.abs(end.y-drag.y) }); renderRegion();
    });
    picture.addEventListener('pointerup', () => { drag = null; });
    picture.addEventListener('pointercancel', () => { drag = null; });
    if (root.addEventListener) root.addEventListener('resize', renderRegion);
    viewport.appendChild(picture);
    toolbar.appendChild(cropButton);
    toolbar.appendChild(sizeButton);
    toolbar.appendChild(closeButton);
    dialog.appendChild(toolbar);
    dialog.appendChild(cropPanel);
    dialog.appendChild(status);
    dialog.appendChild(viewport);
    document.body.appendChild(dialog);
    closeButton.addEventListener('click', close);
    sizeButton.addEventListener('click', () => { mode = (mode + 1) % 3; setSize(); viewport.scrollTop = viewport.scrollLeft = 0; });
    dialog.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.target === dialog || (event.target === viewport && !cropping)) close();
    });
    // Capture before the editor's document-level shortcuts can act on the canvas.
    document.addEventListener('keydown', (event) => {
      if (dialog.hidden) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const targets = [cropButton, sizeButton, closeButton, ...Object.values(fields), resetButton, sendButton, viewport].filter(node => !node.hidden && !node.disabled && (cropping || !cropPanel.contains(node))); 
        const current = targets.indexOf(document.activeElement);
        const next = current < 0 ? (event.shiftKey ? targets.length - 1 : 0)
          : (current + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
        targets[next].focus();
      }
    }, true);
    document.addEventListener('keyup', (event) => { if (!dialog.hidden) event.stopImmediatePropagation(); }, true);
    document.addEventListener('focusin', (event) => {
      if (!dialog.hidden && !dialog.contains(event.target)) closeButton.focus();
    }, true);
  }

  function open(img, options) {
    const src = img.currentSrc || img.src;
    if (!src || !/^(data:image\/|blob:)/i.test(src)) return;
    if (!dialog) create();
    if (dialog.hidden) previousOverflow = root.document.body.style.overflow;
    generation++; context = options; busy = cropping = false; drag = region = null;
    cropPanel.hidden = selection.hidden = true; status.textContent = ''; dialog.dataset.cropping = 'false';
    sendButton.disabled = resetButton.disabled = sizeButton.disabled = false;
    cropButton.hidden = !permitted();
    origin = img;
    mode = 0;
    picture.alt = img.alt || '图片预览';
    // Reuse the displayed image URL; no API call, external asset or fetch helper.
    picture.src = src;
    setSize();
    dialog.hidden = false;
    root.document.body.style.overflow = 'hidden';
    viewport.scrollTop = viewport.scrollLeft = 0;
    closeButton.focus();
  }

  function crop(img, requested) {
    if (!img || !/^(data:image\/|blob:)/i.test(img.currentSrc || img.src || '')) throw new Error('仅支持本地图片裁剪');
    const sourceWidth = img.naturalWidth, sourceHeight = img.naturalHeight;
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) throw new Error('图片尚未加载');
    const region = requested === undefined ? { x: 0, y: 0, w: sourceWidth, h: sourceHeight } : requested;
    if (!region || typeof region !== 'object' || Array.isArray(region) || Object.keys(region).length !== 4 ||
      Object.keys(region).some(key => !['x', 'y', 'w', 'h'].includes(key)) ||
      ['x', 'y', 'w', 'h'].some(key => !Number.isFinite(region[key])) ||
      region.x < 0 || region.y < 0 || region.w < 1 || region.h < 1 ||
      region.x + region.w > sourceWidth || region.y + region.h > sourceHeight) throw new Error('裁剪区域必须是原图范围内的有限像素坐标');
    const scale = Math.min(1, 1600 / Math.max(region.w, region.h));
    const width = Math.max(1, Math.round(region.w * scale)), height = Math.max(1, Math.round(region.h * scale));
    const canvas = root.document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('无法创建图片');
    drawing.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, width, height);
    const url = canvas.toDataURL('image/png');
    if (!/^data:image\/png[;,]/i.test(url)) throw new Error('图片编码失败');
    if (url.length > 12 * 1024 * 1024) throw new Error('局部图片过大，请缩小框选范围后重试。');
    return { url, width, height, region: { ...region }, sourceWidth, sourceHeight };
  }

  function bind(img, options = {}) {
    if (!img) return;
    if (bound.has(img)) { bound.set(img, options); return; }
    bound.set(img, options);
    img.classList.add('ai-image-preview-thumbnail');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-haspopup', 'dialog');
    img.setAttribute('aria-label', (img.alt || '图片') + '，点击放大预览');
    img.addEventListener('click', (event) => { event.stopPropagation(); open(img, bound.get(img)); });
    img.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        open(img, bound.get(img));
      }
    });
    img.addEventListener('keyup', (event) => event.stopPropagation());
  }

  root.FlowSketchAIPreview = { bind, crop };
})(typeof window !== 'undefined' ? window : globalThis);
