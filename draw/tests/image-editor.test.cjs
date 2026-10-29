'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/js/image-editor.js');
const api = globalThis.FlowSketchImages;
const base = {w: 200, h: 100, imageWidth: 1000, imageHeight: 500, src: 'data:image/png;base64,AAAA'};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('legacy model falls back to frame dimensions and cover without mutating model', () => {
  const e = {w: 120, h: 80};
  assert.deepEqual(api.sourceSize(e), {width: 120, height: 80});
  assert.deepEqual(api.geometry(e).image, {x: 0, y: 0, width: 120, height: 80});
  assert.deepEqual(e, {w: 120, h: 80});
});
test('crop validation rejects corrupt imported state and copies valid state', () => {
  for (const crop of [null, {}, {x: -1, y: 0, w: 1, h: 1}, {x: 0, y: 0, w: 0, h: 1}, {x: .9, y: 0, w: .2, h: 1}, {x: 0, y: 0, w: 1, h: Infinity}, {x: '0', y: 0, w: 1, h: 1}]) {
    assert.equal(api.normalizedCrop(crop), null);
    assert.deepEqual(api.geometry({...base, crop}).crop, {x: 0, y: 0, w: 1000, h: 500});
  }
  const crop = {x: .2, y: .1, w: .5, h: .8};
  assert.deepEqual(api.normalizedCrop(crop), crop);
  assert.notEqual(api.normalizedCrop(crop), crop);
});
test('noncentral crop maps original image placement and source coordinates', () => {
  const e = {...base, crop: {x: .6, y: .2, w: .3, h: .4}};
  const g = api.geometry(e);
  assert.deepEqual(g.crop, {x: 600, y: 100, w: 300, h: 200});
  near(g.destination.w, 200); near(g.destination.h, 400 / 3); near(g.destination.y, -50 / 3);
  near(g.image.x, -400); near(g.image.y, -250 / 3);
  near(g.sourceVisible.y, 125); near(g.sourceVisible.h, 150);
  const point = api.frameToSource(e, 0, 0); near(point.x, 600); near(point.y, 125);
});
test('contain padding and cover cutting share predictable layout', () => {
  const e = {...base, w: 100, h: 100};
  assert.deepEqual(api.geometry(e).destination, {x: -50, y: 0, w: 200, h: 100});
  assert.deepEqual(api.geometry(e).sourceVisible, {x: 250, y: 0, w: 500, h: 500});
  e.fit = 'contain';
  assert.deepEqual(api.geometry(e).destination, {x: 0, y: 25, w: 100, h: 50});
  assert.equal(api.frameToSource(e, 50, 10), null);
  assert.deepEqual(api.frameToSource(e, 100, 75), {x: 1000, y: 500});
});
test('flips reverse source mapping around frame center without shifting crop', () => {
  const e = {...base, crop: {x: .2, y: .2, w: .4, h: .4}, flipX: true, flipY: true};
  const g = api.geometry(e);
  assert.equal(g.transform, 'translate(200 100) scale(-1 -1)');
  assert.deepEqual(api.frameToSource(e, 0, 0), {x: 600, y: 300});
  assert.deepEqual(api.frameToSource(e, 200, 100), {x: 200, y: 100});
  const svg = api.svgMarkup(e);
  assert.match(svg, /transform="translate\(200 100\) scale\(-1 -1\)"/);
  assert.match(svg, /clipPathUnits="userSpaceOnUse"/);
});
test('edge crops including last pixel remain within source', () => {
  const g = api.geometry({...base, crop: {x: .999, y: .998, w: .001, h: .002}});
  near(g.crop.x + g.crop.w, 1000); near(g.crop.y + g.crop.h, 500);
  assert.ok(g.sourceVisible.x >= 999 && g.sourceVisible.y >= 499);
});
test('SVG escapes sources and prevents IDs or remote URLs injecting markup', () => {
  const svg = api.svgMarkup({...base, src: 'assets/a&"<b>.png'}, {id: 'a"/><script>alert(1)</script>'});
  assert.match(svg, /href="assets\/a&amp;&quot;&lt;b&gt;\.png"/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /flow-image-a_22_/);
  for (const src of ['https://example.com/image.png', '//host/a', 'assets/../secret', 'javascript:alert(1)']) assert.equal(api.safeSource(src), '');
});

