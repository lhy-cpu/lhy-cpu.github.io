'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const connectorPaint=require('../assets/js/connector-paint.js');
const arrowHelpers=html.slice(html.indexOf('  function connectorArrowDimensions('),html.indexOf('  function arrowMarkerSpec('));
function dropHarness(){
  const listeners=[],imported=[];let overlay=false;
  const context={previewMode:false,dragDepth:0,hasDraggedFiles:e=>e.dataTransfer.types.includes('Files'),
    document:{addEventListener:(type,fn,capture)=>listeners.push({type,fn,capture}),visibilityState:'visible'},window:{addEventListener(){}},
    $:()=>({classList:{add:()=>overlay=true,remove:()=>overlay=false}}),handleDroppedFiles:async files=>imported.push(files)};
  const start=html.indexOf('  function isAIDrop('),end=html.indexOf("  window.addEventListener('keydown'",start);
  vm.runInNewContext(html.slice(start,end),context);
  async function dispatch(type,ai){const event={target:{closest:()=>ai?{}:null},dataTransfer:{types:['Files'],files:['fixture.png']},preventDefault(){this.prevented=true}};
    for(const listener of listeners.filter(l=>l.type===type).sort((a,b)=>Number(Boolean(b.capture))-Number(Boolean(a.capture))))await listener.fn(event);return event}
  return {dispatch,imported,overlay:()=>overlay,context};
}
test('moving a canvas file drag into the AI panel clears the global overlay and never imports it',async()=>{
  const h=dropHarness();await h.dispatch('dragenter',false);assert.equal(h.overlay(),true);
  await h.dispatch('dragover',true);assert.equal(h.overlay(),false);assert.equal(h.context.dragDepth,0);
  await h.dispatch('drop',true);assert.equal(h.imported.length,0);
});
test('dropping outside AI retains native canvas import',async()=>{
  const h=dropHarness();await h.dispatch('dragenter',false);const e=await h.dispatch('drop',false);
  assert.equal(e.prevented,true);assert.deepEqual(h.imported,[['fixture.png']]);assert.equal(h.overlay(),false);
});
test('an open image modal prevents canvas undo and deletion shortcuts',()=>{
  const handlers={},calls=[];const start=html.indexOf("  window.addEventListener('keydown'"),end=html.indexOf("window.addEventListener('keyup'",start);
  vm.runInNewContext(html.slice(start,end),{window:{addEventListener:(type,fn)=>handlers[type]=fn},$:()=>({classList:{contains:()=>true}}),closeModal:()=>calls.push('close'),undo:()=>calls.push('undo'),remove:()=>calls.push('remove')});
  handlers.keydown({key:'z',ctrlKey:true});handlers.keydown({key:'Delete'});assert.deepEqual(calls,[]);
  handlers.keydown({key:'Escape'});assert.deepEqual(calls,['close']);
});
for(const change of ['undo','color'])test(`image export discards an async result after ${change}`,async()=>{
  const image={id:'one',type:'image',src:'original',transparentColor:'#ffffff',colorTolerance:24},cache=new WeakMap(),writes=[];
  let current=image,resolve;const pending=new Promise(r=>resolve=r);
  const context={project:{elements:[image]},imageExportSources:cache,el:()=>current,canvas:{querySelectorAll:()=>[{dataset:{id:'one'},querySelector:()=>({replaceChildren:()=>writes.push('write')})}]},window:{FlowSketchImages:{ensureSourceSize:async()=>{},prepareSource:()=>pending,createElement:()=>({})}}};
  const start=html.indexOf('  function imageExportKey('),end=html.indexOf('\n  async function exportPNG',start);
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  const operation=context.prepareImageExports();await Promise.resolve();
  if(change==='undo')current={...image};else image.transparentColor='#000000';
  resolve('processed-old-color');await assert.rejects(operation,/已变化/);
  assert.equal(cache.has(image),false);assert.deepEqual(writes,[]);
});
test('svgConnector exports decoupled userSpaceOnUse markers allowing thick lines with small arrows',()=>{
  const context={
    project:{canvas:{width:600,height:400}},window:{FlowSketchConnectorPaint:connectorPaint},
    connectorGeometry:(e,a,b)=>({vertices:[a,b],d:`M${a.x},${a.y} L${b.x},${b.y}`}),
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    points:e=>({a:{x:e.fromX,y:e.fromY},b:{x:e.toX,y:e.toY}}),
    pathData:(e,a,b)=>`M${a.x},${a.y} L${b.x},${b.y}`,
  };
  const markerSnippet=html.slice(html.indexOf('  function arrowMarkerSpec('),html.indexOf('  function renderConnector('));
  const svgConnSnippet=html.slice(html.indexOf('  function svgConnector('),html.indexOf('  function svgText('));
  vm.runInNewContext(arrowHelpers+'\n'+markerSnippet+'\n'+svgConnSnippet,context);

  const thickSmall={
    id:'conn1',
    fromX:10,fromY:20,toX:100,toY:20,
    stroke:'#1d4ed8',
    strokeWidth:12,
    arrowStartStyle:'none',
    arrowEndStyle:'triangle',
    arrowWidth:6,
    arrowLength:8,
  };
  const svg=context.svgConnector(thickSmall);
  assert.match(svg,/stroke-width="12"/);
  assert.match(svg,/markerUnits="userSpaceOnUse"/);
  assert.match(svg,/markerWidth="8"/);
  assert.match(svg,/markerHeight="6"/);
  assert.match(svg,/preserveAspectRatio="none"/);

  const clampedBoth={
    id:'conn2',
    fromX:0,fromY:0,toX:50,toY:50,
    stroke:'#000000',
    strokeWidth:2,
    arrowStartStyle:'circle',
    arrowEndStyle:'stealth',
    arrowWidth:2,
    arrowLength:150,
  };
  const clampedSvg=context.svgConnector(clampedBoth);
  assert.match(clampedSvg,/id="export-start-conn2"[^>]*markerWidth="100"[^>]*markerHeight="4"/);
  assert.match(clampedSvg,/id="export-end-conn2"[^>]*markerWidth="100"[^>]*markerHeight="4"/);
});
test('connector properties panel exposes arrowWidth/arrowLength inputs and clamped bindings',()=>{
  const rPropsStart=html.indexOf('  function renderProps(){');
  const rPropsEnd=html.indexOf("\n    if(e.type==='formula'){props.innerHTML",rPropsStart);
  const helpersStart=html.indexOf('  function rowText(');
  const helpersEnd=html.indexOf('  function alignSelection(',helpersStart);
  const bindPropsStart=html.indexOf('  function bindProps(){');
  const bindPropsEnd=html.indexOf('  function layerAction(',bindPropsStart);

  const connector={
    id:'conn1',
    type:'connector',
    route:'orthogonal',
    arrowStartStyle:'none',
    arrowEndStyle:'triangle',
    arrowWidth:14,
    arrowLength:18,
    stroke:'#1d4ed8',
    strokeWidth:4,
    dash:false,
  };
  const propsBox={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
  const ctx={
    selected:()=>connector,
    selection:['conn1'],
    props:propsBox,
    esc:s=>s,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    layerControls:()=>'',
    themeControls:()=>'',
    bindThemeControls:()=>{},
    bindProps:()=>{},
    $:()=>({onclick:null}),
    commit:()=>{},
    render:()=>{},
  };

  vm.runInNewContext(arrowHelpers+'\n'+html.slice(helpersStart,helpersEnd)+'\n'+html.slice(rPropsStart,rPropsEnd)+'}\nrenderProps();',ctx);
  assert.match(propsBox.innerHTML,/data-prop="arrowWidth"/);
  assert.match(propsBox.innerHTML,/data-prop="arrowLength"/);
  assert.match(propsBox.innerHTML,/支持粗线配小箭头/);
  const lineInput=propsBox.innerHTML.match(/<input[^>]*data-prop="strokeWidth"[^>]*>/)[0];
  assert.match(lineInput,/min="0"/);
  assert.doesNotMatch(lineInput,/\bmax=/);

  let committed=0,rendered=0;
  const inputWidth={dataset:{prop:'arrowWidth'},type:'number',value:'2',onchange:null};
  const inputLength={dataset:{prop:'arrowLength'},type:'number',value:'160',onchange:null};
  const bindCtx={
    selected:()=>connector,
    props:{querySelectorAll:sel=>sel==='[data-prop]'?[inputWidth,inputLength]:[]},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    commit:()=>{committed++;},
    render:()=>{rendered++;},
  };
  vm.runInNewContext(html.slice(bindPropsStart,bindPropsEnd)+'\nbindProps();',bindCtx);
  inputWidth.onchange();
  assert.equal(connector.arrowWidth,4);
  assert.equal(committed,1);
  assert.equal(rendered,1);

  inputLength.onchange();
  assert.equal(connector.arrowLength,100);
  assert.equal(committed,2);
  assert.equal(rendered,2);
});
test('connector line width accepts large values and rejects invalid values without committing',()=>{
  const connector={type:'connector',strokeWidth:30},input={dataset:{prop:'strokeWidth'},type:'number',value:'120'},calls=[];
  const context={selected:()=>connector,props:{querySelectorAll:s=>s==='[data-prop]'?[input]:[]},commit:()=>calls.push('commit'),render:()=>calls.push('render'),renderProps:()=>calls.push('props'),toast:()=>calls.push('toast')};
  vm.runInNewContext(html.slice(html.indexOf('  function bindProps(){'),html.indexOf('  function layerAction('))+'\nbindProps();',context);
  input.onchange();assert.equal(connector.strokeWidth,120);assert.deepEqual(calls,['commit','render']);
  for(const value of ['-1','Infinity','NaN']){calls.length=0;input.value=value;input.onchange();assert.equal(connector.strokeWidth,120);assert.deepEqual(calls,['toast','props'])}
});
test('SVG clips the painted shaft while its arrow carrier keeps the logical endpoint',()=>{
  const geometry={vertices:[{x:80,y:100},{x:450,y:100}],d:'M80,100 L450,100'};
  const context={project:{canvas:{width:600,height:400}},window:{FlowSketchConnectorPaint:connectorPaint},connectorGeometry:()=>geometry,points:()=>({a:geometry.vertices[0],b:geometry.vertices[1]}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
  vm.runInNewContext(arrowHelpers+'\n'+html.slice(html.indexOf('  function arrowMarkerSpec('),html.indexOf('  function renderConnector('))+'\n'+html.slice(html.indexOf('  function svgConnector('),html.indexOf('  function svgText(')),context);
  const svg=context.svgConnector({id:'join',stroke:'#0b315f',strokeWidth:30,arrowWidth:60,arrowLength:69,arrowStartStyle:'none',arrowEndStyle:'triangle'});
  assert.match(svg,/<clipPath[^>]*clipPathUnits="userSpaceOnUse"/);
  assert.match(svg,/<path d="M80,100 L450,100"[^>]*stroke-width="30"[^>]*clip-path="url\(#export-clip-join\)"/);
  assert.match(svg,/<path d="M80,100 L450,100" fill="none" stroke="none"[^>]*marker-end="url\(#export-end-join\)"/);
  const polygon=svg.match(/<clipPath[^>]*><polygon points="([^"]*)"/)[1].split(' ').map(pair=>Number(pair.split(',')[0]));
  assert.ok(Math.abs(Math.max(...polygon)-391.35)<1e-8);
});
test('PPTX scene preserves curved logical geometry and shares SVG clipping dimensions',async()=>{
  const e={type:'connector',stroke:'#123456',strokeWidth:120,arrowWidth:60,arrowLength:69,arrowStartStyle:'none',arrowEndStyle:'triangle',dash:true};
  const geometry={vertices:[{x:50,y:100},{x:70,y:100},{x:180,y:30},{x:350,y:180},{x:420,y:100},{x:450,y:100}],curve:{sa:{x:70,y:100},c1:{x:180,y:30},c2:{x:350,y:180},eb:{x:420,y:100}}};
  const context={project:{name:'test',canvas:{width:600,height:400,bg:'#ffffff'},elements:[e]},window:{FlowSketchConnectorPaint:connectorPaint},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),points:()=>({a:geometry.vertices[0],b:geometry.vertices.at(-1)}),connectorGeometry:()=>geometry};
  vm.runInNewContext(arrowHelpers+'\n'+html.slice(html.indexOf('  async function pptxScene(){'),html.indexOf('  function svgConnector(')),context);
  const scene=await context.pptxScene(),item=scene.items[0];
  assert.equal(item.type,'path');assert.equal(item.points,geometry.vertices);assert.equal(item.curve,geometry.curve);
  assert.equal(item.width,120);assert.equal(item.arrowLength,69);assert.equal(item.dash,true);
  assert.deepEqual(JSON.parse(JSON.stringify(item.clipPolygon)),connectorPaint.clipRegion(geometry,{startStyle:'none',endStyle:'triangle',arrowWidth:60,arrowLength:69,strokeWidth:120,width:600,height:400}));
});
test('connector selection renders independent length/width handles and guide lines',()=>{
  const rSelStart=html.indexOf('  function renderSelection(){');
  const rSelEnd=html.indexOf('  function renderAnchorPorts(',rSelStart);
  const connector={
    id:'conn1',
    type:'connector',
    fromX:10,fromY:20,
    toX:100,toY:20,
    route:'straight',
    arrowStartStyle:'open',
    arrowEndStyle:'triangle',
    arrowWidth:14,
    arrowLength:18,
  };
  const appended=[];
  const ctx={
    selection:['conn1'],
    el:id=>id==='conn1'?connector:null,
    project:{canvas:{snap:true}},
    interaction:null,
    canvas:{append:node=>appended.push(node)},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    points:e=>({a:{x:e.fromX,y:e.fromY},b:{x:e.toX,y:e.toY}}),
    connectorGeometry:(e,a,b)=>({vertices:[a,b]}),
    connectorGuide:(a,b,cls)=>appended.push({type:'guide',a,b,cls}),
    connectorControl:(e,q,kind,data,title)=>appended.push({type:'control',e,q,kind,data,title}),
    document:{createElement:tag=>({tagName:tag,classList:{add:()=>{}},style:{},dataset:{},addEventListener:()=>{}})},
    endpointDown:()=>{},
  };

  vm.runInNewContext(
    arrowHelpers+'\n'+
    html.slice(rSelStart,rSelEnd)+'\nrenderSelection();',
    ctx
  );

  const lenControls=appended.filter(n=>n.type==='control'&&n.kind==='arrow-len');
  const widControls=appended.filter(n=>n.type==='control'&&n.kind==='arrow-wid');
  const guides=appended.filter(n=>n.type==='guide'&&n.cls==='arrow-guide');

  assert.equal(lenControls.length,2);
  assert.equal(widControls.length,2);
  assert.equal(guides.length,2);

  const toLen=lenControls.find(c=>c.data.arrowEnd==='to');
  const toWid=widControls.find(c=>c.data.arrowEnd==='to');
  assert.equal(toLen.q.x,100-24);
  assert.equal(toLen.q.y,20);
  assert.match(toLen.title,/18px/);
  assert.equal(toWid.q.x,100-24);
  assert.equal(toWid.q.y,20+24);
  assert.match(toWid.title,/14px/);
});

test('old connector sizes survive normalization, saving and SVG export without truncation',()=>{
  const elements=[0,1,2,12,30].map(strokeWidth=>({id:'old'+strokeWidth,type:'connector',strokeWidth,arrowEnd:true,fromX:20,fromY:20,toX:180,toY:20}));
  elements.push({id:'custom',type:'connector',strokeWidth:12,arrowWidth:6,arrowLength:8,arrowEnd:true});
  const context={project:{version:12,elements,groups:[],canvas:{width:600,height:400}},window:{FlowSketchConnectorPaint:connectorPaint},connectorGeometry:(e,a,b)=>({vertices:[a,b],d:'M20,20 L180,20'}),uid:()=> 'unused',clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),connectorArrowStyles:['none','triangle','stealth','open','diamond','circle'],points:e=>({a:{x:e.fromX,y:e.fromY},b:{x:e.toX,y:e.toY}}),pathData:()=> 'M20,20 L180,20'};
  vm.createContext(context);
  const normalize=html.slice(html.indexOf('  function normalizeExtra(){'),html.indexOf('  function defaultGradientLayer('));
  vm.runInContext(arrowHelpers+'\n'+normalize+'\nnormalizeExtra();',context);
  const original=JSON.stringify(context.project);
  context.project=JSON.parse(original);vm.runInContext('normalizeExtra();',context);
  assert.equal(JSON.stringify(context.project),original);
  for(const e of context.project.elements.slice(0,-1)){
    assert.equal(Object.hasOwn(e,'arrowWidth'),false);assert.equal(Object.hasOwn(e,'arrowLength'),false);
    const size=context.connectorArrowDimensions(e);assert.equal(size.width,8*e.strokeWidth);assert.equal(size.length,10*e.strokeWidth);
  }
  vm.runInContext(html.slice(html.indexOf('  function arrowMarkerSpec('),html.indexOf('  function renderConnector('))+'\n'+html.slice(html.indexOf('  function svgConnector('),html.indexOf('  function svgText(')),context);
  const legacySvg=context.svgConnector(context.project.elements.find(e=>e.strokeWidth===12&&!e.arrowWidth));
  assert.match(legacySvg,/markerWidth="120" markerHeight="96"/);
  const custom=context.project.elements.at(-1);custom.strokeWidth=30;
  assert.equal(context.connectorArrowDimensions(custom).width,6);assert.equal(context.connectorArrowDimensions(custom).length,8);
  assert.match(context.svgConnector(custom),/markerWidth="8" markerHeight="6"/);
});

