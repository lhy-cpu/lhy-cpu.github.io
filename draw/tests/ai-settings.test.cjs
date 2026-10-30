'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/ai.js'), 'utf8');
const storageKey = 'flowsketch-ai-settings-v1';

function element() {
  const listeners = new Map();
  const classes = new Set();
  let value = '';
  return {
    get value() { return value; }, set value(next) { value = String(next); },
    textContent: '', checked: false, disabled: false, hidden: false, open: true,
    children: [],
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      toggle(name, state) { if (state) classes.add(name); else classes.delete(name); },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    get lastElementChild() { return this.children.at(-1); },
    querySelectorAll() { return []; },
    setAttribute() {}, focus() {},
  };
}

function harness(saved, complete = async () => ({ content: '完成' }), apply = () => ({}), dimensions = [100,100], options = {}) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const stored = new Map(saved === undefined ? [] : [[storageKey, JSON.stringify(saved)]]);
  const timers = [], cleared = [], calls = [], intervals = [], clearedIntervals = [], instructions = [], applications = [], captures = [];
  let now = 0; const documentListeners = new Map();
  const document = {
    getElementById: get, createElement: tag => tag === 'canvas' ? {
      getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,test',
    } : element(),
    querySelector: () => element(), querySelectorAll: () => [], addEventListener(type, handler) { documentListeners.set(type, handler); },
  };
  const context = {
    document, AbortController, DOMException, Date: {now: () => now},
    FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload(); } },
    Image: class { naturalWidth = dimensions[0]; naturalHeight = dimensions[1]; set src(value) { this.imageSrc=value;this.onload(); } get src(){return this.imageSrc;} },
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key),
    },
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: timer => cleared.push(timer),
    setInterval: (callback, delay) => {const interval={callback,delay};intervals.push(interval);return interval;},
    clearInterval: interval => clearedIntervals.push(interval),
    window: {
      FlowSketchEditor: { openRelayHelp: () => options.openRelayHelp?.(), readonly: false, assertEditable() {}, fingerprint: () => options.fingerprint?.()??'same', snapshot: () => options.snapshot?.()??({}), apply: (...args) => {applications.push(args);return apply(...args);}, capture: (...args) => {captures.push(args);return options.capture?options.capture(...args):Promise.reject(Error('capture unavailable'));}, fit() {} },
      FlowSketchAIEngine: { describe: snapshot => snapshot },
      FlowSketchAIPrompts: { tool: () => ({}), tools: vision => [{function:{name:'edit_canvas'}},...(vision?[{function:{name:'view_canvas'}},{function:{name:'view_reference'}}]:[])], instructions: (...args) => {instructions.push(args);return 'instructions';} },
      FlowSketchAIPreview: {bind:(img,opts)=>{img.previewOptions=opts;},crop:(img,region)=>options.crop?options.crop(img,region):({url:'data:image/png;base64,crop',width:20,height:10,sourceWidth:img.naturalWidth,sourceHeight:img.naturalHeight,region:region||{x:0,y:0,w:img.naturalWidth,h:img.naturalHeight}})},
      FlowSketchAIClient: { endpoint() {}, relayEndpoint() {}, checkRelay: (...args) => options.checkRelay?.(...args)??Promise.resolve(true), complete: options => { calls.push(options); return complete(options); } },
    },
  };
  vm.runInNewContext(source, context, { filename: 'assets/js/ai.js' });
  return {
    get, stored, timers, cleared, calls, intervals, clearedIntervals, instructions, applications, captures,
    tick: seconds => {now=seconds*1000;intervals.forEach(item=>item.callback());},
    documentEvent: type => documentListeners.get(type)?.(),
    send: (text = '画图') => { get('aiPrompt').value = text; return get('aiForm').emit('submit'); },
    input: value => { get('aiTimeout').value = value; get('aiTimeout').emit('input'); },
    history: value => { get('aiHistory').value = value; get('aiHistory').emit('input'); },
    addImage: async () => {
      get('aiImageInput').onchange({ target: { files: [{ type: 'image/png', size: 1, name: 'reference.png' }] } });
      await new Promise(resolve => setImmediate(resolve));
    },
    notices: () => get('aiMessages').children.map(node => node.children.find(child=>child.className==='ai-message-body')?.textContent ?? '').join('\n'),
  };
}

const configured = { apiUrl: 'https://example.test/v1', model: 'test' };

test('new and legacy settings default to 180 seconds without losing existing fields', () => {
  assert.equal(harness().get('aiTimeout').value, '180');
  const h = harness({ ...configured, stream: false, mode: 'tools' });
  assert.equal(h.get('aiTimeout').value, '180');
  assert.equal(h.get('aiModel').value, 'test');
  assert.equal(h.get('aiStream').checked, false);
  assert.equal(h.get('aiMode').value, 'tools');
});

