/* Shared image layout for the editor, SVG export and raster export. */
(function (root) {
  'use strict';
  let nextId = 0;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const escapeXML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
  function normalizedCrop(value) {
    if (!value || typeof value !== 'object') return null;
    const {x, y, w, h} = value;
    if (![x, y, w, h].every(v => typeof v === 'number' && Number.isFinite(v)) || x < 0 || y < 0 || w <= 0 || h <= 0 || x >= 1 || y >= 1 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return null;
    return {x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y)};
  }
  function sourceSize(element) {
    return {
      width: positive(element.imageWidth) ? element.imageWidth : positive(element.w) ? element.w : 1,
      height: positive(element.imageHeight) ? element.imageHeight : positive(element.h) ? element.h : 1
    };
  }
  function geometry(element) {
    const frame = {width: positive(element.w) ? element.w : 1, height: positive(element.h) ? element.h : 1};
    const source = sourceSize(element);
    const normalized = normalizedCrop(element.crop) || {x: 0, y: 0, w: 1, h: 1};
    const crop = {x: normalized.x * source.width, y: normalized.y * source.height, w: normalized.w * source.width, h: normalized.h * source.height};
    const scale = (element.fit === 'contain' ? Math.min : Math.max)(frame.width / crop.w, frame.height / crop.h);
    const destination = {x: (frame.width - crop.w * scale) / 2, y: (frame.height - crop.h * scale) / 2, w: crop.w * scale, h: crop.h * scale};
    const image = {x: destination.x - crop.x * scale, y: destination.y - crop.y * scale, width: source.width * scale, height: source.height * scale};
    const visible = {x: Math.max(0, destination.x), y: Math.max(0, destination.y), w: Math.min(frame.width, destination.w), h: Math.min(frame.height, destination.h)};
    const sourceVisible = {x: crop.x + (visible.x - destination.x) / scale, y: crop.y + (visible.y - destination.y) / scale, w: visible.w / scale, h: visible.h / scale};
    const flipX = element.flipX === true, flipY = element.flipY === true;
    return {frame, source, crop, normalizedCrop: normalized, destination, image, visible, sourceVisible, scale, flipX, flipY,
      transform: `translate(${flipX ? frame.width : 0} ${flipY ? frame.height : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`};
  }
  // Returns null for contain padding; coordinates are local to the unrotated frame.
  function frameToSource(element, x, y) {
    const g = geometry(element);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > g.frame.width || y > g.frame.height) return null;
    if (g.flipX) x = g.frame.width - x;
    if (g.flipY) y = g.frame.height - y;
    const d = g.destination;
    if (x < d.x || y < d.y || x > d.x + d.w || y > d.y + d.h) return null;
    return {x: g.crop.x + (x - d.x) / g.scale, y: g.crop.y + (y - d.y) / g.scale};
  }
  function safeSource(value) {
    if (typeof value !== 'string') return '';
    if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(value)) return value;
    if (/^(?:\.\/)?assets\//.test(value) && !/[\\\u0000-\u001f]/.test(value) && !value.split(/[/?#]/).includes('..')) return value;
    return '';
  }
  function svgMarkup(element, options = {}) {
    const g = geometry(element), d = g.destination, im = g.image;
    // Only identifier characters enter the url() expression; caller IDs never become markup.
    const id = 'flow-image-' + (options.id == null ? ++nextId : Array.from(String(options.id), c => /[a-zA-Z0-9_-]/.test(c) ? c : '_' + c.codePointAt(0).toString(16) + '_').join(''));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.frame.width}" height="${g.frame.height}" viewBox="0 0 ${g.frame.width} ${g.frame.height}" style="display:block;width:100%;height:100%;overflow:hidden" overflow="hidden"><defs><clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}"/></clipPath></defs><g transform="${g.transform}" clip-path="url(#${id})"><image href="${escapeXML(options.source === undefined ? preparedSource(element) : safeSource(options.source))}" x="${im.x}" y="${im.y}" width="${im.width}" height="${im.height}" preserveAspectRatio="none"/></g></svg>`;
  }
  function createElement(element) {
    const node = root.document.createElement('div');
    node.style.cssText = 'width:100%;height:100%;overflow:hidden;pointer-events:none;';
    node.innerHTML = svgMarkup(element);
    const key = sourceKey(element);
    if (colorSettings(element).color) prepareSource(element).then(source => {
      if (node.isConnected && sourceKey(element) === key) node.innerHTML = svgMarkup(element, {source});
    }).catch(() => { /* Keep the original preview if browser decoding fails. */ });
    return node;
  }
  const decoded = new Map(), prepared = new Map();
  const CACHE_LIMIT = 40;
  function remember(cache, key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
  }
  function recall(cache, key) {
    if (!cache.has(key)) return undefined;
    return remember(cache, key, cache.get(key));
  }
  function colorSettings(element) {
    return {
      color: typeof element.transparentColor === 'string' && /^#[0-9a-f]{6}$/i.test(element.transparentColor) ? element.transparentColor.toUpperCase() : null,
      tolerance: Number.isInteger(element.colorTolerance) && element.colorTolerance >= 0 && element.colorTolerance <= 255 ? element.colorTolerance : 24
    };
  }
  function sourceKey(element) {
    const settings = colorSettings(element);
    return JSON.stringify([safeSource(element.src), settings.color, settings.tolerance]);
  }
  // Chebyshev RGB distance: every channel must be within the selected tolerance.
  // A new array protects the source; unrelated RGB and alpha values are unchanged.
  function colorKeyPixels(pixels, color, tolerance = 24) {
    const output = new Uint8ClampedArray(pixels);
    const settings = colorSettings({transparentColor: color, colorTolerance: tolerance});
    if (!settings.color) return output;
    const rgb = [1, 3, 5].map(offset => parseInt(settings.color.slice(offset, offset + 2), 16));
    for (let i = 0; i + 3 < output.length; i += 4) {
      if (rgb.every((channel, j) => Math.abs(output[i + j] - channel) <= settings.tolerance)) output[i + 3] = 0;
    }
    return output;
  }
  function preparedSource(element) {
    if (!colorSettings(element).color) return safeSource(element.src);
    const entry = recall(prepared, sourceKey(element));
    return entry && entry.src || safeSource(element.src);
  }
  function canvasContext(width, height) {
    const canvas = root.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    return {canvas, ctx};
  }
  async function prepareSource(element) {
    const original = safeSource(element.src), settings = colorSettings(element);
    if (!settings.color) return original;
    const key = sourceKey(element), cached = recall(prepared, key);
    if (cached) return cached.promise;
    const entry = {src: null, promise: null};
    entry.promise = (async () => {
      const image = await decode(original);
      if (element.src === original) {
        element.imageWidth = image.naturalWidth;
        element.imageHeight = image.naturalHeight;
      }
      const {canvas, ctx} = canvasContext(image.naturalWidth, image.naturalHeight);
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      pixels.data.set(colorKeyPixels(pixels.data, settings.color, settings.tolerance));
      ctx.putImageData(pixels, 0, 0);
      entry.src = canvas.toDataURL('image/png');
      return entry.src;
    })();
    remember(prepared, key, entry);
    entry.promise.catch(() => { if (prepared.get(key) === entry) prepared.delete(key); });
    return entry.promise;
  }
  async function sampleColor(element, u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u > 1 || v > 1) throw new Error('Image sample coordinates must be between 0 and 1.');
    const image = await decode(element.src), {ctx} = canvasContext(1, 1);
    const x = Math.min(image.naturalWidth - 1, Math.floor(u * image.naturalWidth));
    const y = Math.min(image.naturalHeight - 1, Math.floor(v * image.naturalHeight));
    ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + Array.from(pixel.slice(0, 3), value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function decode(src) {
    src = safeSource(src);
    if (!src) return Promise.reject(new Error('Image source must be a local image data URL or asset.'));
    const cached = recall(decoded, src);
    if (cached) return cached;
    if (!decoded.has(src)) {
      const pending = new Promise((resolve, reject) => {
        const image = new root.Image();
        image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('Image has no intrinsic dimensions.'));
        image.onerror = () => reject(new Error('Unable to decode image.'));
        image.src = src;
      });
      remember(decoded, src, pending);
      pending.catch(() => { if (decoded.get(src) === pending) decoded.delete(src); });
    }
    return decoded.get(src);
  }
  async function ensureSourceSize(element) {
    if (positive(element.imageWidth) && positive(element.imageHeight)) return sourceSize(element);
    const image = await decode(element.src);
    element.imageWidth = image.naturalWidth;
    element.imageHeight = image.naturalHeight;
    return sourceSize(element);
  }
  async function rasterize(element) {
    const source = await prepareSource(element);
    const image = await decode(source);
    // Cache metadata on legacy elements so subsequent DOM/SVG layout uses the same geometry.
    element.imageWidth = image.naturalWidth;
    element.imageHeight = image.naturalHeight;
    const g = geometry(element), canvas = root.document.createElement('canvas');
    const ratio = Math.min(1, 4096 / Math.max(g.frame.width, g.frame.height));
    canvas.width = Math.max(1, Math.round(g.frame.width * ratio));
    canvas.height = Math.max(1, Math.round(g.frame.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.scale(canvas.width / g.frame.width, canvas.height / g.frame.height);
    ctx.translate(g.flipX ? g.frame.width : 0, g.flipY ? g.frame.height : 0);
    ctx.scale(g.flipX ? -1 : 1, g.flipY ? -1 : 1);
    const s = g.crop, d = g.destination;
    ctx.drawImage(image, s.x, s.y, s.w, s.h, d.x, d.y, d.w, d.h);
    return canvas.toDataURL('image/png');
  }
  root.FlowSketchImages = Object.freeze({normalizedCrop, sourceSize, geometry, frameToSource, safeSource, colorSettings, colorKeyPixels, prepareSource, sampleColor, svgMarkup, createElement, ensureSourceSize, rasterize});
})(typeof window === 'undefined' ? globalThis : window);
