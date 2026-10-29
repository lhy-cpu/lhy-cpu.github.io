const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const draws = [];
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
      this.attributes = {}; this.style = {}; this.dataset = {}; this.isConnected = true;
      this.scrollLeft = this.scrollTop = 0; this.classList = { add: () => {} }; this.naturalWidth = 1400; this.naturalHeight = 900;
    }
    getBoundingClientRect() { return this.tagName === 'IMG' ? { left: 100, top: 50, width: 700, height: 450 } : { left: 0, top: 0, width: 900, height: 600 }; }
    getContext() { return { drawImage: (...args) => draws.push(args) }; }
    toDataURL() { return 'data:image/png;base64,cropped'; }
    appendChild(child) { this.children.push(child); child.parentNode = this; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; delete this[name]; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    focus() { document.activeElement = this; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  }
  const document = { createElement: tag => new Element(tag), listeners: {},
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); } };
  document.body = new Element('body'); document.body.style.overflow = 'auto';
  const window = { document };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/ai-preview.js'), 'utf8'), { window });
  const img = document.createElement('img'); img.src = 'data:image/png;base64,existing'; img.alt = '画布截图';
  const event = (target, name, props = {}) => {
    const e = { target, ...props, stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    for (const fn of target.listeners[name] || []) fn(e);
    return e;
  };
  const byId = id => {
    const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean);
    return walk(document.body);
  };
  return { window, document, img, event, byId, draws };
}

test('bind is idempotent and click previews the displayed image and restores focus', () => {
  const { window, document, img, event, byId } = setup();
  img.currentSrc = 'blob:already-displayed';
  window.FlowSketchAIPreview.bind(img); window.FlowSketchAIPreview.bind(img);
  assert.equal(img.listeners.click.length, 1);
  assert.equal(img.tabIndex, 0); assert.equal(img.attributes['aria-haspopup'], 'dialog');
  assert.equal(event(img, 'click').stopped, true);
  const dialog = byId('aiImagePreviewDialog');
  assert.equal(dialog.hidden, false); assert.equal(dialog.attributes['aria-modal'], 'true');
  assert.equal(byId('aiImagePreviewImage').src, img.currentSrc);
  assert.equal(byId('aiImagePreviewImage').alt, img.alt);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, byId('aiImagePreviewClose'));
  event(byId('aiImagePreviewClose'), 'click');
  assert.equal(dialog.hidden, true); assert.equal(document.activeElement, img);
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(byId('aiImagePreviewImage').src, undefined);
  event(img, 'click'); assert.equal(document.body.children.length, 1);
});

test('keyboard opens, cycles focus in both directions, blocks canvas shortcuts and escapes', () => {
  const { window, document, img, event, byId } = setup();
  window.FlowSketchAIPreview.bind(img);
  assert.equal(event(img, 'keydown', { key: ' ' }).prevented, true);
  const viewport = byId('aiImagePreviewViewport'); const size = byId('aiImagePreviewSize');
  event(document, 'keydown', { key: 'Tab' }); assert.equal(document.activeElement, viewport);
  event(document, 'keydown', { key: 'Tab' }); assert.equal(document.activeElement, size);
  event(document, 'keydown', { key: 'Tab', shiftKey: true }); assert.equal(document.activeElement, viewport);
  assert.equal(event(document, 'keydown', { key: 'Delete' }).stopped, true);
  assert.equal(event(document, 'keyup', { key: 'Delete' }).stopped, true);
  event(document, 'focusin', { target: img }); assert.equal(document.activeElement, byId('aiImagePreviewClose'));
  assert.equal(event(document, 'keydown', { key: 'Escape' }).prevented, true);
  assert.equal(byId('aiImagePreviewDialog').hidden, true); assert.equal(document.activeElement, img);
  assert.equal(event(document, 'keydown', { key: 'Delete' }).stopped, undefined);
  event(img, 'keydown', { key: 'Enter' }); assert.equal(byId('aiImagePreviewDialog').hidden, false);
});

