const {test}=require('node:test');
const assert=require('node:assert/strict');
globalThis.katex=require('../assets/vendor/katex.min.js');
require('../assets/js/ai-engine.js');
const {apply,describe}=globalThis.FlowSketchAIEngine;
const fresh=()=>({version:12,name:'测试',canvas:{width:1400,height:900,bg:'#ffffff',grid:false,gridSize:20,snap:true,theme:0},elements:[]});
const add=(id,type='basicShape',extra={})=>({op:'add',element:{id,type,...extra}});

test('batch rejection is atomic and output is an independent full project',()=>{
  const source=fresh(), before=JSON.stringify(source);
  assert.throws(()=>apply(source,[add('one'),add('one')]),/重复/);
  assert.equal(JSON.stringify(source),before);
  const output=apply(source,[add('one'),{op:'rename',name:'完成'}]);
  output.canvas.width=200; assert.equal(source.canvas.width,1400);assert.equal(source.elements.length,0);
  assert.equal(output.elements[0].shapeKind,'rect');assert.equal(output.name,'完成');
});
test('reject unknown, prototype, CSS and non-finite input while allowing plain text',()=>{
  const attacks=[{fill:'url(javascript:alert(1))'},{fontFamily:'Arial; color:red'},{stroke:'red'},{x:Infinity},{x:'20'},{onload:'bad'},{text:'bad\u0000text'},{shapeKind:'bad'},JSON.parse('{"__proto__":{"polluted":true}}')];
  for(const fields of attacks) assert.throws(()=>apply(fresh(),[{op:'add',element:Object.assign({id:'a',type:'basicShape'},fields)}]));
  assert.throws(()=>apply(fresh(),[add('a\" onclick=bad')]));
  assert.throws(()=>apply(fresh(),[add('a','image',{src:'https://host/image'})]));
  assert.throws(()=>apply(fresh(),[add('a'),{op:'update',id:'a',changes:{id:'b'}}]));
  const accessor={op:'rename'};Object.defineProperty(accessor,'name',{get(){throw Error('getter executed');},enumerable:true});assert.throws(()=>apply(fresh(),[accessor]),/不安全/);
  assert.equal({}.polluted,undefined);
  assert.equal(apply(fresh(),[add('text','text',{text:'<script>alert(1)</script> a < b'})]).elements[0].text,'<script>alert(1)</script> a < b');
});
test('forward connector references work and deletion freezes current anchor coordinates',()=>{
  const source=apply(fresh(),[add('line','connector',{fromId:'box',fromSide:'right',toX:500,toY:200}),add('box','basicShape',{x:100,y:150,w:200,h:100})]);
  assert.equal(source.elements[0].fromId,'box');
  assert.throws(()=>apply(fresh(),[add('line','connector',{fromId:'missing'})]),/引用/);
  assert.throws(()=>apply(fresh(),[add('line','connector',{fromId:'line'})]),/引用/);
  const removed=apply(source,[{op:'delete',id:'box'}]);assert.equal(removed.elements[0].fromId,null);assert.equal(removed.elements[0].fromX,300);assert.equal(removed.elements[0].fromY,200);
  assert.equal(source.elements[0].fromId,'box');
});
test('token budget counts the complete batch and existing oversize projects remain editable',()=>{
  assert.throws(()=>apply(fresh(),[add('grid','tokenGrid',{rows:100,cols:100,depthCount:2})]),/预算/);
  assert.throws(()=>apply(fresh(),[add('g1','tokenGrid',{rows:100,cols:60}),add('g2','tokenGrid',{rows:100,cols:60})]),/预算/);
  const project=fresh();project.elements=Array.from({length:501},(_,i)=>({id:'n'+i,type:'text',text:'old'}));
  assert.equal(apply(project,[{op:'update',id:'n0',changes:{text:'edited'}}]).elements.length,501);
  assert.throws(()=>apply(project,[add('new')]),/预算/);
  project.elements=[{id:'g',type:'tokenGrid',rows:100,cols:100,depthCount:20}];
  assert.equal(apply(project,[{op:'rename',name:'保留'}]).name,'保留');
  assert.equal(apply(project,[{op:'update',id:'g',changes:{text:'label'}}]).elements[0].depthCount,20);
});
test('image source and token pool are preserved but excluded from model context',()=>{
  const project=fresh();project.elements=[{id:'img',type:'image',src:'data:image/png;base64,ABC',x:2,y:3,w:50,h:50},{id:'g',type:'tokenGrid',rows:1,cols:1,depthCount:1,colorMode:'image',colorChannels:['r','g'],colorImage:'data:image/png;base64,XYZ',poolColors:[[2,3,4,255]],poolRows:1,poolCols:1,poolSourceWidth:4,poolSourceHeight:4}];
  const output=apply(project,[{op:'update',id:'img',changes:{x:42,fill:'#abcd'}},{op:'rename',name:'图片'}]);
  assert.equal(output.elements[0].src,project.elements[0].src);assert.deepEqual(output.elements[1],project.elements[1]);
  assert.notEqual(output.elements[1].poolColors,project.elements[1].poolColors);
  for(const changes of [{src:'bad'},{poolColors:[]},{colorImage:'bad'},{colorMode:'solid'},{rows:2},{cols:2},{colorChannels:['color']}]) assert.throws(()=>apply(project,[{op:'update',id:changes.src?'img':'g',changes}]));
  project.selection=['img'];
  const context=describe(project);const serialized=JSON.stringify(context);assert.ok(!serialized.includes('base64'));assert.ok(!serialized.includes('poolColors'));assert.equal(context.elements[1].hasPooledImage,true);assert.equal(context.elements[0].hasImage,true);assert.deepEqual(context.selection,['img']);assert.notEqual(context.selection,project.selection);
  const same=apply(project,[{op:'update',id:'g',changes:{rows:1,cols:1,colorMode:'image',colorChannels:['r','g']}}]);assert.deepEqual(same.elements[1].poolColors,project.elements[1].poolColors);
  const geometry=apply(project,[{op:'update',id:'g',changes:{cellW:30,cellH:40,gapX:3,token3d:true,x:25}}]);assert.deepEqual(geometry.elements[1].poolColors,project.elements[1].poolColors);assert.equal(geometry.elements[1].x,25);
});
test('canvas, clear and operation count validation',()=>{
  const p=apply(fresh(),[add('a'),{op:'canvas',changes:{width:2000,bg:'transparent',theme:119}},{op:'clear'}]);assert.equal(p.canvas.width,2000);assert.equal(p.elements.length,0);
  assert.throws(()=>apply(fresh(),[]));assert.throws(()=>apply(fresh(),Array.from({length:101},()=>({op:'clear'}))));
  assert.throws(()=>apply(fresh(),[{op:'canvas',changes:{width:6001}}]));assert.throws(()=>apply(fresh(),[{op:'canvas',changes:{theme:120}}]));
});

