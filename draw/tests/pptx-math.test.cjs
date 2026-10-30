'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const katex=require('../assets/vendor/katex.min.js');
const fflate=require('../assets/vendor/fflate.min.js');
const mathExport=require('../assets/js/pptx-math.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const window={fflate};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/flowsketch-pptx.js'),'utf8'),{window,Uint8Array});
function element(localName,parts=[],attributes={},text){
  return{localName,children:parts,getAttribute:name=>attributes[name]??null,get textContent(){return text??parts.map(part=>part.textContent).join('')}};
}
function mathNode(latex,displayMode=true){
  const adapt=node=>node.type?element(node.type,(node.children||[]).filter(child=>child.type).map(adapt),node.attributes||{},node.children?.every(child=>!child.type)?node.children.map(child=>child.text||'').join(''):undefined):null;
  return adapt(katex.__renderToDomTree(latex,{output:'mathml',displayMode,throwOnError:true,trust:false}).children[0]);
}
function convert(latex,options={},displayMode=true){return mathExport.toOmml(mathNode(latex,displayMode),options)}
test('converts real KaTeX fractions, nested roots and scripts without rasterizing',()=>{
  const result=convert(String.raw`\frac{x_i^2+\sqrt[3]{y}}{\sqrt{z}}`);
  for(const tag of ['oMathPara','oMath','f','num','den','sSubSup','sub','sup','rad','deg'])assert.match(result,new RegExp(`<m:${tag}(?:>| )`));
  assert.match(result,/<m:degHide m:val="0"/);assert.match(result,/<m:degHide m:val="1"/);
  assert.doesNotMatch(result,/<(?:img|svg)|data:/);
});
test('sum and integral operators keep native limits and their following argument',()=>{
  const result=convert(String.raw`\sum_{i=1}^n x_i+\int_0^1 x\,dx`);
  assert.match(result,/<m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"/);
  assert.match(result,/<m:naryPr><m:chr m:val="∫"\/><m:limLoc m:val="subSup"/);
  assert.match(result,/<m:e><m:sSub>/);assert.match(result,/<m:sub>/);assert.match(result,/<m:sup>/);
});
test('matrices, cases and binomials preserve native rows, columns and delimiters',()=>{
  const matrix=convert(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`);
  assert.match(matrix,/<m:begChr m:val="\("/);assert.match(matrix,/<m:endChr m:val="\)"/);
  assert.equal((matrix.match(/<m:mr>/g)||[]).length,2);assert.equal((matrix.match(/<m:mc>/g)||[]).length,2);
  const cases=convert(String.raw`\begin{cases}x&x>0\\-x&x<0\end{cases}`);
  assert.match(cases,/<m:begChr m:val="\{"/);assert.match(cases,/<m:endChr m:val=""/);assert.match(cases,/<m:mcJc m:val="left"/);
  assert.match(convert(String.raw`\binom{n}{k}`),/<m:type m:val="noBar"/);
});
test('common accents and limits remain structured rather than flat formula text',()=>{
  const result=convert(String.raw`\hat{x}+\vec{v}+\overline{AB}+\lim_{x\to0}x`);
  assert.equal((result.match(/<m:acc>/g)||[]).length,2);assert.match(result,/<m:bar>/);assert.match(result,/<m:limLow>/);
});
test('Transformer attention expression is natively convertible',()=>{
  const result=convert(String.raw`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V`);
  assert.ok(result);assert.match(result,/<m:f>/);assert.match(result,/<m:sSup>/);assert.match(result,/<m:rad>/);
});
test('font size converts CSS pixels to points and color, opacity and math variants survive',()=>{
  const result=convert(String.raw`\mathbf{x}+\mathbb{R}+\text{a < b \& c}`,{fontSize:32,textColor:'#abc',opacity:.4});
  assert.match(result,/<a:rPr sz="2400"/);assert.match(result,/val="AABBCC"/);assert.match(result,/<a:alpha val="40000"/);
  assert.match(result,/<m:sty m:val="b"/);assert.match(result,/<m:scr m:val="double-struck"/);
  assert.match(result,/&lt;/);assert.match(result,/&amp;/);assert.doesNotMatch(result,/<m:t[^>]*>[^<]*< b/);
});
test('unsupported nodes and styles reject the entire equation for image fallback',()=>{
  for(const latex of [String.raw`x+\cancel{y}`,String.raw`\underbrace{x+y}_{z}`,String.raw`\smash{x}`,String.raw`\scriptstyle x`])assert.equal(convert(latex),null,latex);
  const malicious=element('math',[element('unknown',[element('mi',[],{},'x')])]);assert.equal(mathExport.toOmml(malicious),null);
  const bordered=element('math',[element('mtable',[element('mtr',[element('mtd',[element('mi',[],{},'x')])])],{columnlines:'solid'})]);assert.equal(mathExport.toOmml(bordered),null);
  assert.equal(mathExport.toOmml(null),null);assert.equal(mathExport.toOmml(element('math')),null);
  assert.equal(convert('x',{fontSize:Infinity}),null);assert.equal(convert('x',{opacity:NaN}),null);
});
test('conversion budgets reject deeply nested or oversized input safely',()=>{
  let nested=element('mi',[],{},'x');for(let depth=0;depth<70;depth++)nested=element('mrow',[nested]);
  assert.equal(mathExport.toOmml(element('math',[nested])),null);
  assert.equal(mathExport.toOmml(element('math',[element('mtext',[],{},'x'.repeat(20001))])),null);
  assert.equal(mathExport.toOmml(element('math',Array.from({length:8001},()=>element('mi',[],{},'x')))),null);
});
test('formula helper uses the current canvas MathML, preserves geometry and marks fallback',()=>{
  const source=html.slice(html.indexOf('  function pptxFormulaItem('),html.indexOf('  function pptxTextItem('));
  const formula={id:'formula-one',latex:'x^2',x:12,y:34,w:220,h:100,rotation:15,fontSize:32,opacity:.6};
  const nodes=[{dataset:{id:'other'},querySelector:()=>mathNode('y')},{dataset:{id:'formula-one'},querySelector:()=>mathNode('x^2')}];
  const context={window:{FlowSketchPptxMath:mathExport},canvas:{querySelectorAll:()=>nodes}};vm.runInNewContext(source,context);
  const native=context.pptxFormulaItem(formula,'media-1');assert.equal(native.type,'formula');assert.equal(native.mediaKey,'media-1');assert.equal(native.rotation,15);assert.equal(native.formulaFallback,false);assert.match(native.omml,/<m:sSup>/);
  nodes.pop();const missing=context.pptxFormulaItem(formula,'media-1');assert.equal(missing.type,'image');assert.equal(missing.formulaFallback,true);
  delete context.window.FlowSketchPptxMath;assert.equal(context.pptxFormulaItem(formula,'media-1').type,'image');
});
async function exportFiles(items,groups=[]){
  const media=[{key:'formula-1',file:'formula1.png',ext:'png',mime:'image/png',bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'))}];
  return fflate.unzipSync(await window.FlowSketchPptx.generate({width:800,height:600,items,media,groups}));
}
const formulaItem=()=>({type:'formula',mediaKey:'formula-1',name:'Formula x < y & z',omml:convert(String.raw`\frac{x}{y}`),fontSize:32,x:40,y:60,w:250,h:120,rotation:20,opacity:.5});
test('native groups retain Office Math and its compatibility image with slide-level media relationships',async()=>{
  const files=await exportFiles([{...formulaItem(),sourceId:'equation'},{type:'text',sourceId:'label',text:'Grouped label',x:300,y:60,w:150,h:80}],[{id:'math-group',name:'Math group',memberIds:['equation','label']}]);
  const slide=fflate.strFromU8(files['ppt/slides/slide1.xml']),group=slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)[0];
  assert.match(group,/<a14:m><m:oMathPara/);assert.match(group,/<mc:Fallback><p:pic>/);assert.match(group,/Grouped label/);
  assert.ok(files['ppt/media/formula1.png']);assert.match(fflate.strFromU8(files['ppt/slides/_rels/slide1.xml.rels']),/Target="..\/media\/formula1.png"/);
});
test('PPTX package stores native math and a PNG in mutually exclusive compatibility branches',async()=>{
  const files=await exportFiles([formulaItem()]),slide=fflate.strFromU8(files['ppt/slides/slide1.xml']),rels=fflate.strFromU8(files['ppt/slides/_rels/slide1.xml.rels']);
  assert.match(slide,/<mc:AlternateContent xmlns:mc="http:\/\/schemas.openxmlformats.org\/markup-compatibility\/2006">/);
  assert.match(slide,/<mc:Choice xmlns:a14="http:\/\/schemas.microsoft.com\/office\/drawing\/2010\/main" Requires="a14"><p:sp>/);
  assert.match(slide,/<a14:m><m:oMathPara/);assert.match(slide,/<mc:Fallback><p:pic>/);assert.match(slide,/<a:xfrm rot="1200000"/);
  assert.match(slide,/Formula x &lt; y &amp; z/);assert.match(slide,/<a:rPr sz="2400"/);assert.match(slide,/r:embed="rId2"/);
  assert.match(rels,/Target="..\/media\/formula1.png"/);assert.ok(files['ppt/media/formula1.png']);assert.match(fflate.strFromU8(files['[Content_Types].xml']),/ContentType="image\/png"/);
});
test('unsupported formulas retain the existing image path and mixed layers retain ordering',async()=>{
  const unsupported={...formulaItem(),type:'image',omml:null},native=formulaItem(),shape={type:'text',x:0,y:0,w:100,h:40,text:'Before'};
  const files=await exportFiles([shape,native,unsupported,{...shape,text:'After'}]),slide=fflate.strFromU8(files['ppt/slides/slide1.xml']);
  assert.equal((slide.match(/<mc:AlternateContent/g)||[]).length,1);assert.equal((slide.match(/<p:pic>/g)||[]).length,2);
  assert.ok(slide.indexOf('<a:t>Before</a:t>')<slide.indexOf('<mc:AlternateContent'));
  assert.ok(slide.lastIndexOf('</mc:AlternateContent>')<slide.lastIndexOf('<p:pic>'));
  assert.ok(slide.lastIndexOf('<p:pic>')<slide.indexOf('<a:t>After</a:t>'));
});
test('export page loads the converter before the exporter and reports formula fallback counts',()=>{
  assert.ok(html.indexOf('assets/js/pptx-math.js')<html.indexOf('assets/vendor/flowsketch-pptx.js'));
  assert.match(html,/append\(pptxFormulaItem\(e,key\)\)/);assert.match(html,/scene\.items\.filter\(item=>item\.formulaFallback\)/);
});
test('importable trial contains seven convertible formulas and one deliberate image fallback',()=>{
  const sample=require('../examples/native-math.json'),formulas=sample.elements.filter(item=>item.type==='formula');
  assert.equal(sample.version,12);assert.equal(formulas.length,8);
  assert.equal(formulas.filter(item=>convert(item.latex,item)).length,7);
  for(const item of sample.elements)assert.ok(item.x>=0&&item.y>=0&&item.x+item.w<=sample.canvas.width&&item.y+item.h<=sample.canvas.height);
  const normalized=sample.elements.map(item=>({...item}));assert.equal(new Set(normalized.map(item=>item.id)).size,normalized.length);
});
test('actual scene builder preserves mixed exports, skips hidden formulas and embeds all fallbacks',async()=>{
  const formulas=[{id:'native',type:'formula',latex:'x^2',x:10,y:20,w:100,h:50},{id:'fallback',type:'formula',latex:String.raw`\cancel{x}`,x:120,y:20,w:100,h:50},{id:'hidden',type:'formula',latex:'y',visible:false}];
  const nodes=formulas.map(formula=>({dataset:{id:formula.id},querySelector:()=>mathNode(formula.latex)})),captured=[];
  const context={window:{FlowSketchPptxMath:mathExport,FlowSketchImages:{rasterize:async()=>({mime:'image/png',bytes:new Uint8Array([1,2])})}},canvas:{querySelectorAll:()=>nodes},project:{name:'Mixed',canvas:{width:800,height:600,bg:'#ffffff'},elements:[{id:'text',type:'text'},...formulas,{id:'image',type:'image',x:240,y:20,w:80,h:50},{id:'tokens',type:'tokenGrid'},{id:'line',type:'connector',stroke:'#123456',strokeWidth:2,arrowEndStyle:'triangle'}]},Uint8Array};
  context.pngBlobOfElement=async formula=>{captured.push(formula.id);return{arrayBuffer:async()=>new Uint8Array([3,4]).buffer}};
  context.dataUrlBytes=data=>data;context.pptxTextItem=item=>({...item});context.pptxTokenItems=()=>[{type:'shape',name:'Token cell'}];
  context.points=()=>({a:{x:0,y:0},b:{x:100,y:100}});context.connectorGeometry=()=>({vertices:[{x:0,y:0},{x:100,y:100}]});context.connectorArrowDimensions=()=>({width:10,length:12});context.connectorClipPolygon=()=>[];
  vm.runInNewContext(html.slice(html.indexOf('  function pptxFormulaItem('),html.indexOf('  function pptxTextItem('))+html.slice(html.indexOf('  async function pptxScene('),html.indexOf('  async function exportPPTX(')),context);
  const scene=await context.pptxScene();assert.deepEqual(captured,['native','fallback']);assert.equal(scene.items.length,6);assert.equal(scene.media.length,3);
  assert.equal(scene.items[1].type,'formula');assert.match(scene.items[1].omml,/<m:sSup>/);assert.equal(scene.items[2].type,'image');assert.equal(scene.items[2].formulaFallback,true);
  assert.equal(scene.items[3].name,'image3.png');assert.equal(scene.items[4].name,'Token cell');assert.equal(scene.items[5].endStyle,'triangle');assert.equal(scene.items[5].arrowLength,12);
  assert.deepEqual(Array.from(scene.media,media=>media.file),['formula1.png','formula2.png','image3.png']);
  delete context.window.FlowSketchPptxMath;const fallbackScene=await context.pptxScene();assert.equal(fallbackScene.items[1].type,'image');assert.equal(fallbackScene.items[2].type,'image');
});
test('actual export action waits for fonts, downloads PPTX and reports image fallback count',async()=>{
  const messages=[],downloads=[],events=[],scene={items:[{type:'formula'},{type:'image',formulaFallback:true}]},bytes=new Uint8Array([1,2,3]);
  const exporter={generate:async actual=>{assert.equal(actual,scene);events.push('generate');return bytes}};
  const context={window:{FlowSketchPptx:exporter,fflate},FlowSketchPptx:exporter,document:{fonts:{ready:Promise.resolve().then(()=>events.push('fonts'))}},closeModal:()=>{},toast:message=>messages.push(message),pptxScene:async()=>scene,download:(...args)=>downloads.push(args),safeName:name=>name,project:{name:'Trial'},console:{error:()=>{}}};
  const source=html.split('\n').find(line=>line.startsWith('  async function exportPPTX('));vm.runInNewContext(source,context);await context.exportPPTX();
  assert.deepEqual(events,['fonts','generate']);assert.equal(downloads.length,1);assert.equal(downloads[0][0],'Trial.pptx');assert.equal(downloads[0][1],bytes);assert.match(messages.at(-1),/1 个公式保留为图片/);
  exporter.generate=async()=>{throw Error('export failed')};await context.exportPPTX();assert.equal(downloads.length,1);assert.equal(messages.at(-1),'PPTX 生成失败');
});
test('a formula without native content still exports its PNG rather than an empty math shape',async()=>{
  const files=await exportFiles([{...formulaItem(),omml:null}]),slide=fflate.strFromU8(files['ppt/slides/slide1.xml']);
  assert.match(slide,/<p:pic>/);assert.doesNotMatch(slide,/<a14:m>|<mc:AlternateContent/);assert.ok(files['ppt/media/formula1.png']);
});
test('conflicting groups pause export until a mode is selected, retain the captured filename and report the chosen tradeoff',async()=>{
  for(const mode of ['merge-groups','preserve-groups']){
    const downloads=[],messages=[],scene={name:'Captured',items:[]},project={name:'Before'},exporter={groupLayerMerges:()=>1,generate:async actual=>{assert.equal(actual.groupMode,mode);return new Uint8Array([1])}};let choice;
    const context={window:{FlowSketchPptx:exporter,fflate},FlowSketchPptx:exporter,document:{},closeModal(){},toast:message=>messages.push(message),pptxScene:async()=>scene,choosePptxGroupExport:(count,finish)=>{assert.equal(count,1);choice=finish},download:(...args)=>downloads.push(args),safeName:name=>name,project,console};
    vm.runInNewContext(html.split('\n').find(line=>line.startsWith('  async function exportPPTX(')),context);
    await context.exportPPTX();assert.equal(downloads.length,0);project.name='Changed';await choice(mode);assert.equal(downloads.length,1);assert.equal(downloads[0][0],'Captured.pptx');assert.match(messages.at(-1),mode==='merge-groups'?/保留层级/:/遮挡顺序可能变化/);
  }
});
test('group conflict dialog offers both modes plus cancel and ignores repeated selection',()=>{
  for(const selector of ['#pptxMergeGroups','#pptxKeepGroups','#pptxGroupCancel']){
    const buttons={},choices=[],closed=[],dialogs=[];
    const context={$:key=>buttons[key]||(buttons[key]={}),modal:(...args)=>dialogs.push(args),closeModal:()=>closed.push(true)};
    vm.runInNewContext(html.slice(html.indexOf('  function choosePptxGroupExport('),html.indexOf('  async function exportPPTX(')),context);
    context.choosePptxGroupExport(2,mode=>choices.push(mode));assert.match(dialogs[0][1],/夹在中间的对象/);
    buttons[selector].onclick();if(selector==='#pptxGroupCancel')assert.equal(choices.length,0);else{buttons[selector].onclick();assert.deepEqual(choices,[selector==='#pptxMergeGroups'?'merge-groups':'preserve-groups'])}assert.equal(closed.length,1);
  }
});