test('invalid historical values fall back to the default; valid boundaries survive reload', () => {
  for (const timeoutSeconds of [null, '', '60', 0, 9, 3601, 10.5]) {
    assert.equal(harness({ ...configured, timeoutSeconds }).get('aiTimeout').value, '180');
  }
  for (const timeoutSeconds of [10, 60, 3600]) {
    assert.equal(harness({ ...configured, timeoutSeconds }).get('aiTimeout').value, String(timeoutSeconds));
  }
});

test('valid input persists, save closes settings, and clear restores the default', () => {
  const h = harness(configured);
  h.input('45');
  assert.equal(JSON.parse(h.stored.get(storageKey)).timeoutSeconds, 45);
  h.get('aiSave').onclick();
  assert.equal(h.get('aiSettings').open, false);
  h.get('aiForget').onclick();
  assert.equal(h.get('aiTimeout').value, '180');
  assert.equal(h.stored.has(storageKey), false);
});

test('invalid edited input is rejected by both save and send without persisting or requesting', async () => {
  for (const invalid of ['', ' ', '0', '9', '3601', '15.2', 'NaN', 'Infinity']) {
    const h = harness({ ...configured, timeoutSeconds: 60 });
    h.get('aiSettings').open = true;
    h.input(invalid);
    h.get('aiSave').onclick();
    assert.equal(h.get('aiSettings').open, true);
    assert.match(h.get('aiSettingsStatus').textContent, /10–3600 秒之间的整数/);
    await h.send();
    assert.equal(h.calls.length, 0);
    assert.equal(h.timers.length, 0);
    assert.equal(JSON.parse(h.stored.get(storageKey)).timeoutSeconds, 60);
    assert.equal(h.get('aiPrompt').value, '画图');
  }
});

test('configured total deadline aborts the request and reports its seconds', async () => {
  const h = harness({ ...configured, timeoutSeconds: 27 }, ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const pending = h.send();
  assert.equal(h.timers[0].delay, 27000);
  assert.equal(h.get('aiTimeout').disabled, true);
  assert.equal(h.get('aiHistory').disabled, true);
  h.timers[0].callback();
  await pending;
  assert.equal(h.calls[0].signal.aborted, true);
  assert.match(h.notices(), /请求超过 27 秒，已停止/);
  assert.deepEqual(h.cleared, [h.timers[0]]);
  assert.equal(h.get('aiTimeout').disabled, false);
});

test('all tool rounds share one deadline and the settings snapshot of this send', async () => {
  let release;
  const firstReply = new Promise(resolve => { release = resolve; });
  let round = 0;
  const h = harness({ ...configured, mode: 'tools', timeoutSeconds: 42 }, () => ++round === 1 ? firstReply : Promise.resolve({ content: '完成' }));
  const pending = h.send();
  assert.equal(h.get('aiTimeout').disabled, true);
  // Programmatic changes can still dispatch input while a native input is disabled.
  h.input('90');
  h.history('1');
  h.get('aiMode').value = 'json';
  h.get('aiMode').emit('input');
  release({ content: '', tool_calls: [{ id: 'edit-1', function: { name: 'edit_canvas', arguments: '{"operations":[]}' } }] });
  await pending;
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].config, h.calls[1].config);
  assert.equal(h.calls[1].config.timeoutSeconds, 42);
  assert.equal(h.calls[1].config.mode, 'tools');
  assert.equal(h.calls[1].config.historyTurns, 24);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 42000);
  assert.deepEqual(h.cleared, [h.timers[0]]);
  assert.equal(h.get('aiTimeout').disabled, false);
  assert.equal(h.get('aiHistory').disabled, false);
});

test('history defaults and legacy migration use 24; only valid saved integers survive', () => {
  assert.equal(harness().get('aiHistory').value, '24');
  assert.equal(harness(configured).get('aiHistory').value, '24');
  for (const historyTurns of [null, '', '24', 0, 101, 2.5]) {
    assert.equal(harness({ ...configured, historyTurns }).get('aiHistory').value, '24');
  }
  for (const historyTurns of [1, 24, 100]) {
    assert.equal(harness({ ...configured, historyTurns }).get('aiHistory').value, String(historyTurns));
  }
});

test('history persists and clears; invalid input prevents save and send', async () => {
  const h = harness(configured);
  h.history('50');
  h.get('aiSave').onclick();
  assert.equal(JSON.parse(h.stored.get(storageKey)).historyTurns, 50);
  for (const value of ['', ' ', '0', '-1', '101', '2.1', 'NaN', 'Infinity']) {
    h.get('aiSettings').open = true;
    h.history(value);
    h.get('aiSave').onclick();
    assert.equal(h.get('aiSettings').open, true);
    assert.match(h.get('aiSettingsStatus').textContent, /1–100 之间的整数/);
    await h.send();
    assert.equal(h.calls.length, 0);
    assert.equal(JSON.parse(h.stored.get(storageKey)).historyTurns, 50);
  }
  h.get('aiForget').onclick();
  assert.equal(h.get('aiHistory').value, '24');
  assert.equal(h.stored.has(storageKey), false);
});

const userTexts = call => Array.from(call.messages).filter(message => message.role === 'user').map(message => message.content);

