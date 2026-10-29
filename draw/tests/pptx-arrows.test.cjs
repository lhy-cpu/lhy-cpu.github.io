'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fflate=require('../assets/vendor/fflate.min.js');
const paint=require('../assets/js/connector-paint.js');
const window={fflate,FlowSketchConnectorPaint:paint};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/flowsketch-pptx.js'),'utf8'),{window,Uint8Array});
const EMU=9525;
const connector=(extra={})=>({type:'connector',a:{x:100,y:100},b:{x:300,y:100},color:'#123456',opacity:.35,width:2,arrowWidth:25,arrowLength:25,startStyle:'none',endStyle:'triangle',...extra});
async function slide(items){const bytes=await window.FlowSketchPptx.generate({width:800,height:600,items,media:[]});const files=fflate.unzipSync(bytes);assert.ok(files['ppt/presentation.xml']);assert.equal(Object.keys(files).filter(x=>x.startsWith('ppt/media/')).length,0);return fflate.strFromU8(files['ppt/slides/slide1.xml'])}
function arrows(xml){return [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(m=>m[0]).filter(s=>/name="[^"]* (?:start|end) arrow"/.test(s))}
function geometry(shape){let off=shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"/),ext=shape.match(/<a:ext cx="(\d+)" cy="(\d+)"/);return{x:+off[1]/EMU,y:+off[2]/EMU,w:+ext[1]/EMU,h:+ext[2]/EMU,points:[...shape.matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"/g)].map(m=>({x:(+off[1]+ +m[1])/EMU,y:(+off[2]+ +m[2])/EMU}))}}
const near=(actual,expected,tolerance=.002)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
test('25 and 100 pixel arrows retain proportional native geometry and suppress standard line arrows',async()=>{
  const small=await slide([connector()]),large=await slide([connector({arrowWidth:100,arrowLength:100})]);assert.notEqual(small,large);
  const a=geometry(arrows(small)[0]),b=geometry(arrows(large)[0]);near(b.w,a.w*4);near(b.h,a.h*4);
  assert.match(small,/<a:custGeom>/);assert.doesNotMatch(small,/<a:(?:head|tail)End type="(?:triangle|stealth|arrow|diamond|oval)"/);
});
test('line width, dash and opacity do not alter arrow geometry or add dashed marker strokes',async()=>{
  const a=arrows(await slide([connector({width:.25})]))[0],b=arrows(await slide([connector({width:35,dash:true})]))[0];assert.equal(a,b);
  assert.match(a,/srgbClr val="123456"/);assert.match(a,/alpha val="35000"/);assert.match(a,/<a:ln><a:noFill\/><\/a:ln>/);assert.doesNotMatch(a,/prstDash/);
});
for(const style of ['triangle','stealth','open','diamond','circle'])test(`${style} supports separately scaled width and length including extreme aspect ratios`,async()=>{
  const wide=geometry(arrows(await slide([connector({endStyle:style,arrowWidth:100,arrowLength:4})]))[0]);
  const long=geometry(arrows(await slide([connector({endStyle:style,arrowWidth:4,arrowLength:100})]))[0]);near(wide.w*25,long.w);near(long.h*25,wide.h);
  const svg=arrows(await slide([connector({endStyle:style})]))[0];if(['circle','open'].includes(style))assert.match(svg,/<a:cubicBezTo>/);else assert.doesNotMatch(svg,/<a:cubicBezTo>/);
});
test('each marker style has distinct geometry; outline-expanded circle uses refX 8.2',async()=>{
  const styles=['triangle','stealth','open','diamond','circle'];const values=await Promise.all(styles.map(async endStyle=>arrows(await slide([connector({endStyle})]))[0].match(/<a:custGeom>[\s\S]*?<\/a:custGeom>/)[0]));assert.equal(new Set(values).size,5);
  const g=geometry(arrows(await slide([connector({endStyle:'circle',arrowWidth:80,arrowLength:100})]))[0]);near(g.x,231);near(g.y,63);near(g.w,74);near(g.h,74);
});
test('start and end arrows point outwards for horizontal, vertical and diagonal connectors',async()=>{
  for(const b of [{x:300,y:100},{x:100,y:300},{x:300,y:300},{x:0,y:0}]){const [start,end]=arrows(await slide([connector({b,startStyle:'triangle'})])).map(geometry),dx=b.x-100,dy=b.y-100;const projection=(p,tip)=>((p.x-tip.x)*dx+(p.y-tip.y)*dy)/Math.hypot(dx,dy);const avg=(g,tip)=>g.points.reduce((sum,p)=>sum+projection(p,tip),0)/g.points.length;assert.ok(avg(start,{x:100,y:100})>0);assert.ok(avg(end,b)<0)}
});
test('curves skip degenerate endpoint legs and follow their actual first and last control points',async()=>{
  const item=connector({type:'curve',arrowLength:50,arrowWidth:10,a:{x:100,y:100},sa:{x:100,y:100},c1:{x:100,y:180},c2:{x:240,y:300},eb:{x:300,y:300},b:{x:300,y:300},startStyle:'triangle'});
  const [start,end]=arrows(await slide([item])).map(geometry);assert.ok(start.h>start.w);assert.ok(start.points.reduce((sum,p)=>sum+p.y,0)/start.points.length>100);assert.ok(end.w>end.h);assert.ok(end.x<300);
  const allSame=Object.fromEntries(['a','sa','c1','c2','eb','b'].map(key=>[key,{x:100,y:100}]));assert.equal(arrows(await slide([{...item,...allSame}])).length,0);
});
test('polyline marker directions skip repeated endpoints and remain next to their own line in layer order',async()=>{
  const item=connector({type:'path',arrowLength:50,arrowWidth:10,name:'Route',points:[{x:100,y:100},{x:100,y:100},{x:100,y:200},{x:300,y:200},{x:300,y:200}],startStyle:'open',endStyle:'diamond'});
  const xml=await slide([item,{type:'shape',name:'Foreground',x:0,y:0,w:20,h:20,fill:'#ffffff'}]);const [start,end]=arrows(xml).map(geometry);assert.ok(start.h>start.w);assert.ok(end.w>end.h);
  const names=[...xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)];assert.deepEqual(names.map(m=>m[2]),['','Route','Route start arrow','Route end arrow','Foreground']);assert.equal(new Set(names.map(m=>m[1])).size,names.length);
});
test('zero dimensions suppress markers and legacy oversized pixel dimensions remain untruncated',async()=>{
  for(const dimensions of [{arrowWidth:0},{arrowLength:0},{arrowWidth:0,arrowLength:0}]){const xml=await slide([connector(dimensions)]);assert.equal(arrows(xml).length,0);assert.doesNotMatch(xml,/<a:(?:head|tail)End type="triangle"/)}
  const a=geometry(arrows(await slide([connector()]))[0]),b=geometry(arrows(await slide([connector({arrowWidth:240,arrowLength:320})]))[0]);near(b.w,a.w*320/25);near(b.h,a.h*240/25);
});
test('external scenes without explicit pixel dimensions preserve native standard arrow compatibility',async()=>{
  const item=connector({startStyle:'open',endStyle:'circle'});delete item.arrowWidth;delete item.arrowLength;const xml=await slide([item]);assert.equal(arrows(xml).length,0);assert.match(xml,/<a:headEnd type="arrow" w="med" len="med"\/>/);assert.match(xml,/<a:tailEnd type="oval" w="med" len="med"\/>/);
});
function clippedItem(extra={}){
  const item=connector({type:'path',name:'Clipped route',points:[{x:100,y:200},{x:700,y:200}],width:30,arrowWidth:60,arrowLength:69,...extra});
  delete item.a;delete item.b;
  item.clipPolygon=paint.clipRegion(item,{startStyle:item.startStyle,endStyle:item.endStyle,arrowWidth:item.arrowWidth,arrowLength:item.arrowLength,strokeWidth:item.width,width:800,height:600});return item;
}
function shaftShape(xml){return [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(m=>m[0]).find(s=>/name="Clipped route"/.test(s))}
function assertShaftBehind(shape,t,setback){const points=geometry(shape).points;assert.ok(points.length);for(const p of points)assert.ok((p.x-t.tip.x)*t.ux+(p.y-t.tip.y)*t.uy<=-setback+.0002)}
test('PPTX clipped 30/60/69 shaft is a filled editable outline ending at -58.65',async()=>{
  const item=clippedItem(),xml=await slide([item]),shape=shaftShape(xml);assertShaftBehind(shape,paint.terminalTangent(item,false),58.65);near(geometry(shape).h,30);assert.match(shape,/<a:path[^>]*stroke="false"/);assert.match(shape,/<a:solidFill>/);assert.match(shape,/<a:ln><a:noFill\/><\/a:ln>/);assert.doesNotMatch(shape,/<a:(?:head|tail)End/);
  const original={...item};delete original.clipPolygon;assert.equal(arrows(xml)[0],arrows(await slide([original]))[0]);
});
test('PPTX 64/120 pixel fill shafts stay behind arrow tail planes in eight directions',async()=>{
  for(const width of [64,120])for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
    const item=clippedItem({width,points:[{x:400,y:300},{x:400+dx*200,y:300+dy*200}]}),xml=await slide([item]);assertShaftBehind(shaftShape(xml),paint.terminalTangent(item,false),58.65);assert.equal(arrows(xml).length,1);
  }
});
test('PPTX clips nested curves and elbows across multiple segments while keeping their original tips',async()=>{
  const elbow=clippedItem({width:120,points:[{x:100,y:200},{x:600,y:200},{x:600,y:350},{x:605,y:350}]}),curve=clippedItem({width:120,points:[{x:100,y:200},{x:700,y:400}],curve:{sa:{x:100,y:200},c1:{x:780,y:100},c2:{x:800,y:400},eb:{x:695,y:400}}});
  for(const item of [elbow,curve]){const xml=await slide([item]);assertShaftBehind(shaftShape(xml),paint.terminalTangent(item,false),58.65);const raw={...item};delete raw.clipPolygon;assert.equal(arrows(xml)[0],arrows(await slide([raw]))[0]);assert.doesNotMatch(shaftShape(xml),/<a:cubicBezTo>/)}
});
test('PPTX short double-arrow paths hide the shaft and keep both original arrow shapes',async()=>{
  const item=clippedItem({startStyle:'triangle',points:[{x:200,y:200},{x:220,y:200}]});assert.equal(item.clipPolygon.length,0);const xml=await slide([item]);assert.equal(shaftShape(xml),undefined);assert.equal(arrows(xml).length,2);const raw={...item};delete raw.clipPolygon;assert.deepEqual(arrows(xml),arrows(await slide([raw])));
});
test('PPTX dashed shaft uses original 8/6 phase before clipping instead of restarting at its new start',async()=>{
  const item=clippedItem({points:[{x:100,y:200},{x:150,y:200}],dash:true,width:2,arrowWidth:20,arrowLength:10,startStyle:'triangle',endStyle:'none'}),shape=shaftShape(await slide([item]));const points=geometry(shape).points;near(Math.min(...points.map(p=>p.x)),114);assert.doesNotMatch(shape,/prstDash/);assert.equal((shape.match(/<a:close\/>/g)||[]).length,3);
});
test('PPTX clips every marker style without limiting legacy sizes and zero-sized arrows leave full shafts',async()=>{
  for(const [endStyle,factor] of [['triangle',.85],['stealth',.62],['diamond',.43],['circle',.32]]){
    const item=clippedItem({endStyle,arrowWidth:240,arrowLength:320,width:120});assertShaftBehind(shaftShape(await slide([item])),paint.terminalTangent(item,false),factor*320);
  }
  const open=clippedItem({endStyle:'open',width:120});assertShaftBehind(shaftShape(await slide([open])),paint.terminalTangent(open,false),.83*69);
  for(const dims of [{arrowWidth:0},{arrowLength:0}]){const item=clippedItem(dims),xml=await slide([item]);near(geometry(shaftShape(xml)).w,600);assert.equal(arrows(xml).length,0)}
});
test('ordinary closed paths without clipPolygon retain their original editable fill and outline',async()=>{
  const xml=await slide([{type:'path',name:'Token face',points:[{x:100,y:100},{x:200,y:100},{x:200,y:200}],closed:true,fill:'#abcdef',stroke:'#fedcba',width:3,opacity:1}]);assert.match(xml,/srgbClr val="ABCDEF"/);assert.match(xml,/<a:ln w="28575"/);assert.match(xml,/srgbClr val="FEDCBA"/);
});
