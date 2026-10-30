'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const relay = require('../assets/js/ai-relay-help.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../tools/local-relay/server.py'), 'utf8');

test('OS detection prefers client hints and handles desktop and mobile platforms', () => {
  assert.equal(relay.detectOS({userAgentData:{platform:'Windows'}, platform:'MacIntel'}), 'windows');
  assert.equal(relay.detectOS({platform:'MacIntel'}), 'macos');
  assert.equal(relay.detectOS({platform:'Linux x86_64'}), 'linux');
  assert.equal(relay.detectOS({platform:'Linux',userAgent:'Android'}), 'other');
  assert.equal(relay.detectOS({platform:'MacIntel',maxTouchPoints:5}), 'other');
  assert.equal(relay.detectOS({userAgent:'something unknown'}), 'other');
});
test('origin accepts exact web origins and file null, rejects shell metacharacters and URL paths', () => {
  for (const origin of ['http://localhost:8000','https://example.com','http://[::1]:8000','null']) assert.equal(relay.originValue(origin),origin);
  for (const origin of ['https://example.com/','https://user:pass@example.com','https://example.com/a','javascript:alert(1)',"https://evil'host",'https://example.com;whoami','https://example.com\n','https://example.com?x=1']) assert.throws(() => relay.originValue(origin));
});
test('manual commands use native Windows and Node downloads, with exact Python source on stdin', () => {
  const unix = relay.commands('macos','https://example.com',source);
  assert.equal(unix.primary,"node ./server.cjs --origin 'https://example.com'");
  assert.equal(unix.paste,"python3 - --origin 'https://example.com' <<'FLOWSKETCH_RELAY_PY'\n"+source+'\nFLOWSKETCH_RELAY_PY');
  const windows = relay.commands('windows','null',source);
  assert.equal(windows.primary,"powershell -NoProfile -ExecutionPolicy Bypass -File .\\server.ps1 --origin 'null'");
  assert.equal(windows.paste,"@'\n"+source+"\n'@ | py -3 - --origin 'null'");
  assert.equal(windows.python,"py -3 ./server.py --origin 'null'");
  assert.doesNotMatch(unix.paste, /curl|wget|Invoke-WebRequest/);
});
test('source validation rejects HTML, oversized source and shell delimiter collisions', () => {
  assert.equal(relay.validateSource(source), source);
  for(const value of ['<html>error</html>','#!/usr/bin/env python3\n'+'x'.repeat(65536),'#!/usr/bin/env python3\nFLOWSKETCH_RELAY_PY\n',"#!/usr/bin/env python3\n'@\n"]) assert.throws(() => relay.validateSource(value));
});
test('source loader is lazy, private, same-origin, deduplicated and cached', async () => {
  const calls=[];
  const load = relay.sourceLoader(async (...args) => {calls.push(args); return {ok:true,headers:{get:()=>null},text:async()=>source};},'https://example.com/app/index.html');
  assert.equal(calls.length,0);
  const [a,b] = await Promise.all([load(),load()]);
  assert.equal(a,source); assert.equal(b,source);
  assert.deepEqual(calls, [['https://example.com/app/tools/local-relay/server.py',{credentials:'omit',redirect:'error',mode:'same-origin'}]]);
  assert.equal(await load(),source); assert.equal(calls.length,1);
});
test('source errors allow retry and file pages never fetch', async () => {
  let calls=0;
  const load=relay.sourceLoader(async()=>{calls++;return {ok:calls>1,text:async()=>source};},'https://example.com/');
  await assert.rejects(load()); assert.equal(await load(),source); assert.equal(calls,2);
  await assert.rejects(relay.sourceLoader(()=>{throw Error('must not fetch');},'file:///tmp/index.html')(), /直接下载/);
});
test('stream source limit cancels oversized downloads', async () => {
  let cancelled=false,released=false;
  const load=relay.sourceLoader(async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(65537)}),cancel:async()=>{cancelled=true;},releaseLock:()=>{released=true;}})}}),'https://example.com/');
  await assert.rejects(load(),/过大/); assert.ok(cancelled); assert.ok(released);
});
test('modal opens without fetching source, changes platform commands and restores focus on close', () => {
  const vm=require('node:vm');
  const elements=new Map();
  function element(id) {
    const attributes=new Map(),classes=new Set();
    return {id,attributes,textContent:'',value:'',dataset:{},isConnected:true,
      classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},contains:n=>classes.has(n)},
      getAttribute:key=>attributes.get(key)??null,setAttribute(key,value){attributes.set(key,value);},removeAttribute:key=>attributes.delete(key),
      focus(){document.activeElement=this;},addEventListener(){},removeEventListener(){},
      querySelector:()=>modal,querySelectorAll:()=>tabs, contains:()=>true};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  const document={getElementById:get,activeElement:null};
  const modal=element('dialog'),backdrop=get('modal'),tabs=['windows','macos','linux'].map(os=>{const el=get('relay-tab-'+os);el.dataset.os=os;return el;});
  const previous=element('opener');document.activeElement=previous;
  let calls=0,html,observer;
  const window={document,navigator:{platform:'Win32'},location:{href:'https://example.com/app/',origin:'https://example.com'},fetch:()=>{calls++;},MutationObserver:class{constructor(cb){this.cb=cb;observer=this;}observe(){}disconnect(){this.disconnected=true;}}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/js/ai-relay-help.js'),'utf8'),{window,URL});
  window.FlowSketchAIRelayHelp.open({show(title,body){html=body;backdrop.classList.add('show');},close(){backdrop.classList.remove('show');}});
  assert.equal(calls,0); assert.equal(modal.getAttribute('role'),'dialog');
  assert.equal(modal.getAttribute('aria-modal'),'true');
  assert.match(get('relay-command').textContent,/powershell/); assert.equal(document.activeElement,tabs[0]);
  tabs[1].onclick(); assert.match(get('relay-command').textContent,/node/);
  assert.match(html,/<textarea[^>]+readonly/); assert.match(html,/role="status"/);
  get('relay-close').onclick(); assert.equal(document.activeElement,previous);assert.ok(observer.disconnected);
  assert.equal(modal.getAttribute('role'),null); assert.equal(modal.classList.contains('relay-help-modal'),false);
});