test('default sends 24 turns including current input; increasing restores retained history', async () => {
  const h = harness(configured);
  for (let n = 1; n <= 30; n++) await h.send(`turn-${n}`);
  assert.deepEqual(userTexts(h.calls.at(-1)), Array.from({ length: 24 }, (_, i) => `turn-${i + 7}`));
  h.history('1');
  await h.send('turn-31');
  assert.deepEqual(userTexts(h.calls.at(-1)), ['turn-31']);
  h.history('50');
  await h.send('turn-32');
  assert.deepEqual(userTexts(h.calls.at(-1)), Array.from({ length: 32 }, (_, i) => `turn-${i + 1}`));
});

test('memory slides at 100 turns even when the sending window is smaller', async () => {
  const h = harness({ ...configured, historyTurns: 1 });
  for (let n = 1; n <= 105; n++) await h.send(`turn-${n}`);
  h.history('100');
  await h.send('turn-106');
  assert.deepEqual(userTexts(h.calls.at(-1)), Array.from({ length: 100 }, (_, i) => `turn-${i + 7}`));
});

test('tool rounds stay inside their user turn and are pruned together at a one-turn window', async () => {
  let calls = 0;
  const h = harness({ ...configured, mode: 'tools', historyTurns: 2 }, async () => ++calls === 1 ? {
    content: '', tool_calls: [{ id: 'call-1', function: { name: 'edit_canvas', arguments: '{"operations":[]}' } }],
  } : { content: '完成' });
  await h.send('first');
  assert.deepEqual(userTexts(h.calls[1]), ['first']);
  assert.equal(h.calls[1].messages.filter(message => message.role === 'tool').length, 1);
  await h.send('second');
  assert.deepEqual(userTexts(h.calls[2]), ['first', 'second']);
  assert.equal(h.calls[2].messages.filter(message => message.role === 'tool').length, 1);
  h.history('1');
  await h.send('third');
  assert.deepEqual(userTexts(h.calls[3]), ['third']);
  assert.equal(h.calls[3].messages.filter(message => message.role === 'tool').length, 0);
});

test('image capability guard only checks history actually sent, including the one-turn edge', async () => {
  const h = harness({ ...configured, vision: true, historyTurns: 2 });
  await h.addImage();
  await h.send('with image');
  assert.equal(h.calls[0].messages.at(-1).content[1].type, 'image_url');
  h.get('aiVision').checked = false;
  h.get('aiVision').emit('input');
  await h.send('blocked');
  assert.equal(h.calls.length, 1);
  assert.match(h.notices(), /当前模型未启用图片输入/);
  h.history('1');
  await h.send('without history');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(userTexts(h.calls[1]), ['without history']);
  h.history('2');
  await h.send('old image outside window');
  assert.equal(h.calls.length, 3);
  assert.deepEqual(userTexts(h.calls[2]), ['without history', 'old image outside window']);
  h.history('4');
  await h.send('image back in window');
  assert.equal(h.calls.length, 3);
});

