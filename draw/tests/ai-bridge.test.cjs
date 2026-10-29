'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped editor bridge, with the surrounding editor represented by
// controlled native-function mocks. The engine itself has separate tests.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bridgeStart = html.indexOf('  const activateRecordBeforeAI=activateRecord;');
assert.ok(bridgeStart >= 0, 'index.html must contain the AI bridge');
const bridgeEnd = html.indexOf('\n})();', bridgeStart);
assert.ok(bridgeEnd > bridgeStart, 'AI bridge must end inside the editor closure');
const bridgeSource = html.slice(bridgeStart, bridgeEnd);

function harness(overrides = {}) {
  const calls = [];
  const events = [];
  const initialProject = { name: 'Diagram', canvas: { width: 800 }, elements: [{ id: 'one' }] };
  const context = {
    DOMException,
    project: initialProject,
    selection: ['one'],
    activeFileId: 'A',
    aiFileEpoch: 0,
    aiFileTransitions: 0,
    previewMode: false,
    projectUrl: '',
    interaction: null,
    document: {
      body: { dataset: { projectLoaded: '1' } },
      dispatchEvent: event => events.push(event),
    },
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    canvas: { querySelector: () => null },
    $: selector => {
      assert.equal(selector, '#modal');
      return { classList: { contains: () => false } };
    },
    clone: structuredClone,
    activateRecord: record => {
      context.activeFileId = record.id;
      context.project = record.project;
      return record.id;
    },
    loadProjectFile: async () => {},
    createNewProjectFile: async () => {},
    importProjectFiles: async () => {},
    normalize: () => calls.push('normalize'),
    normalizeExtra: () => calls.push('normalizeExtra'),
    syncUI: () => calls.push('syncUI'),
    render: () => calls.push('render'),
    commit: () => calls.push('commit'),
    fitCanvas: () => calls.push('fit'),
    window: {
      FlowSketchAIEngine: {
        apply: (project, operations) => {
          calls.push('engine.apply');
          assert.equal(project, context.project);
          assert.equal(operations, edits);
          return { ...structuredClone(project), name: 'Edited' };
        },
        describe: project => { calls.push('engine.describe'); return project.name; },
      },
    },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(bridgeSource, context, { filename: 'index.html:AI-bridge' });
  return { context, editor: context.window.FlowSketchEditor, calls, events, initialProject };
}
const edits = [{ op: 'test-operation' }];

for (const [name, overrides] of [
  ['preview mode', { previewMode: true }],
  ['URL preview', { projectUrl: 'https://example.test/project.json' }],
  ['startup', { document: { body: { dataset: {} }, dispatchEvent() {} } }],
  ['in-flight transition', { aiFileTransitions: 1 }],
]) {
  test(`${name} refuses editing before the engine runs`, () => {
    const { editor, calls, context, initialProject } = harness(overrides);
    assert.throws(() => editor.assertEditable(), /只读|载入或切换/);
    assert.throws(() => editor.apply(edits, editor.fingerprint()), /只读|载入或切换/);
    assert.deepEqual(calls, []);
    assert.equal(context.project, initialProject);
  });
}

test('identical content in different files has different fingerprints', () => {
  const { context, editor, initialProject, events } = harness();
  const original = editor.fingerprint();
  assert.equal(context.activateRecord({ id: 'B', project: structuredClone(initialProject) }), 'B');
  assert.notEqual(editor.fingerprint(), original);
  assert.equal(JSON.parse(editor.fingerprint()).fileId, 'B');
  assert.equal(events[0].type, 'flowsketch:document-change');
  assert.equal(events[0].detail.fileId, 'B');
  // File identity remains part of the fingerprint independently of the epoch.
  context.aiFileEpoch = 0;
  assert.notEqual(editor.fingerprint(), original);
});

test('A -> B -> A invalidates an old fingerprint even when content is unchanged', () => {
  const { context, editor, initialProject, calls } = harness();
  const stale = editor.fingerprint();
  context.activateRecord({ id: 'B', project: structuredClone(initialProject) });
  context.activateRecord({ id: 'A', project: initialProject });
  assert.notEqual(editor.fingerprint(), stale);
  assert.throws(() => editor.apply(edits, stale), /当前文件或画布已变化/);
  assert.deepEqual(calls, []);
});

for (const operation of ['loadProjectFile', 'createNewProjectFile', 'importProjectFiles']) {
  for (const fails of [false, true]) {
    test(`${operation} blocks apply while awaiting and releases its guard after ${fails ? 'failure' : 'success'}`, async () => {
      let resolve, reject;
      const waiting = new Promise((res, rej) => { resolve = res; reject = rej; });
      let received;
      const { context, editor, calls, events } = harness({
        [operation]: (...args) => { received = args; return waiting; },
      });
      const stale = editor.fingerprint();
      const pending = context[operation]('file', 42);
      const settled = fails ? assert.rejects(pending, /load failed/) : pending;
      assert.deepEqual(received, ['file', 42]);
      assert.equal(context.aiFileTransitions, 1);
      assert.equal(events[0].type, 'flowsketch:document-transition');
      assert.throws(() => editor.apply(edits, editor.fingerprint()), /载入或切换/);
      assert.deepEqual(calls, []);
      if (fails) reject(new Error('load failed'));
      else resolve('loaded');
      assert.equal(await settled, fails ? undefined : 'loaded');
      assert.equal(context.aiFileTransitions, 0);
      assert.doesNotThrow(() => editor.assertEditable());
      assert.throws(() => editor.apply(edits, stale), /当前文件或画布已变化/);
      assert.equal(editor.apply(edits, editor.fingerprint()), 'Edited');
      assert.ok(calls.includes('commit'));
    });
  }
}

test('valid apply normalizes, renders, clears selection and commits exactly once', () => {
  const { context, editor, calls, initialProject } = harness();
  assert.equal(editor.apply(edits, editor.fingerprint()), 'Edited');
  assert.deepEqual(calls, ['engine.apply', 'normalize', 'normalizeExtra', 'syncUI', 'render', 'commit', 'engine.describe']);
  assert.notEqual(context.project, initialProject);
  assert.equal(initialProject.name, 'Diagram');
  assert.equal(context.project.name, 'Edited');
  assert.equal(context.selection.length, 0);
});

test('render failure restores the original project and selection without committing', () => {
  const { context, editor, calls, initialProject } = harness();
  const failure = new Error('render failed');
  let renders = 0;
  context.render = () => {
    calls.push('render');
    if (++renders === 1) throw failure;
    assert.equal(context.project, initialProject, 'rollback render must receive the original project');
    assert.deepEqual(Array.from(context.selection), ['one']);
  };
  assert.throws(() => editor.apply(edits, editor.fingerprint()), error => error === failure);
  assert.equal(context.project, initialProject);
  assert.deepEqual(Array.from(context.selection), ['one']);
  assert.deepEqual(calls, ['engine.apply', 'normalize', 'normalizeExtra', 'syncUI', 'render', 'syncUI', 'render']);
});

test('reference images reach the engine only through the supplied local asset map', () => {
  const {editor, context} = harness();
  const assets = {ref_1: {src: 'data:image/png;base64,AAAA', width: 20, height: 10}};
  context.window.FlowSketchAIEngine.apply = (project, operations, received) => {
    assert.equal(received, assets);
    return {...project, name: 'Reference applied'};
  };
  assert.equal(editor.apply(edits, editor.fingerprint(), {assetMap: assets}), 'Reference applied');
});

test('capture bridge forwards canvas, preparation and request signal without modifying the project',async()=>{
  const captures=[],signal=new AbortController().signal,prepare=async()=>{};
  const {editor,context,calls,initialProject}=harness({prepareCanvasCaptureImages:prepare,window:{FlowSketchCanvasCapture:{capture:async options=>{captures.push(options);options.assertCurrent();return{url:'test'};}}}});
  const expected=editor.fingerprint();await editor.capture(expected,{signal});
  assert.equal(captures.length,1);assert.equal(captures[0].canvas,context.canvas);assert.equal(captures[0].width,800);
  assert.equal(captures[0].signal,signal);assert.equal(captures[0].prepare,prepare);assert.deepEqual(calls,[]);assert.equal(context.project,initialProject);
  context.project.name='Manual edit';assert.throws(captures[0].assertCurrent,/画布已变化/);
});

test('capture bridge refuses stale, modal and in-progress editor states before invoking renderer',()=>{
  for(const overrides of [{interaction:{}},{canvas:{querySelector:()=>({})}},{$:()=>({classList:{contains:()=>true}})}]){
    let invoked=false;
    const {editor}=harness({...overrides,prepareCanvasCaptureImages:()=>{},window:{FlowSketchCanvasCapture:{capture:()=>{invoked=true;}}}});
    assert.throws(()=>editor.capture(editor.fingerprint()),/结束画布编辑|关闭窗口/);assert.equal(invoked,false);
  }
  const {editor}=harness();assert.throws(()=>editor.capture('stale'),/画布已变化/);
  const controller=new AbortController();controller.abort();assert.throws(()=>editor.capture(editor.fingerprint(),{signal:controller.signal}),{name:'AbortError'});
});


test('screenshot image preparation fills legacy dimensions only on the copy and rejects changing images',async()=>{
  const source=html.slice(html.indexOf('  function imageExportKey(e)'),html.indexOf('  async function prepareImageExports'));
  const original={id:'image',type:'image',src:'data:image/png;base64,original',transparentColor:'#ff0000',colorTolerance:2};
  const project={elements:[original]},before=JSON.stringify(project),replaced=[];
  let change=false;
  const context={project,clone:structuredClone,el:id=>project.elements.find(e=>e.id===id),window:{FlowSketchImages:{
    ensureSourceSize:async e=>{e.imageWidth=64;e.imageHeight=32;},
    prepareSource:async e=>{if(change)original.src='changed';return'data:image/png;base64,prepared';},
    createElement:e=>e,
  }}};
  vm.createContext(context);vm.runInContext(source,context);
  const copy={querySelectorAll:()=>[{dataset:{id:'image'},querySelector:()=>({replaceChildren:e=>replaced.push(e)})}]};
  await context.prepareCanvasCaptureImages(copy);assert.equal(JSON.stringify(project),before);assert.equal(replaced[0].imageWidth,64);assert.equal(replaced[0].transparentColor,null);assert.equal(replaced[0].src,'data:image/png;base64,prepared');
  change=true;await assert.rejects(context.prepareCanvasCaptureImages(copy),/截图期间已变化/);assert.equal(replaced.length,1);
});


test('capture bridge focuses actual target bounds with padding, clamps to canvas, and lets explicit regions override',async()=>{
  let received;
  const prepare=()=>{};
  const {editor,context}=harness({prepareCanvasCaptureImages:prepare,boundsOf:e=>e.bounds,window:{FlowSketchCanvasCapture:{capture:async options=>{received=options;return{};}}}});
  context.project.canvas={width:800,height:500};context.project.elements=[{id:'rotated',type:'basicShape',bounds:{x:12,y:100,w:90,h:100}},{id:'hidden',visible:false,bounds:{x:400,y:0,w:100,h:50}}];
  const expected=editor.fingerprint();await editor.capture(expected,{elementIds:['rotated','missing','hidden']});assert.deepEqual(JSON.parse(JSON.stringify(received.region)),{x:0,y:68,w:134,h:164});
  const region={x:200,y:100,w:300,h:200};await editor.capture(expected,{elementIds:['rotated'],region});assert.equal(received.region,region);
  await editor.capture(expected,{elementIds:['deleted']});assert.equal(received.region,undefined);assert.equal(editor.fingerprint(),expected);
});


test('automatic target region includes basic-shape text rendered outside its shape',async()=>{
  let received;const text={};
  const canvas={querySelector:()=>null,querySelectorAll:()=>[{dataset:{id:'node'},querySelector:()=>text}],getBoundingClientRect:()=>({left:50,top:30,width:400,height:250})};
  const document={body:{dataset:{projectLoaded:'1'}},dispatchEvent(){},createRange:()=>({selectNodeContents:node=>assert.equal(node,text),getBoundingClientRect:()=>({left:250,top:105,width:70,height:20})})};
  const {editor,context}=harness({canvas,document,prepareCanvasCaptureImages:()=>{},boundsOf:e=>({x:e.x,y:e.y,w:e.w,h:e.h}),window:{FlowSketchCanvasCapture:{capture:async options=>{received=options}}}});
  context.project.canvas={width:800,height:500};context.project.elements=[{id:'node',type:'basicShape',x:100,y:100,w:160,h:70,text:'offset',textOffsetX:240}];
  await editor.capture(editor.fingerprint(),{elementIds:['node']});assert.equal(received.region.x,68);assert.equal(received.region.x+received.region.w,572);
});