test('crop tolerates floating point boundary noise and returns strict bounds', () => {
  const crop = api.normalizedCrop({x: .1, y: .2, w: .9000000001, h: .8000000001});
  assert.deepEqual(crop, {x: .1, y: .2, w: .9, h: .8});
  assert.equal(api.normalizedCrop({x: 1.0000000001, y: 0, w: 1e-12, h: 1}), null);
  assert.equal(api.normalizedCrop({x: .1, y: 0, w: .90001, h: 1}), null);
});
test('color key removes alpha only and preserves original source pixels', () => {
  const original = new Uint8ClampedArray([255, 255, 255, 255, 10, 20, 30, 128, 255, 255, 255, 50, 1, 2, 3, 0]);
  const output = api.colorKeyPixels(original, '#FFFFFF', 0);
  assert.deepEqual([...output], [255, 255, 255, 0, 10, 20, 30, 128, 255, 255, 255, 0, 1, 2, 3, 0]);
  assert.deepEqual([...original], [255, 255, 255, 255, 10, 20, 30, 128, 255, 255, 255, 50, 1, 2, 3, 0]);
});
test('color key tolerance compares each channel including exact boundary', () => {
  const pixels = [100, 100, 100, 255, 124, 76, 100, 120, 125, 100, 100, 130, 100, 100, 75, 140];
  assert.deepEqual([...api.colorKeyPixels(pixels, '#646464', 24)], [100, 100, 100, 0, 124, 76, 100, 0, 125, 100, 100, 130, 100, 100, 75, 140]);
  assert.ok([...api.colorKeyPixels(pixels, '#000000', 255)].filter((_, i) => i % 4 === 3).every(alpha => alpha === 0));
});
test('color fields normalize invalid trusted legacy state to safe defaults', async () => {
  for (const color of [null, '#fff', 'red', '#GGGGGG', 10]) assert.deepEqual([...api.colorKeyPixels([1, 2, 3, 128], color)], [1, 2, 3, 128]);
  for (const tolerance of [-1, 256, 2.5, '24', NaN]) assert.deepEqual(api.colorSettings({transparentColor: '#aAbBcC', colorTolerance: tolerance}), {color: '#AABBCC', tolerance: 24});
  const e = {...base, transparentColor: 'invalid'};
  assert.equal(await api.prepareSource(e), e.src);
  assert.equal(e.src, base.src);
  await assert.rejects(api.sampleColor(e, -.01, 0), /between 0 and 1/);
});
test('more than forty concurrent transparent previews keep their completed source after cache eviction',async()=>{
  const vm=require('node:vm'),fs=require('node:fs');let sequence=0;
  const nodes=[],context={Uint8ClampedArray,Image:class {
    constructor(){this.naturalWidth=1;this.naturalHeight=1}
    set src(value){queueMicrotask(()=>this.onload())}
  },document:{createElement(type){
    if(type==='div'){const node={style:{},isConnected:true,innerHTML:''};nodes.push(node);return node}
    const id=++sequence;return {getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([255,255,255,255])}),putImageData(){}}),toDataURL:()=>`data:image/png;base64,PROCESSED_${id}`};
  }}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/js/image-editor.js'),'utf8'),context);
  for(let i=0;i<45;i++)context.FlowSketchImages.createElement({w:20,h:20,src:`data:image/png;base64,ORIGINAL_${i}`,transparentColor:'#ffffff',colorTolerance:0});
  await new Promise(setImmediate);
  assert.equal(nodes.length,45);for(const node of nodes)assert.match(node.innerHTML,/href="data:image\/png;base64,PROCESSED_/);
});