test('manual stop cancels the configured deadline without a timeout message', async () => {
  const h = harness({ ...configured, timeoutSeconds: 60 }, ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const pending = h.send();
  h.get('aiStop').onclick();
  await pending;
  assert.match(h.notices(), /已停止生成/);
  assert.doesNotMatch(h.notices(), /请求超过/);
  assert.deepEqual(h.cleared, [h.timers[0]]);
});

test('300-second deadline is total across tool rounds and elapsed status ticks once per second', async () => {
  let release;
  const h = harness({ ...configured, timeoutSeconds: 300, mode: 'tools' }, () => new Promise(resolve => {release=resolve;}));
  const pending=h.send();
  assert.equal(h.timers[0].delay,300000);
  assert.equal(h.intervals[0].delay,1000);
  h.tick(181);
  assert.match(h.get('aiStatus').textContent,/已用 181 秒 \/ 上限 300 秒/);
  release({content:'',tool_calls:[{id:'one',function:{name:'edit_canvas',arguments:'{"operations":[]}'}}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.timers.length,1);
  assert.match(h.get('aiStatus').textContent,/已应用 1 批修改/);
  release({content:'完成'});
  await pending;
  assert.deepEqual(h.clearedIntervals,[h.intervals[0]]);
});

test('document transition stops generation with a distinct reason and clears both timers', async () => {
  const h=harness({...configured,timeoutSeconds:300},({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')))));
  const pending=h.send();
  h.documentEvent('flowsketch:document-transition');
  h.documentEvent('flowsketch:document-change');
  await pending;
  assert.match(h.notices(),/已切换文件，停止当前生成/);
  assert.match(h.get('aiStatus').textContent,/文件切换/);
  assert.deepEqual(h.clearedIntervals,[h.intervals[0]]);
});

test('early SSE interruption explains the configured limit without claiming proxy causation', async () => {
  const h=harness({...configured,timeoutSeconds:300},async()=>{throw Error('API 流意外中断或缺少结束标记，未执行任何操作。');});
  await h.send();
  assert.match(h.notices(),/页面总时限为 300 秒/);
  assert.match(h.notices(),/proxy_read_timeout/);
  assert.match(h.notices(),/无法确定中断原因/);
  assert.doesNotMatch(h.notices(),/请求超过/);
  assert.equal(h.get('aiStatus').textContent,'连接或上游回复中断');
  assert.deepEqual(h.clearedIntervals,[h.intervals[0]]);
});

test('failed tool batch never reports the canvas as synchronized or updated', async () => {
  let count=0;
  const h=harness({...configured,mode:'tools'},async()=>++count===1?{content:'',tool_calls:[{id:'one',function:{name:'edit_canvas',arguments:'{"operations":[]}'}}]}:{content:'无法应用'},()=>{throw Error('bad operation');});
  await h.send();
  assert.match(h.get('aiStatus').textContent,/修改未应用/);
  assert.doesNotMatch(h.notices(),/已应用/);
});

function drag(h,type,files=[]) {
  let prevented=0,stopped=0;
  const event={preventDefault(){prevented++;},stopPropagation(){stopped++;},dataTransfer:{files}};
  h.get('aiPanel').emit(type,event);
  assert.equal(prevented,1);assert.equal(stopped,1);
  return event;
}

test('panel consumes disabled and unsupported drops with clear feedback', async () => {
  const h=harness(configured);
  for(const type of ['dragenter','dragover','dragleave','drop'])drag(h,type,[{type:'image/png'}]);
  assert.match(h.notices(),/请先启用/);
  assert.equal(h.get('aiAttachments').children.length,0);
  h.get('aiVision').checked=true;h.get('aiVision').emit('input');
  drag(h,'drop',[{type:'application/pdf',size:1,name:'bad.pdf'}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.notices(),/只支持 PNG/);
  assert.equal(h.applications.length,0);
});

test('nested panel drag highlight clears reliably and image drops become attachments only', async () => {
  const h=harness({...configured,vision:true});
  const hint=h.get('aiPanel').children[0];
  drag(h,'dragenter');drag(h,'dragenter');drag(h,'dragleave');
  assert.equal(hint.hidden,false);
  drag(h,'dragleave');assert.equal(hint.hidden,true);
  drag(h,'dragenter');drag(h,'drop',[{type:'image/png',size:1,name:'reference.png'}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(hint.hidden,true);
  assert.equal(h.get('aiAttachments').children.length,1);
  assert.equal(h.applications.length,0);
});

test('busy panel intercepts drag and reports that image attachment must wait', async () => {
  const h=harness({...configured,vision:true},({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')))));
  const pending=h.send();drag(h,'drop',[{type:'image/png',size:1,name:'reference.png'}]);
  assert.match(h.notices(),/正在生成，请完成或停止/);
  assert.equal(h.get('aiAttachments').children.length,0);
  h.get('aiStop').onclick();await pending;
});

test('reference metadata and safe assets follow included history and editor apply options', async () => {
  const h=harness({...configured,vision:true},async()=>({content:'```flowsketch\n{"operations":[]}\n```'}));
  await h.addImage();await h.send('reference');
  const metadata=h.instructions[0][2];
  assert.equal(metadata.length,1);
  assert.match(metadata[0].assetId,/^ref_\d+$/);
  assert.equal(metadata[0].width,100);assert.equal(metadata[0].height,100);
  assert.equal(metadata[0].name,'reference.png');
  assert.equal(Object.hasOwn(metadata[0],'src'),false);
  assert.match(h.calls[0].messages.at(-1).content[0].text,new RegExp(metadata[0].assetId));
  assert.equal(h.applications[0][2].assetMap[metadata[0].assetId].src,'data:image/jpeg;base64,test');
  await h.send('use prior image');
  assert.equal(h.instructions[1][2][0].assetId,metadata[0].assetId);
  h.history('1');await h.send('outside window');
  assert.equal(h.instructions[2][2].length,0);
  assert.equal(Object.keys(h.applications[2][2].assetMap).length,0);
  h.history('100');await h.send('restore history');
  assert.equal(h.instructions[3][2][0].assetId,metadata[0].assetId);
  h.get('aiClear').onclick();await h.send('cleared');
  assert.equal(h.instructions[4][2].length,0);
});


test('asset dimensions describe the prepared JPEG and pruned turns release reference access', async () => {
  const h=harness({...configured,vision:true,historyTurns:1},async()=>({content:'完成'}),()=>({}),[3200,2400]);
  await h.addImage();await h.send('reference');
  assert.equal(h.instructions[0][2][0].width,1600);
  assert.equal(h.instructions[0][2][0].height,1200);
  for(let n=0;n<100;n++)await h.send(`later ${n}`);
  h.history('100');await h.send('old reference pruned');
  assert.equal(h.instructions.at(-1)[2].length,0);
  assert.equal(h.calls.at(-1).messages.some(message=>Array.isArray(message.content)),false);
});

const fakeScreenshot = n => ({url:'data:image/png;base64,'+Buffer.from('shot-'+n).toString('base64'),width:800,height:500,canvasWidth:1600,canvasHeight:1000});
const editReply = id => ({content:'好的，我准备调整布局。',tool_calls:[{id,function:{name:'edit_canvas',arguments:'{"operations":[]}'}}]});
const viewReply = (id,args='{}') => ({content:'查看当前画布。',tool_calls:[{id,function:{name:'view_canvas',arguments:args}}]});
const transmittedImages = messages => messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url').map(p=>p.image_url.url):[]);

test('vision tools see initial, edit and explicit view screenshots with JSON-only tool results',async()=>{
  let captures=0;const sent=[],replies=[editReply('edit1'),viewReply('view1'),editReply('edit2'),{content:'检查完成'}];
  const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return replies.shift();},()=>({elements:[]}),[100,100],{capture:async()=>fakeScreenshot(++captures)});
  await h.send();
  assert.equal(captures,4);assert.equal(h.applications.length,2);assert.equal(h.calls.length,4);
  assert.deepEqual(sent.map(transmittedImages),[1,2,3,4].map(n=>[fakeScreenshot(n).url]));
  const view=JSON.parse(sent[2].find(m=>m.role==='tool'&&m.tool_call_id==='view1').content);
  assert.equal(view.ok,true);assert.equal(view.screenshotAttached,true);assert.equal(view.canvasWidth,1600);assert.equal(view.width,800);
  assert.equal(Object.hasOwn(view,'url'),false);assert.equal(Object.hasOwn(view,'image'),false);
  assert.ok(h.calls.every(call=>call.tools.some(t=>t.function.name==='view_canvas')));
  assert.equal(h.timers.length,1);assert.ok(h.captures.every(c=>c[1].signal===h.calls[0].signal));
  assert.ok(h.instructions.every(args=>args[3].vision===true));
});

test('vision JSON edits automatically return screenshots for iterative corrections',async()=>{
  let captures=0;const sent=[],replies=[{content:'好的，我准备画图。\n```flowsketch\n{"operations":[]}\n```'},{content:'调整间距。\n```flowsketch\n{"operations":[]}\n```'},{content:'检查完成'}];
  const h=harness({...configured,vision:true},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return replies.shift();},()=>({}),[100,100],{capture:async()=>fakeScreenshot(++captures)});
  await h.send();assert.equal(h.calls.length,3);assert.equal(h.applications.length,2);assert.equal(captures,3);
  assert.deepEqual(sent.map(transmittedImages),[1,2,3].map(n=>[fakeScreenshot(n).url]));
  assert.equal(h.timers.length,1);assert.equal(h.get('aiStatus').textContent,'已应用 2 批修改');
});

test('screenshots are never reference assets and only the latest survives history; disabling vision removes them',async()=>{
  let captures=0;const sent=[];
  const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return{content:'已查看'};},()=>({}),[100,100],{capture:async()=>fakeScreenshot(++captures)});
  await h.send('first');await h.send('second');
  assert.deepEqual(transmittedImages(sent[1]),[fakeScreenshot(2).url]);
  assert.equal(h.instructions[1][2].length,0);
  h.get('aiVision').checked=false;h.get('aiVision').emit('input');await h.send('text only');
  assert.equal(captures,2);assert.deepEqual(transmittedImages(sent[2]),[]);
  assert.ok(!h.calls[2].tools.some(t=>t.function.name==='view_canvas'));
});

test('reference images stay available while stale canvas screenshots are pruned',async()=>{
  let captures=0;const sent=[];
  const h=harness({...configured,vision:true},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return{content:'检查完成'};},()=>({}),[100,100],{capture:async()=>fakeScreenshot(++captures)});
  await h.addImage();await h.send('reference');await h.send('continue');
  assert.deepEqual(transmittedImages(sent[1]),['data:image/jpeg;base64,test',fakeScreenshot(2).url]);
  assert.equal(h.instructions[1][2].length,1);
  assert.match(h.instructions[1][2][0].assetId,/^ref_/);
});

test('screenshot failures do not roll back JSON edits and never claim screenshot review',async()=>{
  const h=harness({...configured,vision:true},async()=>({content:'```flowsketch\n{"operations":[]}\n```'}));
  await h.send();assert.equal(h.applications.length,1);assert.equal(h.calls.length,1);
  assert.match(h.notices(),/截图生成失败/);assert.match(h.get('aiStatus').textContent,/已应用 1 批修改 · 截图检查未完成/);
  assert.equal(transmittedImages(h.calls[0].messages).length,0);
});

test('view requests with unsupported vision or nonempty arguments return an error without applying edits',async()=>{
  for(const [vision,args] of [[false,'{}'],[true,'{"anything":1}'],[true,'null'],[true,'[]']]){
    let round=0,captures=0;const sent=[];
    const h=harness({...configured,vision,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return++round===1?viewReply('bad',args):{content:'结束'};},()=>({}),[100,100],{capture:async()=>fakeScreenshot(++captures)});
    await h.send();assert.equal(h.applications.length,0);assert.equal(captures,vision?1:0);
    const result=JSON.parse(sent[1].find(m=>m.role==='tool').content);assert.match(result.error,/未启用|工具定义/);
  }
});

test('snapshot attempts are bounded at four and tool rounds share the existing eight-round limit',async()=>{
  let captures=0,round=0;const sent=[];
  const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return viewReply('view'+(++round));},()=>({}),[100,100],{capture:async()=>fakeScreenshot(++captures)});
  await h.send();assert.equal(captures,4);assert.equal(h.calls.length,8);assert.equal(h.applications.length,0);assert.equal(h.timers.length,1);
  assert.ok(sent.slice(4).some(messages=>messages.some(m=>m.role==='tool'&&JSON.parse(m.content).error?.includes('4 次'))));
  assert.match(h.notices(),/次数上限/);
});

test('manual stop, document switching and total timeout during capture prevent any API transmission',async()=>{
  for(const kind of ['stop','document','timeout']){
    const h=harness({...configured,vision:true,timeoutSeconds:300},async()=>({content:'结束'}),()=>({}),[100,100],{capture:(_expected,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))});
    const pending=h.send();await new Promise(resolve=>setImmediate(resolve));
    if(kind==='stop')h.get('aiStop').onclick();else if(kind==='document')h.documentEvent('flowsketch:document-transition');else h.timers[0].callback();
    await pending;assert.equal(h.calls.length,0);assert.equal(h.applications.length,0);assert.equal(h.get('aiPrompt').disabled,false);
    assert.deepEqual(h.clearedIntervals,[h.intervals[0]]);assert.match(h.notices(),kind==='timeout'?/超过 300 秒/:kind==='document'?/切换文件/:/已停止生成/);
  }
});

test('stale capture is discarded before screenshot display or API transmission',async()=>{
  let fingerprint='same';
  const h=harness({...configured,vision:true},async()=>({content:'结束'}),()=>({}),[100,100],{fingerprint:()=>fingerprint,capture:async()=>{fingerprint='changed';return fakeScreenshot(1);}});
  await h.send();assert.equal(h.calls.length,0);assert.equal(h.applications.length,0);assert.match(h.notices(),/画布已变化/);assert.doesNotMatch(h.notices(),/已发送画布截图/);
});


test('successful tools edits drop stale screenshots when capture fails or exhausts the budget',async()=>{
  for(const exhaust of [false,true]){
    let captures=0;const sent=[],replies=exhaust?[viewReply('v1'),viewReply('v2'),viewReply('v3'),editReply('edit'),{content:'结束'}]:[editReply('edit'),{content:'结束'}];
    const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return replies.shift();},()=>({}),[100,100],{capture:async()=>{if(!exhaust&&++captures===2)throw Error('failed');return fakeScreenshot(exhaust?++captures:captures);}});
    await h.send();assert.equal(h.applications.length,1);assert.deepEqual(transmittedImages(sent.at(-1)),[]);assert.equal(captures,exhaust?4:2);
    assert.match(h.notices(),exhaust?/4 次截图尝试上限/:/截图生成失败/);
  }
});


test('selected element references survive deselection, deduplicate and send IDs with the user request',async()=>{
  let snapshot={elements:[{id:'a',text:'节点 A'},{id:'b',text:'节点 B'}],selection:['a','b','a','missing']};
  const h=harness(configured,async()=>({content:'完成'}),()=>({}),[100,100],{snapshot:()=>snapshot});
  assert.equal(h.get('aiSendSelection').hidden,false);assert.match(h.get('aiSendSelection').textContent,/2 个/);
  h.get('aiSendSelection').onclick();assert.equal(h.get('aiTargets').children.length,2);
  snapshot.selection=[];h.documentEvent('flowsketch:selection-change');assert.equal(h.get('aiSendSelection').hidden,true);assert.equal(h.get('aiTargets').hidden,false);
  await h.send('改成红色');const user=h.calls[0].messages.find(m=>m.role==='user');assert.match(user.content,/\["a","b"\]/);assert.match(user.content,/改成红色/);assert.equal(h.get('aiTargets').hidden,true);
});
test('deleted targets are pruned and file transitions clear references before another request',async()=>{
  let snapshot={elements:[{id:'a'},{id:'b'}],selection:['a','b']};
  const h=harness(configured,async()=>({content:'完成'}),()=>({}),[100,100],{snapshot:()=>snapshot});
  h.get('aiSendSelection').onclick();snapshot.elements=[{id:'b'}];h.documentEvent('flowsketch:selection-change');assert.equal(h.get('aiTargets').children.length,1);
  h.documentEvent('flowsketch:document-transition');assert.equal(h.get('aiTargets').hidden,true);assert.equal(h.get('aiSendSelection').hidden,true);
  await h.send('下一条');assert.doesNotMatch(h.calls[0].messages.find(m=>m.role==='user').content,/明确指定/);
});
test('empty initial canvas skips image work and empty view returns text metadata; first drawing still gets feedback',async()=>{
  let snapshot={elements:[],selection:[]},step=0,captures=0;
  const sent=[],h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return[viewReply('empty'),editReply('draw'),{content:'完成'}][step++];},()=>{snapshot={elements:[{id:'new'}]};return{};},[100,100],{snapshot:()=>snapshot,capture:async()=>fakeScreenshot(++captures)});
  await h.send();assert.equal(captures,1);assert.deepEqual(sent.map(transmittedImages),[[],[],[fakeScreenshot(1).url]]);
  const view=JSON.parse(sent[1].find(m=>m.role==='tool').content);assert.equal(view.empty,true);assert.equal(view.screenshotAttached,false);assert.match(view.message,/目前画布空白/);
});
test('activity stays visible after preamble and during screenshot review, then clears on success, error and stop',async()=>{
  for(const outcome of ['success','error','stop']){
    let finish,fail;const h=harness(configured,options=>{options.onDelta('好的','好的，我准备绘制。');return new Promise((resolve,reject)=>{finish=resolve;fail=reject;options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});});
    const send=h.send();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.get('aiActivity').hidden,false);assert.match(h.get('aiActivityText').textContent,/准备绘制/);assert.equal(h.get('aiSendSelection').disabled,true);
    if(outcome==='success')finish({content:'完成'});else if(outcome==='error')fail(Error('failed'));else h.get('aiStop').onclick();
    await send;assert.equal(h.get('aiActivity').hidden,true);
  }
});