test('fit, original dimensions and 200 percent zoom cycle; only backdrop closes', () => {
  const { window, img, event, byId } = setup();
  window.FlowSketchAIPreview.bind(img); event(img, 'click');
  const dialog = byId('aiImagePreviewDialog'); const size = byId('aiImagePreviewSize');
  const picture = byId('aiImagePreviewImage');
  assert.equal(dialog.dataset.size, 'fit');
  event(size, 'click'); assert.equal(dialog.dataset.size, 'actual'); assert.equal(picture.style.width, '1400px');
  event(size, 'click'); assert.equal(dialog.dataset.size, 'zoom'); assert.equal(picture.style.width, '2800px');
  event(size, 'click'); assert.equal(dialog.dataset.size, 'fit'); assert.equal(picture.style.width, '');
  event(dialog, 'click', { target: picture }); assert.equal(dialog.hidden, false);
  event(dialog, 'click', { target: byId('aiImagePreviewViewport') }); assert.equal(dialog.hidden, true);
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('crop helper validates source and exact pixel region and limits output to 1600', () => {
  const { window, img, draws } = setup();
  const crop = window.FlowSketchAIPreview.crop;
  img.naturalWidth = 4000; img.naturalHeight = 3000;
  const result = crop(img, { x: 100, y: 200, w: 3200, h: 1600 });
  assert.equal(result.width, 1600); assert.equal(result.height, 800);
  assert.deepEqual(Array.from(draws[0].slice(1)), [100,200,3200,1600,0,0,1600,800]);
  assert.equal(result.sourceWidth, 4000); assert.equal(result.region.x, 100);
  assert.equal(crop(img).height, 1200);
  assert.equal(crop(img, { x:.5, y:1.25, w:2.5, h:3.75 }).width, 3);
  for (const region of [{ x: -1,y:0,w:1,h:1 }, { x:0,y:0,w:0,h:1 }, { x:0,y:0,w:4001,h:1 },
    { x:0,y:0,w:0.5,h:1 }, { x:0,y:0,w:Infinity,h:1 }, { x:0,y:0,w:1,h:1,extra:1 }, { x:0,y:0,w:1 }]) {
    assert.throws(() => crop(img, region));
  }
  img.src = 'https://example.com/remote.png'; assert.throws(() => crop(img));
});

test('crop drag maps display rectangle to pixels and numeric fields clamp safely', async () => {
  const { window, img, event, byId } = setup(); let payload;
  window.FlowSketchAIPreview.bind(img, { canCrop: () => true, onCrop: async data => { payload = data; } });
  event(img, 'click'); event(byId('aiImagePreviewCrop'), 'click');
  const picture = byId('aiImagePreviewImage');
  event(picture, 'pointerdown', { clientX:150, clientY:100, button:0 });
  event(picture, 'pointermove', { clientX:350, clientY:200 }); event(picture, 'pointerup');
  assert.equal(byId('aiImagePreviewCropX').value, '100');
  assert.equal(byId('aiImagePreviewCropY').value, '100');
  assert.equal(byId('aiImagePreviewCropW').value, '400');
  assert.equal(byId('aiImagePreviewCropH').value, '200');
  assert.equal(byId('aiImagePreviewSelection').style.left, '150px');
  byId('aiImagePreviewCropX').value = '1399'; byId('aiImagePreviewCropW').value = '5000';
  event(byId('aiImagePreviewCropX'), 'change'); assert.equal(byId('aiImagePreviewCropW').value, '1');
  event(byId('aiImagePreviewSendCrop'), 'click'); await tick();
  assert.equal(payload.region.x, 1399); assert.equal(payload.region.w, 1);
  assert.equal(byId('aiImagePreviewDialog').hidden, true);
});

test('oversized encoded crops are refused before they can enter a request', () => {
  const { window, document, img } = setup();
  const create = document.createElement;
  document.createElement = tag => {
    const element = create(tag);
    if (tag === 'canvas') element.toDataURL = () => 'data:image/png;base64,' + 'A'.repeat(12 * 1024 * 1024);
    return element;
  };
  assert.throws(() => window.FlowSketchAIPreview.crop(img), /局部图片过大/);
});

test('numeric crop inputs update the overlay and send current values without requiring blur', async () => {
  const { window, img, event, byId } = setup(); let payload;
  window.FlowSketchAIPreview.bind(img, { canCrop: () => true, onCrop: data => { payload = data; } });
  event(img, 'click'); event(byId('aiImagePreviewCrop'), 'click');
  for (const [key, value] of Object.entries({X:300,Y:60,W:200,H:140})) byId('aiImagePreviewCrop' + key).value = String(value);
  event(byId('aiImagePreviewCropW'), 'input');
  assert.equal(byId('aiImagePreviewSelection').style.left, '250px');
  assert.equal(byId('aiImagePreviewSelection').style.width, '100px');
  byId('aiImagePreviewCropW').value = '180';
  event(byId('aiImagePreviewSendCrop'), 'click'); await tick();
  assert.equal(payload.region.x, 300); assert.equal(payload.region.w, 180); assert.equal(payload.region.h, 140);
});

test('crop rechecks availability before callback and invalidates closed/reopened sessions', async () => {
  const { window, img, event, byId } = setup(); let allowed = true, calls = 0;
  window.FlowSketchAIPreview.bind(img, { canCrop: () => allowed, onCrop: () => { calls++; } });
  event(img,'click'); event(byId('aiImagePreviewCrop'),'click'); event(byId('aiImagePreviewSendCrop'),'click');
  allowed = false; await tick(); assert.equal(calls, 0); assert.equal(byId('aiImagePreviewDialog').hidden, false);
  allowed = true; event(byId('aiImagePreviewSendCrop'),'click'); event(byId('aiImagePreviewClose'),'click');
  event(img,'click'); await tick(); assert.equal(calls, 0); assert.equal(byId('aiImagePreviewDialog').hidden, false);
});

test('crop callback failure is shown, duplicate sends ignored and stale completion cannot close new preview', async () => {
  const { window, img, event, byId } = setup(); let calls = 0, finish;
  window.FlowSketchAIPreview.bind(img, { canCrop: () => true, onCrop: async () => { calls++; throw new Error('上传失败'); } });
  event(img,'click'); event(byId('aiImagePreviewCrop'),'click'); event(byId('aiImagePreviewSendCrop'),'click');
  event(byId('aiImagePreviewSendCrop'),'click'); await tick(); assert.equal(calls, 1);
  assert.equal(byId('aiImagePreviewStatus').textContent, '上传失败'); assert.equal(byId('aiImagePreviewSendCrop').disabled, false);
  window.FlowSketchAIPreview.bind(img, { canCrop: () => true, onCrop: () => new Promise(resolve => { finish = resolve; }) });
  event(byId('aiImagePreviewClose'),'click'); event(img,'click'); event(byId('aiImagePreviewCrop'),'click');
  event(byId('aiImagePreviewSendCrop'),'click'); await tick(); event(byId('aiImagePreviewClose'),'click'); event(img,'click');
  finish(); await tick(); assert.equal(byId('aiImagePreviewDialog').hidden, false);
});

test('remote previews are refused and unavailable crop stays hidden', () => {
  const { window, img, event, byId, document } = setup();
  img.src = 'https://example.com/remote.png'; window.FlowSketchAIPreview.bind(img); event(img,'click');
  assert.equal(document.body.children.length, 0);
  img.src = 'blob:local'; event(img,'click'); assert.equal(byId('aiImagePreviewCrop').hidden, true);
});