test('editable formulas use the local strict KaTeX parser and never expose cached markup',()=>{
  const p=apply(fresh(),[add('eq','formula',{latex:'\\frac{a+b}{c}',displayMode:false})]);
  assert.equal(p.elements[0].latex,'\\frac{a+b}{c}');assert.equal(p.elements[0].fill,'transparent');
  assert.equal(apply(p,[{op:'update',id:'eq',changes:{latex:'E=mc^2',fontSize:40}}]).elements[0].latex,'E=mc^2');
  for(const source of ['\\frac{a}', '\\href{https://example.com}{x}', '\\includegraphics{x}', '\\htmlClass{evil}{x}', '\\def\\x{a}'])assert.throws(()=>apply(fresh(),[add('eq','formula',{latex:source})]),/LaTeX/);
  for(const fields of [{formulaSvg:'<svg/>'},{formulaValues:{x:'a'}},{text:'not latex'}])assert.throws(()=>apply(p,[{op:'update',id:'eq',changes:fields}]));
  p.elements[0].formulaSvg='data:image/svg+xml;base64,CACHE';p.elements[0].formulaValues={cache:'base64'};
  const ctx=describe(p);assert.equal(ctx.elements[0].latex,'\\frac{a+b}{c}');assert.ok(!JSON.stringify(ctx).includes('base64'));
  const old=globalThis.katex;delete globalThis.katex;assert.throws(()=>apply(fresh(),[add('eq','formula')]),/尚未加载/);globalThis.katex=old;
});
test('new brace shapes, four-corner fills and token colors match version 12 fields',()=>{
  const corners={tl:'#ffffff',tr:'#ff0000',bl:'#00ff00',br:'#0000ff'};
  const p=apply(fresh(),[add('brace','basicShape',{shapeKind:'braceLeft',fill:'transparent',italic:true}),add('fill','basicShape',{colorMode:'gradient',gradientColors:corners}),add('cells','tokenGrid',{rows:2,cols:2,colorMode:'cells',cellColors:['#111111','#222222','#333333','#444444'],cellColorIndex:3}),add('gradient','tokenGrid',{depthCount:2,colorMode:'gradient',gradientLayers:[corners,corners],gradientEditLayer:1})]);
  assert.equal(p.elements[0].shapeKind,'braceLeft');assert.deepEqual(p.elements[1].gradientColors,corners);
  const resized=apply(p,[{op:'update',id:'cells',changes:{rows:1,cols:3}},{op:'update',id:'gradient',changes:{depthCount:1}}]);
  assert.deepEqual(resized.elements[2].cellColors,['#111111','#222222','#e8f1fb']);assert.equal(resized.elements[2].cellColorIndex,2);assert.equal(resized.elements[3].gradientLayers.length,1);assert.equal(resized.elements[3].gradientEditLayer,0);
  assert.throws(()=>apply(fresh(),[add('bad','tokenGrid',{colorMode:'cells',cellColors:['#ffffff']})]),/长度/);
  assert.throws(()=>apply(fresh(),[add('bad','basicShape',{colorMode:'cells'})]),/颜色模式/);
  assert.throws(()=>apply(fresh(),[add('bad','basicShape',{colorMode:'gradient',gradientColors:{...corners,tl:'url(x)'}})]),/颜色/);
  assert.throws(()=>apply(fresh(),[add('bad','tokenGrid',{colorMode:'gradient',depthCount:2,gradientLayers:[corners]})]),/长度/);
  const unsafe=Object.defineProperty({...corners},'tl',{get(){throw Error('executed');},enumerable:true});assert.throws(()=>apply(fresh(),[add('bad','basicShape',{gradientColors:unsafe})]),/不安全/);
});
test('connector manual routes, relative curve controls and six arrow styles remain editable',()=>{
  const curve={from:{x:80,y:-40},to:{x:-80,y:40}};
  const p=apply(fresh(),[add('line','connector',{route:'curve',curveControls:curve,arrowStartStyle:'circle',arrowEndStyle:'stealth',routeBias:'vertical',routePoints:[{x:100,y:200}]})]);
  assert.equal(p.elements[0].curveControlVersion,2);assert.equal(p.elements[0].arrowStart,true);assert.deepEqual(p.elements[0].curveControls,curve);
  const updated=apply(p,[{op:'update',id:'line',changes:{arrowEnd:false,arrowStartStyle:'open',curveControls:null,routePoints:[],arrowWidth:8,arrowLength:10}}]);assert.equal(updated.elements[0].arrowEndStyle,'none');assert.equal(updated.elements[0].arrowStartStyle,'open');assert.equal(updated.elements[0].curveControls,null);assert.equal(updated.elements[0].arrowWidth,8);assert.equal(updated.elements[0].arrowLength,10);
  for(const fields of [{routePoints:[{x:Infinity,y:0}]},{routePoints:[{x:1,y:2,html:'bad'}]},{curveControls:{from:{x:1,y:2}}},{arrowEndStyle:'javascript'},{controlPoints:[]},{arrowWidth:2},{arrowWidth:101},{arrowLength:'big'}])assert.throws(()=>apply(p,[{op:'update',id:'line',changes:fields}]));
  const rotated=apply(fresh(),[add('node','basicShape',{x:100,y:100,w:100,h:100,rotation:90}),add('line','connector',{fromId:'node',fromSide:'right'}),{op:'delete',id:'node'}]);assert.ok(Math.abs(rotated.elements[0].fromX-150)<1e-9);assert.ok(Math.abs(rotated.elements[0].fromY-200)<1e-9);
});
test('real groups transfer ownership, stack in layer order, delete and clear consistently',()=>{
  const source=apply(fresh(),[add('a','basicShape',{x:100,y:200}),add('b'),add('c','note',{locked:true}),{op:'group',id:'g1',changes:{name:'one',memberIds:['b','a'],autoStack:true,stackX:-20,stackY:10}}]);
  assert.equal(source.elements[1].x,80);assert.equal(source.elements[1].y,190);assert.equal(source.elements[0].groupId,'g1');
  const moved=apply(source,[{op:'group',id:'g2',changes:{memberIds:['b','c']}},{op:'group',id:'g1',changes:{name:'remaining'}}]);assert.deepEqual(moved.groups[0].memberIds,['a']);assert.equal(moved.elements[1].groupId,'g2');assert.equal(source.elements[1].groupId,'g1');
  const manual=structuredClone(source);manual.elements[1].x=700;assert.equal(apply(manual,[{op:'group',id:'g1',changes:{name:'title'}}]).elements[1].x,700);
  const removed=apply(moved,[{op:'delete',id:'a'},{op:'ungroup',id:'g2'}]);assert.deepEqual(removed.groups,[]);assert.equal(removed.elements[0].groupId,null);assert.equal(removed.elements[1].groupId,null);
  const cleared=apply(moved,[{op:'clear'}]);assert.deepEqual(cleared.groups,[]);assert.deepEqual(cleared.elements,[]);
  assert.throws(()=>apply(source,[{op:'group',id:'bad',changes:{memberIds:['missing']}}]),/成员/);
  assert.throws(()=>apply(source,[add('line','connector'),{op:'group',id:'bad',changes:{memberIds:['line']}}]),/成员/);
  assert.throws(()=>apply(source,[{op:'update',id:'a',changes:{groupId:'g2'}}]),/未知字段/);
  assert.throws(()=>apply(source,[{op:'group',id:'g2',changes:{memberIds:['a','a']}}]),/重复/);
  assert.throws(()=>apply(source,[{op:'group',id:'g2',changes:{memberIds:['a'],stackX:Infinity}}]),/偏移/);
  assert.throws(()=>apply(source,[add('g1')]),/重复/);
  assert.throws(()=>apply(fresh(),[add('legacy','group')]));
  moved.selection=['b'];moved.fileId='active-file';const context=describe(moved);assert.deepEqual(context.groups,moved.groups);assert.equal(context.elements[1].groupId,'g2');assert.equal(context.fileId,'active-file');
});
test('nested route and color arrays reject accessors before evaluation',()=>{
  const unsafe=[];Object.defineProperty(unsafe,'0',{get(){throw Error('getter executed');},enumerable:true});unsafe.length=1;
  assert.throws(()=>apply(fresh(),[add('edge','connector',{routePoints:unsafe})]),/不安全/);
  assert.throws(()=>apply(fresh(),[add('grid','tokenGrid',{cellColors:unsafe})]),/不安全/);
});