test('retry from another file cannot restore element IDs even when the new file has identical IDs',async()=>{
  let snapshot={fileId:'old',elements:[{id:'a',text:'OLD'}],selection:['a']};
  const h=harness(configured,async()=>{throw Error('failed');},()=>({}),[100,100],{snapshot:()=>snapshot});
  h.get('aiSendSelection').onclick();await h.send('改成红色');const retry=h.get('aiMessages').lastElementChild.lastElementChild;
  snapshot={fileId:'new',elements:[{id:'a',text:'NEW'}],selection:[]};h.documentEvent('flowsketch:document-change');retry.onclick();assert.equal(h.get('aiTargets').hidden,true);assert.match(h.notices(),/来自其他文件/);
});


test('explicit targets request regional snapshots before and after editing while an explicit empty view requests the full canvas',async()=>{
  const sent=[],replies=[editReply('edit'),viewReply('full'),{content:'完成'}];
  const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return replies.shift();},()=>({}),[100,100],{snapshot:()=>({elements:[{id:'a'}],selection:['a']}),capture:async (_expected,options)=>({...fakeScreenshot(1),region:options.elementIds.length?{x:100,y:100,w:200,h:150}:{x:0,y:0,w:1600,h:1000}})});
  h.get('aiSendSelection').onclick();await h.send('调整指定元素');assert.deepEqual(h.captures.map(c=>Array.from(c[1].elementIds)),[['a'],['a'],[]]);
  const metadata=JSON.parse(sent[2].find(m=>m.role==='tool'&&m.tool_call_id==='full').content);assert.equal(metadata.crop.w,1600);
  assert.ok(sent.every(turn=>transmittedImages(turn).length===1));assert.match(h.notices(),/画布局部图/);
});
test('model requested reference crops replace full-image pixels and report original coordinate metadata',async()=>{
  const region={x:20,y:10,w:30,h:20},sent=[];let n=0;
  const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return n++?{content:'完成'}:{content:'查看参考局部',tool_calls:[{id:'crop',function:{name:'view_reference',arguments:JSON.stringify({assetId:'ref_1',region})}}]};},()=>({}),[100,80],{snapshot:()=>({elements:[]})});
  await h.addImage();await h.send('查看图中局部');assert.equal(h.captures.length,0);assert.equal(transmittedImages(sent[0]).length,1);assert.deepEqual(transmittedImages(sent[1]),['data:image/png;base64,crop']);
  const metadata=JSON.parse(sent[1].find(m=>m.role==='tool').content);assert.equal(metadata.reference.sourceWidth,100);assert.deepEqual(metadata.reference.region,region);assert.equal(metadata.reference.assetId,'ref_1');assert.equal(JSON.stringify(metadata).includes('base64'),false);
});
test('focused follow-up omits historical reference pixels but retains trusted IDs for on-demand viewing',async()=>{
  let snapshot={elements:[]},sent=[];
  const h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return{content:'完成'};},()=>({}),[100,80],{snapshot:()=>snapshot,capture:async()=>fakeScreenshot(1)});
  await h.addImage();await h.send('原参考图');snapshot={elements:[{id:'a'}],selection:['a']};h.get('aiSendSelection').onclick();await h.send('只调整元素');assert.deepEqual(transmittedImages(sent[1]),[fakeScreenshot(1).url]);assert.equal(h.instructions.at(-1)[2][0].assetId,'ref_1');
});
test('manual crop replaces the pending original and passes only cropped pixels and dimensions',async()=>{
  const sent=[],h=harness({...configured,vision:true},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return{content:'完成'};},()=>({}),[100,80],{snapshot:()=>({elements:[]})});
  await h.addImage();const preview=h.get('aiAttachments').children[0].children[0].previewOptions;
  assert.equal(preview.canCrop(),true);preview.onCrop({url:'data:image/png;base64,local',width:20,height:10,region:{x:20,y:10,w:20,h:10},sourceWidth:100,sourceHeight:80});
  await h.send('按照局部绘制');assert.deepEqual(transmittedImages(sent[0]),['data:image/png;base64,local']);assert.match(sent[0].find(m=>m.role==='user').content[0].text,/ref_2.*20×10/);assert.equal(h.instructions[0][2][0].width,20);
});


