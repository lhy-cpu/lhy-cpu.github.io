'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fflate=require('../assets/vendor/fflate.min.js'),paint=require('../assets/js/connector-paint.js');
const fixtures=require('./fixtures/pptx-projects.cjs');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
async function build(project,groupMode){
  project=JSON.parse(JSON.stringify(project));
  const rasterized=[];
  const context={project,normalizedFromVersion:12,Uint8Array,canvas:{querySelectorAll:()=>[]},clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),el:id=>project.elements.find(element=>element.id===id),window:{fflate,FlowSketchConnectorPaint:paint,FlowSketchImages:{rasterize:async element=>{rasterized.push(element);return 'data:image/png;base64,AA=='}}},dataUrlBytes:()=>({mime:'image/png',bytes:new Uint8Array([0])})};
  const helpers=html.slice(html.indexOf('  function tokenMetrics('),html.indexOf('  function tokenMarkup('));
  const connectors=html.slice(html.indexOf('  function points('),html.indexOf('  function arrowMarkerSpec('));
  const sceneBuilder=html.slice(html.indexOf('  function pptxFormulaItem('),html.indexOf('  async function exportPPTX('));
  vm.runInNewContext(helpers+connectors+sceneBuilder,context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/flowsketch-pptx.js'),'utf8'),context);
  const scene=await context.pptxScene();scene.groupMode=groupMode;const files=fflate.unzipSync(await context.window.FlowSketchPptx.generate(scene));
  return{scene,files,rasterized,layerMerges:context.window.FlowSketchPptx.groupLayerMerges(scene),slide:fflate.strFromU8(files['ppt/slides/slide1.xml'])};
}
test('every catalog shape, note, text and legacy element survives the actual scene builder',async()=>{
  const {scene,slide}=await build(fixtures.shapes);
  const aliases={rightTriangle:'rtTriangle',cross:'plus',foldedRect:'foldedCorner',arrowRight:'rightArrow',arrowLeft:'leftArrow',arrowUp:'upArrow',arrowDown:'downArrow',arrowBoth:'leftRightArrow',notchedArrow:'notchedRightArrow',braceLeft:'leftBrace',braceRight:'rightBrace'};
  const presets=[...slide.matchAll(/<a:prstGeom prst="([^"]+)"/g)].map(match=>match[1]);
  for(const {kind} of fixtures.shapeCatalog){
    const index=scene.items.findIndex(item=>item.type==='shape'&&item.kind===kind);assert.ok(index>=0,kind);assert.equal(presets[index],kind==='rect'?'roundRect':aliases[kind]||kind,kind);
  }
  assert.equal(scene.items.length,fixtures.shapes.elements.filter(element=>element.visible!==false).length);
  assert.match(slide,/&amp; &lt;text&gt;/);assert.match(slide,/<a:rPr[^>]*b="1" i="1"/);
  assert.match(slide,/prst="foldedCorner"/);assert.match(slide,/<a:xfrm rot="1200000"/);assert.match(slide,/<a:alpha val="50000"/);
  assert.doesNotMatch(slide,/HIDDEN_SENTINEL|NaN|Infinity|undefined/);
});
test('rounded rectangles retain radius, clamp excessive radii and leave square and other shapes alone',async()=>{
  const project={canvas:{width:800,height:600},elements:[0,12,1000].map((radius,index)=>({id:'radius-'+index,type:'basicShape',shapeKind:'rect',x:0,y:index*100,w:200,h:80,radius,fill:'#ffffff'}))};
  const {slide}=await build(project);
  assert.match(slide,/<a:prstGeom prst="rect"><a:avLst><\/a:avLst>/);
  assert.match(slide,/<a:gd name="adj" fmla="val 15000"/);assert.match(slide,/<a:gd name="adj" fmla="val 50000"/);
});
test('four-corner fills use clipped picture fills on native shapes with separately editable text and shadows',async()=>{
  const {scene,slide,files,rasterized}=await build(fixtures.shapes);
  const gradient=scene.items.find(item=>item.type==='shape'&&item.text==='Gradient + shadow');
  assert.equal(gradient.type,'shape');assert.ok(gradient.fillMediaKey);assert.equal(gradient.shadow,true);
  assert.equal(rasterized.length,1);assert.match(decodeURIComponent(rasterized[0].src),/<svg width="280" height="85" /);
  assert.ok(Object.keys(files).some(name=>/^ppt\/media\/gradient\d+\.png$/.test(name)));
  assert.match(slide,/<a:blipFill rotWithShape="1"><a:blip r:embed="rId2"/);
  assert.match(slide,/<a:outerShdw blurRad="38100" dist="38100" dir="5400000"/);
  assert.match(slide,/<a:alpha val="18000"/);assert.match(slide,/<a:t>Gradient \+ shadow<\/a:t>/);
});
test('shadow opacity follows the element and disabled shadows emit no effect',async()=>{
  const project={canvas:{width:800,height:600},elements:[{id:'shadow',type:'basicShape',shapeKind:'ellipse',w:200,h:80,x:0,y:0,shadow:true,opacity:.5},{id:'plain',type:'basicShape',shapeKind:'rect',w:100,h:50,x:0,y:100,shadow:false}]};
  const {slide}=await build(project);assert.equal((slide.match(/<a:outerShdw /g)||[]).length,1);assert.match(slide,/<a:alpha val="9000"/);
});
test('rotated translucent nonrectangular gradients remain a single native shape rather than a picture object',async()=>{
  const project=JSON.parse(JSON.stringify(fixtures.shapes));project.elements=project.elements.filter(element=>element.id==='variant-2');
  Object.assign(project.elements[0],{shapeKind:'diamond',rotation:37,opacity:.4});
  const {slide,scene}=await build(project);assert.equal(scene.items.length,1);
  assert.match(slide,/<a:xfrm rot="2220000"/);assert.match(slide,/prst="diamond"/);
  assert.match(slide,/<a:alphaModFix amt="40000"/);assert.match(slide,/<a:alpha val="7200"/);assert.doesNotMatch(slide,/<p:pic>/);
});
test('all arrow styles and routes export through real routing and clipping helpers',async()=>{
  const {scene,slide}=await build(fixtures.connectors);
  const paths=scene.items.filter(item=>item.type==='path');
  assert.equal(paths.length,fixtures.connectors.elements.filter(element=>element.type==='connector').length);
  assert.equal(paths.filter(item=>item.curve).length,fixtures.arrowStyles.length+1);
  for(const style of fixtures.arrowStyles)assert.ok(paths.some(item=>item.startStyle===style&&item.endStyle===style),style);
  assert.ok(paths.every(item=>item.points.length>=2&&item.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))));
  assert.doesNotMatch(slide,/NaN|Infinity|undefined/);assert.match(slide,/<a:path/);
});
test('images keep crop, flip and color-key inputs; token modes expand to native shapes and groups retain members',async()=>{
  const {scene,slide,files,rasterized}=await build(fixtures.media);
  assert.equal(rasterized.length,8);assert.equal(scene.media.length,8);assert.equal(scene.items.filter(item=>item.type==='image').length,8);
  assert.equal(rasterized[2].flipX,true);assert.equal(rasterized[2].crop.w,.65);assert.equal(rasterized[3].flipY,true);assert.equal(rasterized[5].transparentColor,'#ffffff');
  assert.ok(scene.items.filter(item=>item.type==='path'&&item.closed).length>0);
  assert.equal(scene.items.filter(item=>item.type==='shape').length,92);
  for(const label of ['Grouped A','Grouped B'])assert.match(slide,new RegExp(label));
  assert.equal(Object.keys(files).filter(name=>name.startsWith('ppt/media/')).length,8);
  assert.doesNotMatch(slide,/NaN|Infinity|undefined/);
});
test('original groups become named native groups without changing member geometry or internal layer order',async()=>{
  const {slide,layerMerges,scene}=await build(fixtures.media);
  const group=slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)[0];assert.equal(layerMerges,0);
  assert.match(group,/name="True group"/);assert.ok(group.indexOf('Grouped A')<group.indexOf('Grouped B'));
  assert.match(group,/<a:off x="571500" y="10096500"\/>/);assert.match(group,/<a:chOff x="571500" y="10096500"\/>/);
  assert.match(group,/<a:ext cx="4381500" cy="762000"\/>/);assert.match(group,/<a:chExt cx="4381500" cy="762000"\/>/);
  assert.doesNotMatch(group,/Connector/);assert.equal(scene.groups[0].memberIds.length,2);
  const ids=[...slide.matchAll(/<p:cNvPr id="(\d+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
});
test('group members follow canvas order, keep expanded tokens and pictures together and do not reapply auto stack',async()=>{
  const project=JSON.parse(JSON.stringify(fixtures.media));project.elements=project.elements.filter(element=>['image-0','token-1','group-one'].includes(element.id));
  project.groups=[{id:'mixed',name:'Mixed & <group>',memberIds:['group-one','token-1','image-0'],autoStack:true,stackX:200,stackY:200}];project.elements.forEach(element=>element.groupId='mixed');
  const {slide,scene}=await build(project),group=slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)[0];
  assert.equal((slide.match(/<p:grpSp>/g)||[]).length,1);assert.match(group,/Mixed &amp; &lt;group&gt;/);assert.match(group,/<p:pic>/);assert.match(group,/<a:custGeom>/);
  assert.ok(group.indexOf('<p:pic>')<group.indexOf('<a:custGeom>'));assert.ok(group.indexOf('<a:custGeom>')<group.indexOf('Grouped A'));
  assert.equal(scene.items.filter(item=>item.sourceId==='token-1').length,54);assert.equal(scene.items.find(item=>item.sourceId==='image-0').x,45);
});
test('noncontiguous groups preserve membership at the uppermost member layer and report reordering',async()=>{
  const project=JSON.parse(JSON.stringify(fixtures.media));project.elements=project.elements.filter(element=>['group-one','group-two','group-label'].includes(element.id));
  project.elements=[project.elements[0],project.elements[2],project.elements[1]];project.groups[0].memberIds.reverse();
  const {slide,layerMerges}=await build(project);assert.equal(layerMerges,1);assert.ok(slide.indexOf('True group members')<slide.indexOf('<p:grpSp>'));
  const group=slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)[0];assert.ok(group.indexOf('Grouped A')<group.indexOf('Grouped B'));assert.doesNotMatch(group,/True group members/);
});
test('hidden, orphan and inconsistent members do not duplicate objects or create empty native groups',async()=>{
  const project=JSON.parse(JSON.stringify(fixtures.media));project.elements=project.elements.filter(element=>['group-one','group-two','bound-edge'].includes(element.id));project.elements.find(element=>element.id==='group-two').visible=false;
  project.groups.push({id:'empty',name:'Empty',memberIds:['missing','bound-edge','group-one']});
  const {slide,scene}=await build(project);assert.equal((slide.match(/<p:grpSp>/g)||[]).length,1);assert.match(slide,/Grouped A/);assert.doesNotMatch(slide,/Grouped B|name="Empty"/);
  assert.equal(scene.groups.find(group=>group.id==='empty').memberIds.length,0);
});
test('merge-groups retains the entire original stack and includes intervening objects without modifying project data',async()=>{
  const project=JSON.parse(JSON.stringify(fixtures.media));project.elements=project.elements.filter(element=>['group-one','group-two','group-label'].includes(element.id));
  project.elements=[project.elements[0],project.elements[2],project.elements[1]];const original=JSON.stringify(project);
  const {slide,layerMerges}=await build(project,'merge-groups');assert.equal(layerMerges,0);
  const group=slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)[0];assert.ok(group.indexOf('Grouped A')<group.indexOf('True group members'));assert.ok(group.indexOf('True group members')<group.indexOf('Grouped B'));
  assert.equal((slide.match(/<p:grpSp>/g)||[]).length,1);assert.equal(JSON.stringify(project),original);
});
test('merging intersecting group intervals is transitive while unrelated groups remain separate',async()=>{
  const elements=['a1','b1','outside','a2','b2','c1','c2'].map((id,index)=>({id,type:'basicShape',shapeKind:'rect',x:index*80,y:0,w:70,h:50,text:id,groupId:id[0]==='a'?'a':id[0]==='b'?'b':id[0]==='c'?'c':null}));
  const project={canvas:{width:800,height:600},elements,groups:[{id:'a',name:'A',memberIds:['a1','a2']},{id:'b',name:'B',memberIds:['b1','b2']},{id:'c',name:'C',memberIds:['c1','c2']}]};
  const {slide}=await build(project,'merge-groups'),groups=slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g);assert.equal(groups.length,2);assert.match(groups[0],/name="A \+ B"/);
  const text=[...groups[0].matchAll(/<a:t>(.*?)<\/a:t>/g)].map(match=>match[1]);assert.deepEqual(text,['a1','b1','outside','a2','b2']);assert.doesNotMatch(groups[0],/<a:t>c[12]/);
});