const raster='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a42sAAAAASUVORK5CYII=';
const referenceAssets=()=>({reference_one:{src:raster,name:'参考图',width:1200,height:600}});
test('trusted image references clone local source and preserve editable crop/rotation/flip metadata',()=>{
  const assets=referenceAssets(),source=fresh();
  const output=apply(source,[add('image','image',{assetId:'reference_one',crop:{x:.1,y:.2,w:.5,h:.6},flipX:true,rotation:-90})],assets);
  const e=output.elements[0];assert.equal(e.src,raster);assert.equal(e.assetId,undefined);assert.equal(e.imageWidth,1200);assert.equal(e.imageHeight,600);assert.equal(e.w,320);assert.equal(e.h,160);assert.equal(e.flipX,true);assert.equal(e.flipY,false);assert.equal(e.rotation,-90);
  assets.reference_one.src='changed';e.crop.x=.2;assert.equal(source.elements.length,0);
  const updated=apply(output,[{op:'update',id:'image',changes:{crop:null,flipY:true,fit:'cover',rotation:360}}]);
  assert.equal(updated.elements[0].crop,null);assert.equal(updated.elements[0].flipY,true);assert.equal(updated.elements[0].src,raster);assert.equal(output.elements[0].flipY,false);
  const context=describe(updated);assert.equal(context.elements[0].imageWidth,1200);assert.equal(context.elements[0].crop,null);assert.equal(context.elements[0].flipY,true);assert.ok(!JSON.stringify(context).includes('base64'));
});
test('image reference rejects model URLs, unsafe asset data and source changes atomically',()=>{
  const source=fresh(),before=JSON.stringify(source);
  for(const element of [{assetId:'missing'},{src:raster,assetId:'reference_one'},{assetId:'https://host/image'},{assetId:'reference_one',crop:{x:.8,y:0,w:.3,h:1}},{assetId:'reference_one',flipX:'true'}]) {
    assert.throws(()=>apply(source,[add('first'),add('image','image',element)],referenceAssets()));assert.equal(JSON.stringify(source),before);
  }
  for(const src of ['https://host/image','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,abc','data:image/png;base64,AAAA\n','data:image/png;base64,','data:image/png;base64,AAAA'+ '='.repeat(3)])assert.throws(()=>apply(source,[add('i','image',{assetId:'reference_one'})],{reference_one:{src,width:1,height:1}}));
  const assets=referenceAssets();Object.defineProperty(assets.reference_one,'src',{get(){throw Error('getter executed');},enumerable:true});assert.throws(()=>apply(source,[add('i','image',{assetId:'reference_one'})],assets),/不安全/);
  const output=apply(source,[add('i','image',{assetId:'reference_one'})],referenceAssets());
  for(const changes of [{assetId:'reference_one'},{src:raster},{imageWidth:200},{crop:{x:0,y:0,w:0,h:1}},{crop:{x:'0',y:0,w:1,h:1}},{crop:{x:0,y:0,w:Infinity,h:1}},{crop:{x:0,y:0,w:1,h:1,extra:0}},{crop:{x:0,y:0,w:1}}])assert.throws(()=>apply(output,[{op:'update',id:'i',changes}]));
  assert.throws(()=>apply(source,[add('a','basicShape',{crop:null})]),/未知字段/);
  assert.doesNotThrow(()=>apply(output,[{op:'update',id:'i',changes:{crop:{x:.1,y:0,w:.9000000001,h:1}}}]));
});