test('two reference crops in the same assistant batch both reach the next API request',async()=>{
  let step=0;const sent=[],h=harness({...configured,vision:true,mode:'tools'},async options=>{sent.push(JSON.parse(JSON.stringify(options.messages)));return step++?{content:'完成'}:{content:'查看两处',tool_calls:[10,40].map((x,i)=>({id:'crop'+i,function:{name:'view_reference',arguments:JSON.stringify({assetId:'ref_1',region:{x,y:0,w:20,h:20}})}}))};},()=>({}),[100,80],{snapshot:()=>({elements:[]}),crop:(img,region)=>({url:'data:image/png;base64,local'+region.x,width:20,height:20,sourceWidth:100,sourceHeight:80,region})});
  await h.addImage();await h.send('比较两个区域');assert.deepEqual(transmittedImages(sent[1]),['data:image/png;base64,local10','data:image/png;base64,local40']);
});

test('relay connection preferences persist while the startup token remains session-only', async () => {
  const h = harness({...configured,connection:'local',relayUrl:'http://127.0.0.1:19999',relayToken:'old-token'});
  assert.equal(h.get('aiConnection').value,'local');
  assert.equal(h.get('aiRelayUrl').value,'http://127.0.0.1:19999');
  assert.equal(h.get('aiRelayToken').value,'');
  h.get('aiRelayToken').value='new-token';h.get('aiRelayToken').emit('input');
  const saved = JSON.parse(h.stored.get(storageKey));
  assert.equal(saved.connection,'local');
  assert.equal('relayToken' in saved,false);
  await h.send();
  assert.equal(h.calls[0].config.relayToken,'new-token');
  h.get('aiForget').onclick();
  assert.equal(h.get('aiRelayToken').value,'');
  assert.equal(h.get('aiConnection').value,'direct');
});