test('arrow controls keep clear hit targets at small sizes, both ends and diagonal directions',()=>{
  const context={clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};vm.runInNewContext(arrowHelpers,context);
  for(const [width,length] of [[4,18],[14,4],[4,4],[100,100]])for(const angle of [0,Math.PI/4,Math.PI/2])for(const distance of [0,10,36,200]){
    const u={x:Math.cos(angle),y:Math.sin(angle)},a={x:200,y:200},b={x:200+u.x*distance,y:200+u.y*distance};
    const occupied=[a,b],controls=[];
    for(const [tip,direction] of [[b,u],[a,{x:-u.x,y:-u.y}]]){
      const q=context.connectorArrowControlPositions(tip,direction,width,length,occupied);controls.push(q.lengthPoint,q.widthPoint);
    }
    for(let i=0;i<controls.length;i++)for(const q of [a,b,...controls.slice(0,i)])assert.ok(Math.hypot(controls[i].x-q.x,controls[i].y-q.y)>=24-1e-8);
  }
});

test('displaced arrow handles use pointer deltas without a jump and commit one undo step',()=>{
  for(const dim of ['length','width']){
    const connector={id:'one',type:'connector',arrowWidth:4,arrowLength:4,fromX:10,fromY:20,toX:100,toY:20,route:'straight'};
    const handlers={},calls=[];
    const context={el:()=>connector,interaction:null,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),points:e=>({a:{x:e.fromX,y:e.fromY},b:{x:e.toX,y:e.toY}}),connectorGeometry:(e,a,b)=>({vertices:[a,b]}),pt:e=>e.point,window:{addEventListener:(name,fn)=>handlers[name]=fn},renderFast:()=>calls.push('render'),render:()=>calls.push('render'),commit:()=>calls.push('commit'),canvas:{querySelectorAll:()=>[]}};
    vm.createContext(context);
    vm.runInContext(arrowHelpers+'\n'+html.slice(html.indexOf('  function connectorControlDown('),html.indexOf('  function boundsOf(')),context);
    vm.runInContext(html.slice(html.indexOf("  window.addEventListener('pointerup',ev=>"),html.indexOf('  function renderFast(){')),context);
    const start={x:76,y:dim==='length'?20:44};
    context.connectorControlDown({point:start,currentTarget:{dataset:{id:'one',arrowEnd:'to',arrowDim:dim},setPointerCapture(){}},stopPropagation(){},preventDefault(){}});
    handlers.pointermove({point:start});assert.equal(connector.arrowLength,4);assert.equal(connector.arrowWidth,4);
    handlers.pointermove({point:{x:start.x+(dim==='length'?-6:0),y:start.y+(dim==='width'?3:0)}});
    assert.equal(connector[dim==='length'?'arrowLength':'arrowWidth'],10);
    assert.equal(connector.toX,100);assert.equal(connector.toY,20);
    handlers.pointerup({});assert.equal(context.interaction,null);assert.equal(calls.filter(c=>c==='commit').length,1);
  }
});

test('zero-length curve lead-ins use the next nonzero tangent for arrow controls',()=>{
  const context={points:()=>({a:{x:0,y:0},b:{x:100,y:100}}),connectorGeometry:()=>({vertices:[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:40,y:100},{x:80,y:100},{x:100,y:100}]})};
  vm.runInNewContext(arrowHelpers,context);
  const from=context.connectorArrowTangent({},'from');assert.ok(Math.abs(from.x+40/Math.hypot(40,100))<1e-10);assert.ok(Math.abs(from.y+100/Math.hypot(40,100))<1e-10);
  const to=context.connectorArrowTangent({},'to');assert.equal(to.x,1);assert.equal(to.y,0);
});