test('image transparent color adds and updates without replacing source, and invalid edits remain atomic',()=>{
  const project=apply(fresh(),[add('image','image',{assetId:'reference_one'})],referenceAssets());
  assert.equal(project.elements[0].transparentColor,null);assert.equal(project.elements[0].colorTolerance,24);
  const added=apply(fresh(),[add('image','image',{assetId:'reference_one',transparentColor:'#FFFFFF',colorTolerance:0})],referenceAssets());
  assert.equal(added.elements[0].transparentColor,'#FFFFFF');assert.equal(added.elements[0].colorTolerance,0);
  const edited=apply(project,[{op:'update',id:'image',changes:{transparentColor:'#aBcDEF',colorTolerance:255}}]);
  assert.equal(edited.elements[0].src,raster);assert.equal(project.elements[0].transparentColor,null);
  const context=describe(edited);assert.equal(context.elements[0].transparentColor,'#aBcDEF');assert.equal(context.elements[0].colorTolerance,255);assert.ok(!JSON.stringify(context).includes('base64'));
  assert.equal(apply(edited,[{op:'update',id:'image',changes:{transparentColor:null}}]).elements[0].transparentColor,null);
  for(const changes of [{transparentColor:'#fff'},{transparentColor:'white'},{transparentColor:'#ffffffff'},{transparentColor:'transparent'},{transparentColor:24},{colorTolerance:-1},{colorTolerance:256},{colorTolerance:1.5},{colorTolerance:'24'},{colorTolerance:NaN}]) {
    const before=JSON.stringify(project);assert.throws(()=>apply(project,[{op:'rename',name:'should not persist'},{op:'update',id:'image',changes}]));assert.equal(JSON.stringify(project),before);
  }
  for(const type of ['basicShape','text','note','token','tokenGrid','formula','connector'])for(const field of ['transparentColor','colorTolerance'])assert.throws(()=>apply(fresh(),[add('other',type,{[field]:field==='transparentColor'?null:24})]),/未知字段/);
});

test('connector line widths have no fixed upper limit but remain finite nonnegative numbers',()=>{
  for(const strokeWidth of [0,30,64,120,1000]){
    const p=apply(fresh(),[add('line','connector',{strokeWidth})]);assert.equal(p.elements[0].strokeWidth,strokeWidth);
    const q=apply(p,[{op:'update',id:'line',changes:{strokeWidth:strokeWidth+50}}]);assert.equal(q.elements[0].strokeWidth,strokeWidth+50);
  }
  for(const strokeWidth of [-1,NaN,Infinity,'64'])assert.throws(()=>apply(fresh(),[add('line','connector',{strokeWidth})]),/数值超出范围/);
  const schema=globalThis.FlowSketchAIEngine.contract().fields.strokeWidth;
  assert.equal(schema.minimum,0);assert.equal(Object.hasOwn(schema,'maximum'),false);
});
