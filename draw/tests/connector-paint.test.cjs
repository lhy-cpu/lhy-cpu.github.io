'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const paint=require('../assets/js/connector-paint.js');
const point=(x,y)=>({x,y}),regionOptions=(extra={})=>({startStyle:'none',endStyle:'triangle',arrowWidth:60,arrowLength:69,strokeWidth:30,width:1000,height:1000,...extra});
const geometry={vertices:[point(100,200),point(700,200)]};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const projection=(p,t)=>(p.x-t.tip.x)*t.ux+(p.y-t.tip.y)*t.uy;
function shaft(g,options,dash=false){return paint.clipPolygons(paint.strokePolygons(g,options.strokeWidth,dash),paint.clipRegion(g,options))}
function assertBehind(polygons,t,setback){assert.ok(polygons.length);for(const p of polygons.flat())assert.ok(projection(p,t)<=-setback+1e-7,`${projection(p,t)} exceeds ${-setback}`)}
test('browser global and CommonJS share the same API',()=>{const window={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/js/connector-paint.js'),'utf8'),{window});assert.deepEqual(Object.keys(window.FlowSketchConnectorPaint),Object.keys(paint))});
test('30/60/69 screenshot dimensions clip the whole shaft at projection -58.65',()=>{const options=regionOptions(),polygons=shaft(geometry,options);assertBehind(polygons,paint.terminalTangent(geometry,false),58.65);near(Math.max(...polygons.flat().map(p=>p.x)),641.35);near(Math.max(...polygons.flat().map(p=>p.y)),215)});
for(const strokeWidth of [64,120])test(`${strokeWidth} pixel lines clip correctly in every cardinal and diagonal direction`,()=>{
  for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
    const g={vertices:[point(500,500),point(500+dx*250,500+dy*250)]},options=regionOptions({strokeWidth});
    assertBehind(shaft(g,options),paint.terminalTangent(g,false),58.65);
    const swapped={...options,startStyle:'triangle',endStyle:'none'};assertBehind(shaft(g,swapped),paint.terminalTangent(g,true),58.65);
  }
});
test('clip planes remove earlier elbows and curves crossing the terminal plane',()=>{
  const elbow={vertices:[point(100,200),point(600,200),point(600,350),point(605,350)]};assertBehind(shaft(elbow,regionOptions({strokeWidth:120})),paint.terminalTangent(elbow,false),58.65);
  const curve={vertices:[point(100,200),point(700,400)],curve:{sa:point(100,200),c1:point(850,100),c2:point(1100,400),eb:point(695,400)}};
  assertBehind(shaft(curve,regionOptions({strokeWidth:120})),paint.terminalTangent(curve,false),58.65);
});
test('zero-length terminal legs and curve handles scan to the first nondegenerate point',()=>{
  const g={vertices:[point(100,100),point(100,100),point(100,200),point(500,200),point(500,200)]};assert.deepEqual(paint.terminalTangent(g,true),{tip:point(100,100),ux:0,uy:-1});assert.deepEqual(paint.terminalTangent(g,false),{tip:point(500,200),ux:1,uy:0});
  const curve={vertices:[point(100,100),point(500,200)],curve:{sa:point(100,100),c1:point(100,200),c2:point(400,200),eb:point(500,200)}};assert.deepEqual(paint.terminalTangent(curve,true),{tip:point(100,100),ux:0,uy:-1});assert.deepEqual(paint.terminalTangent(curve,false),{tip:point(500,200),ux:1,uy:0});
  assert.equal(paint.terminalTangent({vertices:[point(1,1),point(1,1)]},false),null);
});
test('opposing arrow clip planes empty a short shaft without reversing geometry or changing endpoints',()=>{
  const g={vertices:[point(200,200),point(220,200)]},before=JSON.stringify(g),options=regionOptions({startStyle:'triangle',endStyle:'triangle'});assert.deepEqual(paint.clipRegion(g,options),[]);assert.deepEqual(shaft(g,options),[]);assert.equal(JSON.stringify(g),before);assert.equal(paint.terminalTangent(g,false).ux,1);
});
test('dash 8/6 phase starts at the original path and survives start clipping and elbows',()=>{
  const line={vertices:[point(0,100),point(50,100)]},raw=paint.strokePolygons(line,2,true);assert.deepEqual(raw.map(p=>[Math.round(Math.min(...p.map(q=>q.x))),Math.round(Math.max(...p.map(q=>q.x)))]),[[0,8],[14,22],[28,36],[42,50]]);
  const clipped=shaft(line,regionOptions({startStyle:'triangle',endStyle:'none',arrowLength:10,strokeWidth:2}),true);assert.deepEqual(clipped.map(p=>[Math.round(Math.min(...p.map(q=>q.x))),Math.round(Math.max(...p.map(q=>q.x)))]),[[14,22],[28,36],[42,50]]);
  const elbow=paint.strokePolygons({vertices:[point(100,100),point(110,100),point(110,120)]},2,true);assert.ok(elbow.some(p=>Math.min(...p.map(q=>q.y))===104&&Math.max(...p.map(q=>q.y))===112));
});
test('butt caps, miter joins and miterlimit 4 produce fill outlines with one winding',()=>{
  const line=paint.strokePolygons({vertices:[point(100,100),point(200,100)]},20,false);near(Math.min(...line.flat().map(p=>p.x)),100);near(Math.max(...line.flat().map(p=>p.x)),200);
  const elbow=paint.strokePolygons({vertices:[point(100,100),point(200,100),point(200,200)]},20,false);assert.ok(elbow.flat().some(p=>p.x===210&&p.y===90));
  const sharp=paint.strokePolygons({vertices:[point(100,100),point(200,100),point(100,101)]},20,false);assert.equal(sharp[2].length,3);for(const p of sharp[2])assert.ok(Math.hypot(p.x-200,p.y-100)<=40);
  for(const polygon of [...line,...elbow,...sharp])assert.ok(polygon.reduce((sum,p,i)=>sum+p.x*polygon[(i+1)%polygon.length].y-p.y*polygon[(i+1)%polygon.length].x,0)>0);
});
test('curve subdivision stays bounded and reproduces the arch to .15 pixels',()=>{
  const g={vertices:[point(100,100),point(200,100)],curve:{sa:point(100,100),c1:point(100,200),c2:point(200,200),eb:point(200,100)}};const polygons=paint.strokePolygons(g,2,false);assert.ok(polygons.length>20&&polygons.length<8192);
  // Rectangular segment midpoints must lie close to the analytic cubic.
  const segmentCount=(polygons.length+1)/2;
  for(const polygon of polygons.slice(0,segmentCount)){const p={x:polygon.reduce((s,p)=>s+p.x,0)/4,y:polygon.reduce((s,p)=>s+p.y,0)/4};const d=t=>Math.hypot(p.x-(100+100*(3*t*t-2*t*t*t)),p.y-(100+300*t*(1-t)));let best=0;for(let i=1;i<=1000;i++)if(d(i/1000)<d(best))best=i/1000;let low=Math.max(0,best-.002),high=Math.min(1,best+.002);for(let i=0;i<40;i++){const a=low+(high-low)/3,b=high-(high-low)/3;if(d(a)<d(b))high=b;else low=a}assert.ok(d((low+high)/2)<.15)}
});
test('style setbacks, open shaft ratio, none, zero and legacy oversized dimensions are exact',()=>{
  for(const [style,factor] of [['triangle',.85],['stealth',.62],['diamond',.43],['circle',.32]]){const polygon=paint.clipRegion(geometry,regionOptions({endStyle:style}));near(Math.max(...polygon.map(p=>p.x)),700-factor*69)}
  for(const strokeWidth of [0,4,30,64,120]){const polygon=paint.clipRegion(geometry,regionOptions({endStyle:'open',strokeWidth})),setback=Math.min(.83*69,Math.max(.07*69,.83*69*strokeWidth/(.825*60)));near(Math.max(...polygon.map(p=>p.x)),700-setback)}
  const canvas=[point(0,0),point(1000,0),point(1000,1000),point(0,1000)];for(const dims of [{arrowWidth:0},{arrowLength:0},{endStyle:'none'}])assert.deepEqual(paint.clipRegion(geometry,regionOptions(dims)),canvas);
  near(Math.max(...paint.clipRegion(geometry,regionOptions({arrowWidth:240,arrowLength:320})).map(p=>p.x)),428);
  assert.deepEqual(paint.strokePolygons(geometry,0,false),[]);assert.deepEqual(paint.clipPolygons(paint.strokePolygons(geometry,30,false),[]),[]);
});