test('CORS failure offers local setup and preserves original retry content without auto-resending', async () => {
  let guides = 0;
  const h = harness(configured, async () => { const error = Error('possible CORS');error.code='NETWORK_OR_CORS';throw error; },undefined,undefined,{openRelayHelp:()=>guides++});
  await h.send('keep my request');
  const failure = h.get('aiMessages').lastElementChild;
  const setup = failure.children.find(child=>child.textContent==='使用本地转发');
  assert.ok(setup);
  setup.onclick();
  assert.equal(h.get('aiConnection').value,'local');
  assert.equal(h.get('aiRelaySettings').hidden,false);
  assert.equal(h.get('aiSettings').open,true);
  assert.equal(guides,1);
  assert.equal(h.calls.length,1);
  failure.children.find(child=>child.textContent==='重新发送这条消息').onclick();
  assert.equal(h.get('aiPrompt').value,'keep my request');
});

test('relay health checks run only on user action and do not send a model request', async () => {
  let healthCalls=0;
  const h = harness({...configured,connection:'local'},undefined,undefined,undefined,{checkRelay:async config=>{
    healthCalls++;assert.equal(config.relayToken,'session-token');
  }});
  assert.equal(healthCalls,0);
  h.get('aiRelayToken').value='session-token';
  await h.get('aiRelayTest').onclick();
  assert.equal(healthCalls,1);
  assert.equal(h.calls.length,0);
  assert.match(h.get('aiRelayStatus').textContent,/连接成功/);
  assert.equal(h.get('aiRelayTest').disabled,false);
});

test('editing relay configuration cancels a stale in-flight connection test', async () => {
  let signal, release;
  const pendingHealth = new Promise(resolve=>{release=resolve;});
  const h = harness({...configured,connection:'local'},undefined,undefined,undefined,{checkRelay:async (_config, checkSignal)=>{
    signal=checkSignal;await pendingHealth;
  }});
  h.get('aiRelayToken').value='first-token';
  const check = h.get('aiRelayTest').onclick();
  assert.equal(h.get('aiRelayTest').disabled,true);
  h.get('aiRelayToken').value='changed-token';h.get('aiRelayToken').emit('input');
  assert.equal(signal.aborted,true);
  assert.equal(h.get('aiRelayTest').disabled,false);
  release();await check;
  assert.equal(h.get('aiRelayStatus').textContent,'');
});
