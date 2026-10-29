'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/js/canvas-capture.js'),'utf8');
const PNG='data:image/png;base64,iVBORw0KGgo=';
class Element{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.style={};this.parentNode=null;this.className='';this.classList={remove:(...names)=>{this.className=this.className.split(' ').filter(n=>!names.includes(n)).join(' ')}}}
  set id(x){this.attributes.id=x}get id(){return this.attributes.id||''}
  append(n){n.parentNode=this;this.children.push(n)}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null}}
  setAttribute(k,v){this.attributes[k]=v}getAttribute(k){return k==='class'?this.className:this.attributes[k]??null}removeAttribute(k){delete this.attributes[k]}
  cloneNode(){const n=new Element(this.tagName,this.ownerDocument);n.attributes={...this.attributes};n.className=this.className;n.style={...this.style};this.children.forEach(c=>n.append(c.cloneNode(true)));return n}
  querySelectorAll(selector){const sels=selector.split(',');return this.children.flatMap(c=>[...(sels.some(s=>s==='*'||s===c.tagName||s.startsWith('.')&&c.className.split(' ').includes(s.slice(1))||s.startsWith('[')&&Object.hasOwn(c.attributes,s.slice(1,-1)))?[c]:[]),...c.querySelectorAll(selector)])}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
}
function harness(render){
  const doc={createElement:t=>new Element(t,doc),fonts:{ready:Promise.resolve()}};doc.body=new Element('body',doc);doc.getElementById=id=>doc.body.querySelectorAll('*').find(n=>n.id===id);
  const window={html2canvas:async(el,options)=>{const o={x:0,y:0,...options};return render?render(el,o):{width:Math.floor(o.width*o.scale),height:Math.floor(o.height*o.scale),toDataURL:()=>PNG}}};doc.defaultView=window;
  vm.runInNewContext(source,{window});
  const canvas=new Element('div',doc);canvas.id='canvas';canvas.className='canvas grid dots';canvas.style={transform:'scale(.3)',boxShadow:'original'};doc.body.append(canvas);
  return{doc,canvas,capture:window.FlowSketchCanvasCapture.capture,options:{canvas,width:4000,height:2000,background:'#fafafa'}};
}
test('offscreen clone preserves original DOM, transform and SVG ids; removes editor chrome',async()=>{
  let observed;const h=harness(async(holder,options)=>{observed=holder;const copy=holder.children[0];assert.equal(copy.id,'');assert.equal(copy.className,'canvas');assert.equal(copy.style.transform,'none');assert.equal(copy.style.backgroundImage,'none');assert.equal(copy.style.overflow,'hidden');assert.equal(copy.querySelectorAll('.handle,.connector-guide,.marquee').length,0);assert.equal(copy.children[0].id,'arrow-start-object');assert.equal(copy.children[0].getAttribute('contenteditable'),'false');assert.equal(holder.parentNode,h.doc.body);assert.equal(options.useCORS,false);assert.equal(options.scrollX,0);assert.equal(options.scrollY,0);return{width:1600,height:800,toDataURL:()=>PNG}});
  for(const name of ['handle','connector-guide','marquee']){const n=h.doc.createElement('div');n.className=name;h.canvas.append(n)}
  const shape=h.doc.createElement('div');shape.id='arrow-start-object';shape.setAttribute('contenteditable','true');h.canvas.append(shape);
  const before=JSON.stringify(h.canvas.style),result=await h.capture(h.options);
  assert.equal(result.url,PNG);assert.equal(result.width,1600);assert.equal(result.canvasWidth,4000);assert.equal(result.height,800);assert.equal(JSON.stringify(h.canvas.style),before);assert.equal(h.canvas.children.length,4);assert.equal(shape.getAttribute('contenteditable'),'true');assert.equal(observed.parentNode,null);assert.equal(h.doc.body.children.length,1);
});
test('rejects invalid size/content and unavailable renderer before prepare',async()=>{
  const h=harness();let prepared=false;
  for(const width of [0,NaN,Infinity,40000])await assert.rejects(h.capture({...h.options,width,prepare:()=>{prepared=true}}),/尺寸/);
  assert.equal(prepared,false);h.canvas.ownerDocument.defaultView.html2canvas=null;await assert.rejects(h.capture(h.options),/组件/);
});
test('omitted region captures the full canvas with coordinate metadata',async()=>{
  let options;const h=harness(async(holder,o)=>{options=o;return{width:1600,height:800,toDataURL:()=>PNG}});
  const result=await h.capture(h.options);
  assert.equal(options.x,0);assert.equal(options.y,0);assert.equal(options.width,4000);assert.equal(options.height,2000);assert.equal(options.scale,.4);
  assert.deepEqual(JSON.parse(JSON.stringify(result.region)),{x:0,y:0,w:4000,h:2000});assert.equal(result.canvasWidth,4000);assert.equal(result.canvasHeight,2000);
});
test('small region uses 1:1 capture while retaining the full clone layout',async()=>{
  let observed;const region={x:3100,y:1200,w:800,h:600};
  const h=harness(async(holder,o)=>{observed=o;assert.equal(holder.style.width,'4000px');assert.equal(holder.style.height,'2000px');assert.equal(holder.children[0].style.width,'4000px');assert.equal(holder.children[0].style.height,'2000px');assert.equal(holder.children[0].style.left,'0');assert.equal(holder.children[0].style.top,'0');return{width:o.width,height:o.height,toDataURL:()=>PNG}});
  const result=await h.capture({...h.options,region});
  assert.equal(observed.x,3100);assert.equal(observed.y,1200);assert.equal(observed.width,800);assert.equal(observed.height,600);assert.equal(observed.scale,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.region)),region);assert.equal(result.width,800);assert.equal(result.height,600);assert.equal(result.canvasWidth,4000);assert.equal(result.canvasHeight,2000);assert.equal(h.doc.body.children.length,1);
  region.x=0;assert.equal(result.region.x,3100,'metadata must snapshot the requested region');
});
test('large and fractional regions scale based on their own longest edge',async()=>{
  const h=harness(),region={x:10.5,y:5.25,w:3200,h:1800};const result=await h.capture({...h.options,region});
  assert.equal(result.width,1600);assert.equal(result.height,900);assert.deepEqual(JSON.parse(JSON.stringify(result.region)),region);
  const edge=await h.capture({...h.options,region:{x:3999,y:1999,w:1,h:1}});assert.equal(edge.width,1);assert.equal(edge.height,1);
});
test('invalid region shapes, fields and bounds fail before preparation or rendering',async()=>{
  let renders=0,prepares=0;const h=harness(()=>{renders++});const valid={x:0,y:0,w:100,h:100};
  const inherited=Object.create(valid);const symbolField={...valid,[Symbol('extra')]:1};
  const invalid=[null,'all',[],[0,0,100,100],{},inherited,{...valid,extra:true},symbolField,{x:0,y:0,w:100},{...valid,x:'0'},{...valid,x:NaN},{...valid,y:Infinity},{...valid,w:NaN},{...valid,h:Infinity},{...valid,x:-1},{...valid,y:-1},{...valid,w:0},{...valid,h:.5},{...valid,x:3950},{...valid,y:1950},{...valid,w:4001},{...valid,h:2001}];
  for(const region of invalid)await assert.rejects(h.capture({...h.options,region,prepare:()=>{prepares++}}),/区域/);
  assert.equal(prepares,0);assert.equal(renders,0);assert.equal(h.doc.body.children.length,1);
});
test('region is snapshotted before asynchronous preparation',async()=>{
  const region={x:20,y:30,w:100,h:80};let observed;const h=harness(async(holder,o)=>{observed=o;return{width:o.width,height:o.height,toDataURL:()=>PNG}});
  const result=await h.capture({...h.options,region,prepare:()=>{region.x=999;region.w=300}});
  assert.equal(observed.x,20);assert.equal(observed.width,100);assert.equal(result.region.x,20);assert.equal(result.region.w,100);
});
test('remote unprepared image fails without renderer or mutating its src',async()=>{
  let called=false;const h=harness(()=>{called=true});const img=h.doc.createElement('img');img.setAttribute('src','https://untrusted.invalid/picture');h.canvas.append(img);
  await assert.rejects(h.capture(h.options),/本地资源/);assert.equal(called,false);assert.equal(img.getAttribute('src'),'https://untrusted.invalid/picture');assert.equal(h.doc.body.children.length,1);
});
test('assertCurrent runs before and after preparation and rendering; stale render never encodes',async()=>{
  let stale=false,checks=0,encoded=false;const h=harness(async()=>{stale=true;return{width:100,height:100,toDataURL:()=>{encoded=true;return PNG}}});
  await assert.rejects(h.capture({...h.options,assertCurrent:()=>{checks++;if(stale)throw Error('stale')}}),/stale/);
  assert.ok(checks>=8);assert.equal(encoded,false);assert.equal(h.doc.body.children.length,1);
});
test('abort while region renderer pending rejects immediately and cleans holder, including late resolve',async()=>{
  let resolveRender,started;const ready=new Promise(r=>{started=r});const h=harness(()=>{started();return new Promise(r=>{resolveRender=r})});const abort=new AbortController();
  const pending=h.capture({...h.options,region:{x:400,y:300,w:500,h:400},signal:abort.signal});await ready;assert.equal(h.doc.body.children.length,2);abort.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(h.doc.body.children.length,1);
  let encoded=false;resolveRender({width:100,height:100,toDataURL:()=>{encoded=true;return PNG}});await Promise.resolve();assert.equal(encoded,false);
});
test('abort during prepare prevents clone and renderer',async()=>{
  let prepareStarted,finish;const started=new Promise(r=>{prepareStarted=r});let renders=0;const h=harness(()=>{renders++});const c=new AbortController();const p=h.capture({...h.options,signal:c.signal,prepare:()=>{prepareStarted();return new Promise(r=>{finish=r})}});
  await started;c.abort();await assert.rejects(p,{name:'AbortError'});finish();assert.equal(renders,0);assert.equal(h.doc.body.children.length,1);
});
test('renderer exceptions and malformed/oversize encodings clean up',async()=>{
  const h=harness(async()=>{throw Error('renderer failed')});await assert.rejects(h.capture(h.options),/renderer failed/);assert.equal(h.doc.body.children.length,1);
  for(const url of ['data:,','data:image/png;base64,SGVsbG8=',PNG.replace('=','!'),'data:image/jpeg;base64,iVBORw0KGgo=']){const x=harness(async()=>({width:100,height:100,toDataURL:()=>url}));await assert.rejects(x.capture(x.options),/编码/);assert.equal(x.doc.body.children.length,1)}
});
test('oversize PNG falls back to bounded JPEG, exhausted compression rejects',async()=>{
  const huge='data:image/png;base64,iVBORw0KGgo'+ 'A'.repeat(12*1024*1024-11);let calls=[];
  const h=harness(async()=>({width:100,height:100,toDataURL:(type,q)=>{calls.push([type,q]);return type==='image/png'?huge:'data:image/jpeg;base64,/9j/AAAA'}}));
  const result=await h.capture(h.options);assert.match(result.url,/^data:image\/jpeg/);assert.equal(calls[1][1],.9);
  const x=harness(async()=>({width:100,height:100,toDataURL:()=>huge}));await assert.rejects(x.capture(x.options),/大小限制/);assert.equal(x.doc.body.children.length,1);
});
test('concurrent captures own cleanup and onclone only keeps current holder',async()=>{
  const resolvers=[];let cloned=true;const h=harness((holder,o)=>{const shadow={body:h.doc.body.cloneNode(true)};shadow.getElementById=id=>shadow.body.querySelectorAll('*').find(n=>n.id===id);o.onclone(shadow);assert.equal(shadow.body.children.length,1);assert.equal(shadow.body.children[0].id,holder.id);assert.equal(shadow.body.children[0].style.left,'0');cloned=false;return new Promise(resolve=>resolvers.push(resolve))});
  const a=h.capture(h.options),b=h.capture(h.options);while(resolvers.length<2)await new Promise(resolve=>setImmediate(resolve));assert.equal(h.doc.body.children.length,3);resolvers[0]({width:100,height:100,toDataURL:()=>PNG});await a;assert.equal(h.doc.body.children.length,2);resolvers[1]({width:100,height:100,toDataURL:()=>PNG});await b;assert.equal(h.doc.body.children.length,1);assert.equal(cloned,false);
});
test('SVG rasterization preserves clip references and inherited paint without changing original SVG',async()=>{
  let serialized,decoded=0;const h=harness(async(holder)=>{const img=holder.children[0].querySelector('img');assert.match(img.getAttribute('src'),/^data:image\/svg\+xml/);assert.equal(img.style.width,'4000px');return{width:1600,height:800,toDataURL:()=>PNG}});
  const win=h.doc.defaultView;win.getComputedStyle=svg=>{let parent=svg;while(parent.parentNode)parent=parent.parentNode;assert.equal(parent,h.doc.body,'SVG styles need attached layout');return({width:'4000px',height:'2000px',position:'absolute',left:'0px',top:'0px',display:'block',color:'rgb(20,30,40)',fill:'rgb(20,30,40)',zIndex:'4'})};win.XMLSerializer=class{serializeToString(svg){serialized=svg;return '<svg xmlns="http://www.w3.org/2000/svg"><clipPath id="original-clip"/><path clip-path="url(#original-clip)"/></svg>'}};
  const create=h.doc.createElement;h.doc.createElement=tag=>{const n=create(tag);if(tag==='img')n.decode=async()=>{decoded++};return n};
  Element.prototype.replaceWith=function(other){const parent=this.parentNode,index=parent.children.indexOf(this);parent.children[index]=other;other.parentNode=parent;this.parentNode=null};
  const svg=create('svg');svg.className='connector-svg';svg.setAttribute('width','4000');svg.setAttribute('height','2000');const path=create('path');path.setAttribute('clip-path','url(#original-clip)');svg.append(path);h.canvas.append(svg);
  await h.capture(h.options);assert.equal(serialized.children[0].getAttribute('clip-path'),'url(#original-clip)');assert.equal(serialized.style.color,'rgb(20,30,40)');assert.equal(decoded,1);assert.equal(svg.parentNode,h.canvas);assert.equal(svg.tagName,'svg');
});
test('renderer clone iframe is removed after renderer throws',async()=>{
  const frame={removed:false,remove(){this.removed=true}};const h=harness(async(holder,o)=>{const shadow={body:h.doc.body.cloneNode(true),defaultView:{frameElement:frame}};shadow.getElementById=id=>shadow.body.querySelectorAll('*').find(n=>n.id===id);o.onclone(shadow);throw Error('render failure')});
  await assert.rejects(h.capture(h.options),/render failure/);assert.equal(frame.removed,true);assert.equal(h.doc.body.children.length,1);
});
