(function (root) {
  'use strict';
  const TYPES = ['basicShape', 'text', 'note', 'token', 'tokenGrid', 'formula', 'connector', 'image'];
  const SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'rightTriangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'star5', 'heart', 'cross', 'foldedRect', 'arrowRight', 'arrowLeft', 'arrowUp', 'arrowDown', 'arrowBoth', 'chevron', 'notchedArrow', 'braceLeft', 'braceRight'];
  const COMMON = ['x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'locked', 'text', 'fontSize', 'fontWeight', 'fontFamily', 'textColor', 'fill', 'stroke', 'strokeWidth', 'radius', 'align', 'vAlign', 'textOffsetX', 'textOffsetY', 'padding', 'dash', 'shadow', 'italic', 'colorMode', 'gradientColors'];
  const GRID = ['rows', 'cols', 'depthCount', 'cellW', 'cellH', 'gapX', 'gapY', 'extrude', 'stackX', 'stackY', 'token3d', 'colorMode', 'colorChannels', 'cellColors', 'cellColorIndex', 'gradientEditLayer', 'gradientLayers'];
  const CONNECTOR = ['x', 'y', 'fromX', 'fromY', 'toX', 'toY', 'fromId', 'toId', 'fromSide', 'toSide', 'route', 'stroke', 'strokeWidth', 'dash', 'arrowEnd', 'arrowStart', 'visible', 'locked', 'routeBias', 'routePoints', 'curveControls', 'curveControlVersion', 'arrowStartStyle', 'arrowEndStyle', 'arrowWidth', 'arrowLength'];
  const CANVAS = ['width', 'height', 'bg', 'grid', 'gridSize', 'snap', 'theme'];
  const BOOL = ['visible', 'locked', 'dash', 'shadow', 'token3d', 'arrowEnd', 'arrowStart', 'grid', 'snap', 'italic', 'displayMode', 'flipX', 'flipY'];
  const NUMBERS = {x:[-100000,100000],y:[-100000,100000],w:[1,20000],h:[1,20000],rotation:[-360,360],opacity:[0,1],fontSize:[8,200],fontWeight:[100,900,true],strokeWidth:[0,Infinity],radius:[0,10000],padding:[0,1000],textOffsetX:[-20000,20000],textOffsetY:[-20000,20000],fromX:[-100000,100000],fromY:[-100000,100000],toX:[-100000,100000],toY:[-100000,100000],rows:[1,100,true],cols:[1,100,true],depthCount:[1,20,true],cellW:[4,200],cellH:[4,200],gapX:[0,200],gapY:[0,200],extrude:[0,200],stackX:[0,200],stackY:[0,200],width:[200,6000],height:[200,6000],gridSize:[5,100,true],theme:[0,119,true],cellColorIndex:[0,9999,true],gradientEditLayer:[0,19,true],curveControlVersion:[2,2,true],colorTolerance:[0,255,true],arrowWidth:[4,100],arrowLength:[4,100]};
  const ENUMS = {shapeKind:SHAPES,align:['left','center','right'],vAlign:['top','center','bottom'],route:['straight','orthogonal','curve'],fromSide:['left','right','top','bottom'],toSide:['left','right','top','bottom'],fit:['cover','contain'],colorMode:['solid','cells','gradient'],routeBias:['horizontal','vertical'],arrowStartStyle:['none','triangle','stealth','open','diamond','circle'],arrowEndStyle:['none','triangle','stealth','open','diamond','circle']};
  const fail = message => { throw new Error('AI 编辑无效：' + message); };
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail(label + ' 必须是普通对象');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || ['__proto__','constructor','prototype'].includes(key) || !Object.getOwnPropertyDescriptor(value,key).hasOwnProperty('value')) fail(label + ' 含不安全字段');
    }
  }
  function keys(value, allowed, label) { record(value,label); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(label + ' 未知字段 ' + key); }
  function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) || ['__proto__','constructor','prototype'].includes(value)) fail('ID 不安全'); }
  function string(value, max, label) { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(label + ' 文本不安全或过长'); }
  function list(v,max,label) {
    if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>max)fail(label+' 数组无效或超过预算');
    for(const key of Reflect.ownKeys(v)){if(key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||! /^(0|[1-9][0-9]*)$/.test(key)||!Object.hasOwn(d,'value'))fail(label+' 数组含不安全字段');}
    for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i))fail(label+' 数组不能含空位');
  }
  function color(v, label, hexOnly=false) {
    if(typeof v!=='string'||!(hexOnly?/^#[0-9a-fA-F]{6}$/:/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$/).test(v)) fail(label+' 颜色无效');
  }
  function corners(v) { keys(v,['tl','tr','bl','br'],'四角渐变'); if(Object.keys(v).length!==4) fail('四角渐变必须完整');for(const c of Object.values(v))color(c,'四角渐变',true); }
  function point(v) { keys(v,['x','y'],'路径点');for(const key of ['x','y'])if(typeof v[key]!=='number'||!Number.isFinite(v[key])||Math.abs(v[key])>100000)fail('路径点数值超出范围'); }
  function latex(v) {
    string(v,10000,'LaTeX');
    if(/\\(?:href|url|includegraphics|html[A-Za-z]*|def|gdef|edef|xdef|newcommand|renewcommand|let|futurelet|csname)\b/.test(v))fail('LaTeX 含资源或宏定义命令');
    if(!root.katex||typeof root.katex.renderToString!=='function')fail('KaTeX 尚未加载，无法验证公式');
    try{root.katex.renderToString(v,{displayMode:true,throwOnError:true,trust:false,strict:'error',maxExpand:1000,maxSize:100,output:'mathml'});}catch{fail('LaTeX 解析失败');}
  }
  function validateFields(value, allowed) {
    keys(value,allowed,'元素/画布');
    for (const [key,v] of Object.entries(value)) {
      if (key==='id'||key==='assetId') id(v);
      else if (key==='crop') crop(v);
      else if (key==='transparentColor') { if(v!==null)color(v,'transparentColor',true); }
      else if (key==='type') { if (!TYPES.includes(v)) fail('不支持新增类型'); }
      else if (BOOL.includes(key)) { if (typeof v!=='boolean') fail(key+' 必须是布尔值（true 或 false，不带引号）'); }
      else if (NUMBERS[key]) { const [min,max,integer]=NUMBERS[key]; if (typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isInteger(v))) fail(key+' 数值超出范围（必须为 '+(Number.isFinite(max)?min+'～'+max:'不小于 '+min)+' 的'+(integer?'整数':'有限数值')+'，不带引号或单位）'); }
      else if (ENUMS[key]) { if (!ENUMS[key].includes(v)) fail(key+' 枚举无效'); }
      else if (['fill','stroke','textColor','bg'].includes(key)) color(v,key);
      else if (key==='fontFamily') { if (typeof v!=='string'||! /^[\p{L}\p{N} _-]{1,80}$/u.test(v)) fail('字体名称不安全'); }
      else if (key==='text') string(v,10000,'文字');
      else if (key==='latex') latex(v);
      else if (key==='formulaTemplateId'||key==='formulaValues') { if(v!==null)fail('新公式兼容字段只能为 null'); }
      else if (key==='gradientColors') corners(v);
      else if (key==='gradientLayers') { list(v,20,'gradientLayers'); if(!Array.isArray(v)||v.length<1||v.length>20)fail('渐变层数无效');v.forEach(corners); }
      else if (key==='cellColors') { list(v,10000,'cellColors'); if(!Array.isArray(v)||v.length<1||v.length>10000)fail('单元格颜色数无效');v.forEach(c=>color(c,'单元格',true)); }
      else if (key==='routePoints') { list(v,100,'routePoints'); if(!Array.isArray(v)||v.length>100)fail('手动路径点超过预算');v.forEach(point); }
      else if (key==='curveControls'&&v!==null) { keys(v,['from','to'],'曲线控制向量');if(Object.keys(v).length!==2)fail('曲线控制向量必须完整');point(v.from);point(v.to); }
      else if (key==='fromId'||key==='toId') { if(v!==null) id(v); }
      else if (key==='colorChannels') { list(v,6,'colorChannels'); if (!Array.isArray(v)||v.length<1||v.length>6||new Set(v).size!==v.length||v.some(c=>!['r','g','b','a','color','gray'].includes(c))) fail('颜色通道无效'); }
    }
  }
  function allowed(type) {
    if(type==='connector')return CONNECTOR;
    if(type==='formula')return ['x','y','w','h','rotation','opacity','visible','locked','fontSize','textColor','latex','displayMode','formulaTemplateId','formulaValues'];
    return [...COMMON.filter(k=>(!['text','image'].includes(type)||!['colorMode','gradientColors'].includes(k))&&(type!=='tokenGrid'||k!=='gradientColors')),...(type==='basicShape'?['shapeKind']:[]),...(type==='tokenGrid'?GRID.filter(k=>k!=='gradientColors'):[]),...(type==='image'?['fit','crop','flipX','flipY','transparentColor','colorTolerance']:[])];
  }
  function crop(value) {
    if(value===null)return;
    keys(value,['x','y','w','h'],'图片裁切');
    if(Object.keys(value).length!==4)fail('图片裁切必须包含 x/y/w/h');
    for(const key of ['x','y','w','h'])if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<0||value[key]>1||(['w','h'].includes(key)&&value[key]===0))fail('图片裁切数值必须在 0..1，宽高大于 0');
    if(value.x+value.w>1+1e-9||value.y+value.h>1+1e-9)fail('图片裁切超出源图范围');
  }
  function imageAsset(assets,assetId) {
    id(assetId);record(assets,'图片资源表');
    if(!Object.hasOwn(assets,assetId))fail('图片资源不存在：'+assetId);
    const asset=assets[assetId];keys(asset,['src','name','width','height'],'图片资源');
    if(typeof asset.src!=='string'||asset.src.length>20*1024*1024||!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.src))fail('图片资源必须是预算内的本地栅格 data URL');
    const encoded=asset.src.slice(asset.src.indexOf(',')+1);if(encoded.length%4!==0)fail('图片资源 base64 编码无效');
    for(const k of ['width','height'])if(typeof asset[k]!=='number'||!Number.isInteger(asset[k])||asset[k]<1||asset[k]>100000)fail('图片资源尺寸无效');
    if(Object.hasOwn(asset,'name'))string(asset.name,200,'图片名称');
    return asset;
  }
  function validateElement(e) {
    if(e.type!=='tokenGrid'&&e.type!=='connector'&&e.colorMode&&!['solid','gradient'].includes(e.colorMode))fail('普通元素颜色模式无效');
    if(e.type==='tokenGrid'&&e.colorMode!=='image') {
      if(e.colorMode==='cells'&&(!Array.isArray(e.cellColors)||e.cellColors.length!==e.rows*e.cols))fail('cellColors 长度必须等于 rows * cols');
      if(e.colorMode==='gradient'&&(!Array.isArray(e.gradientLayers)||e.gradientLayers.length!==e.depthCount))fail('gradientLayers 长度必须等于 depthCount');
      if(e.cellColorIndex!==undefined&&e.cellColorIndex>=e.rows*e.cols)fail('cellColorIndex 超出单元格范围');
      if(e.gradientEditLayer!==undefined&&e.gradientEditLayer>=e.depthCount)fail('gradientEditLayer 超出层范围');
    }
    if(e.type!=='tokenGrid'&&e.colorMode==='gradient'&&!e.gradientColors)fail('渐变模式需要 gradientColors');
  }
  function dimensions(e) { const layers=e.colorMode==='image'?(e.colorChannels||['color']).length:e.depthCount; const depth=e.token3d?e.extrude:0; return {w:e.cols*e.cellW+(e.cols-1)*e.gapX+depth+(layers-1)*e.stackX,h:e.rows*e.cellH+(e.rows-1)*e.gapY+depth+(layers-1)*e.stackY}; }
  function defaults(type) {
    const e={type,x:80,y:80,w:160,h:70,rotation:0,opacity:1,visible:true,locked:false,text:'流程节点',fontSize:18,fontWeight:600,fontFamily:'HarmonyOS Sans SC',textColor:'#0b2d5c',fill:'#e8f1fb',stroke:'#165d9c',strokeWidth:2,radius:8,align:'center',vAlign:'center',textOffsetX:0,textOffsetY:0,padding:8,dash:false,shadow:true};
    if(type==='basicShape') Object.assign(e,{shapeKind:'rect',text:'图形文字'});
    if(type==='text') Object.assign(e,{text:'双击编辑文字',fontSize:24,strokeWidth:0,shadow:false});
    if(type==='note') Object.assign(e,{text:'说明便签',w:180,h:120,fill:'#fff2a8',stroke:'#b78c18'});
    if(type==='group') Object.assign(e,{text:'分组标题',w:420,h:250,fill:'#ffffff',opacity:.65,radius:20,dash:true,shadow:false});
    if(type==='token') Object.assign(e,{text:'Token',w:64,h:42,radius:2,fill:'#165d9c',textColor:'#fff'});
    if(type==='tokenGrid') Object.assign(e,{rows:1,cols:8,depthCount:1,cellW:28,cellH:28,gapX:8,gapY:8,extrude:10,stackX:12,stackY:12,radius:2,text:'',token3d:false,shadow:false,colorMode:'solid',colorChannels:['color']});
    if(type==='image') Object.assign(e,{text:'',transparentColor:null,colorTolerance:24,crop:null,flipX:false,flipY:false,fit:'contain',fill:'transparent',stroke:'transparent',strokeWidth:0,shadow:false});
    if(type==='formula') Object.assign(e,{text:'',latex:'\\frac{a}{b}',displayMode:true,formulaTemplateId:null,formulaValues:null,w:220,h:90,fontSize:32,fill:'transparent',stroke:'transparent',strokeWidth:0,shadow:false});
    if(type==='connector') return {type,x:0,y:0,fromX:80,fromY:80,toX:280,toY:80,route:'orthogonal',routeBias:'horizontal',routePoints:[],curveControls:null,arrowStartStyle:'none',arrowEndStyle:'triangle',arrowWidth:14,arrowLength:18,stroke:'#0b2d5c',strokeWidth:2,dash:false,arrowEnd:true,arrowStart:false,visible:true,locked:false};
    return e;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function budget(elements) { return elements.reduce((n,e)=>n+(e.type==='tokenGrid'?(e.rows||1)*(e.cols||1)*(e.colorMode==='image'?(e.colorChannels||['color']).length:(e.depthCount||1)):0),0); }
  function endpoint(target,connector,key) {
    const anchors={left:{x:target.x,y:target.y+target.h/2},right:{x:target.x+target.w,y:target.y+target.h/2},top:{x:target.x+target.w/2,y:target.y},bottom:{x:target.x+target.w/2,y:target.y+target.h}};
    const angle=(target.rotation||0)*Math.PI/180,cx=target.x+target.w/2,cy=target.y+target.h/2;for(const p of Object.values(anchors)){const dx=p.x-cx,dy=p.y-cy;p.x=cx+dx*Math.cos(angle)-dy*Math.sin(angle);p.y=cy+dx*Math.sin(angle)+dy*Math.cos(angle);}
    return anchors[connector[key+'Side']] || Object.values(anchors).sort((a,b)=>(a.x-connector[key+'X'])**2+(a.y-connector[key+'Y'])**2-(b.x-connector[key+'X'])**2-(b.y-connector[key+'Y'])**2)[0];
  }
  function apply(snapshot, operations, assets={}) {
    if (!snapshot||!Array.isArray(snapshot.elements)||!snapshot.canvas) fail('项目结构无效');
    if (!Array.isArray(operations)||operations.length<1||operations.length>100) fail('操作数必须为 1 到 100');
    list(operations,100,'操作');
    const project=clone(snapshot), initialCount=project.elements.length, initialBudget=budget(project.elements), touched=new Set();
    if(!Array.isArray(project.groups))project.groups=[];
    const stacked=new Set();let addedImageBytes=0;
    for (const operation of operations) {
      record(operation,'操作');
      const fields={add:['op','element'],update:['op','id','changes'],delete:['op','id'],canvas:['op','changes'],rename:['op','name'],clear:['op'],group:['op','id','changes'],ungroup:['op','id']}[operation.op];
      if (!Array.isArray(fields)) fail('未知操作'); keys(operation,fields,'操作');
      if (operation.op==='add') {
        record(operation.element,'新增元素'); const {type}=operation.element;
        validateFields(operation.element,['id','type',...allowed(type),...(type==='image'?['assetId']:[])]); id(operation.element.id);
        if(!TYPES.includes(type)||project.elements.some(e=>e.id===operation.element.id)||project.groups.some(g=>g.id===operation.element.id)) fail('类型无效或 ID 重复');
        const e=Object.assign(defaults(type),clone(operation.element));
        if(type==='image') {
          const asset=imageAsset(assets,operation.element.assetId);
          addedImageBytes+=asset.src.length;if(addedImageBytes>50*1024*1024)fail('新增图片总量超过预算');
          delete e.assetId;e.src=asset.src;e.imageWidth=asset.width;e.imageHeight=asset.height;
          const scale=Math.min(1,320/asset.width,240/asset.height,project.canvas.width/asset.width,project.canvas.height/asset.height);
          if(!Object.hasOwn(operation.element,'w'))e.w=Math.max(1,asset.width*scale);
          if(!Object.hasOwn(operation.element,'h'))e.h=Math.max(1,asset.height*scale);
        }
        if(type==='basicShape') {
          if(['ellipse','diamond','triangle','rightTriangle','pentagon','hexagon','star5','heart','cross'].includes(e.shapeKind)) { if(!Object.hasOwn(operation.element,'w'))e.w=120;if(!Object.hasOwn(operation.element,'h'))e.h=100; }
          if(!Object.hasOwn(operation.element,'text')&&['arrowRight','arrowLeft','arrowUp','arrowDown','arrowBoth','chevron','notchedArrow'].includes(e.shapeKind)) e.text='箭头文字';
        }
        if(type==='tokenGrid') { const d=dimensions(e); if(!Object.hasOwn(operation.element,'w')) e.w=d.w; if(!Object.hasOwn(operation.element,'h'))e.h=d.h; }
        if(type==='formula')latex(e.latex);
        syncArrows(e,operation.element); validateElement(e);
        project.elements.push(e); touched.add(e.id);
      } else if(operation.op==='update') {
        id(operation.id); const e=project.elements.find(e=>e.id===operation.id); if(!e) fail('找不到元素 '+operation.id);
        if(e.type==='tokenGrid'&&e.colorMode==='image') {
          record(operation.changes,'元素修改');
          for(const key of ['rows','cols','colorMode','colorChannels']) if(Object.hasOwn(operation.changes,key)) {
            const value=operation.changes[key],previous=e[key],same=key==='colorChannels'?Array.isArray(value)&&Array.isArray(previous)&&value.length===previous.length&&value.every((v,i)=>v===previous[i]):value===previous;
            if(!same) fail('图片模式的行列、颜色模式和通道需要在网页图片池化面板修改');
          }
          const fields={...operation.changes};if(fields.colorMode==='image')delete fields.colorMode;validateFields(fields,allowed(e.type));
        } else validateFields(operation.changes,allowed(e.type));
        const previous=clone(e); Object.assign(e,clone(operation.changes)); resizeGridColors(e,previous,operation.changes); syncArrows(e,operation.changes); validateElement(e); touched.add(e.id);
        if(e.type==='tokenGrid'&&GRID.some(k=>Object.hasOwn(operation.changes,k))) { const d=dimensions(e); if(!Object.hasOwn(operation.changes,'w'))e.w=d.w;if(!Object.hasOwn(operation.changes,'h'))e.h=d.h; }
      } else if(operation.op==='delete') {
        id(operation.id); const target=project.elements.find(e=>e.id===operation.id); if(!target) fail('找不到删除元素');
        for(const e of project.elements) if(e.type==='connector') for(const key of ['from','to']) if(e[key+'Id']===target.id) {const p=endpoint(target,e,key); e[key+'X']=p.x;e[key+'Y']=p.y;e[key+'Id']=null;}
        project.elements=project.elements.filter(e=>e.id!==operation.id);
        for(const g of project.groups)g.memberIds=g.memberIds.filter(member=>member!==operation.id);
        project.groups=project.groups.filter(g=>g.memberIds.length);
      } else if(operation.op==='group') {
        id(operation.id); keys(operation.changes,['name','memberIds','autoStack','stackX','stackY'],'组合修改');
        const changes=operation.changes;
        if(Object.hasOwn(changes,'name'))string(changes.name,200,'组合名称');
        if(Object.hasOwn(changes,'autoStack')&&typeof changes.autoStack!=='boolean')fail('autoStack 必须是布尔值');
        for(const k of ['stackX','stackY'])if(Object.hasOwn(changes,k)&&(typeof changes[k]!=='number'||!Number.isFinite(changes[k])||Math.abs(changes[k])>200))fail('组合偏移超出范围（'+k+' 必须为 -200～200 的有限数值）');
        let g=project.groups.find(g=>g.id===operation.id);
        if(!g){if(project.elements.some(e=>e.id===operation.id))fail('组合 ID 与元素重复');if(!Object.hasOwn(changes,'memberIds'))fail('新组合需要 memberIds');g={id:operation.id,name:'组合',memberIds:[],autoStack:false,stackX:12,stackY:12};project.groups.push(g);}
        if(Object.hasOwn(changes,'memberIds')){
          list(changes.memberIds,500,'组合成员');
          if(!Array.isArray(changes.memberIds)||changes.memberIds.length>500||new Set(changes.memberIds).size!==changes.memberIds.length)fail('组合成员数无效或重复');
          for(const member of changes.memberIds){id(member);const e=project.elements.find(e=>e.id===member);if(!e||e.type==='connector')fail('组合成员不存在或是连接线');}
          for(const e of project.elements)if(e.groupId===g.id)e.groupId=null;
          for(const other of project.groups)if(other!==g)other.memberIds=other.memberIds.filter(member=>!changes.memberIds.includes(member));
          changes.memberIds.forEach(member=>{project.elements.find(e=>e.id===member).groupId=g.id;});
        }
        Object.assign(g,clone(changes));project.groups=project.groups.filter(group=>group.memberIds.length);if(['memberIds','autoStack','stackX','stackY'].some(k=>Object.hasOwn(changes,k)))stacked.add(g.id);
      } else if(operation.op==='ungroup') {
        id(operation.id);if(!project.groups.some(g=>g.id===operation.id))fail('找不到组合');
        project.groups=project.groups.filter(g=>g.id!==operation.id);project.elements.forEach(e=>{if(e.groupId===operation.id)e.groupId=null;});
      } else if(operation.op==='canvas') { validateFields(operation.changes,CANVAS);Object.assign(project.canvas,clone(operation.changes)); }
      else if(operation.op==='rename') { string(operation.name,200,'项目名称');project.name=operation.name; }
      else {project.elements=[];project.groups=[];}
    }
    for(const g of project.groups)if(g.autoStack&&stacked.has(g.id)){const members=project.elements.filter(e=>g.memberIds.includes(e.id)),first=members[0];members.forEach((e,i)=>{if(!e.locked){e.x=first.x+i*g.stackX;e.y=first.y-i*g.stackY;}});}
    if(project.groups.length>Math.max(500,(snapshot.groups||[]).length))fail('组合数量超过预算');
    if(project.elements.length>Math.max(500,initialCount)) fail('元素数量超过预算');
    if(budget(project.elements)>Math.max(10000,initialBudget)) fail('Token 总绘制单元超过预算');
    for(const e of project.elements) if(e.type==='connector'&&touched.has(e.id)) for(const key of ['from','to']) if(e[key+'Id']) { const target=project.elements.find(n=>n.id===e[key+'Id']);if(!target||target.type==='connector')fail('连接线引用不存在或引用连接线'); }
    return project;
  }
  function resizeGridColors(e,previous,changes) {
    if(e.type!=='tokenGrid'||e.colorMode==='image')return;
    if((e.rows!==previous.rows||e.cols!==previous.cols)&&Array.isArray(previous.cellColors)&&!Object.hasOwn(changes,'cellColors')){
      const colors=Array(e.rows*e.cols).fill(/^#[0-9a-f]{6}$/i.test(e.fill)?e.fill:'#5965dc');
      for(let r=0;r<Math.min(e.rows,previous.rows);r++)for(let c=0;c<Math.min(e.cols,previous.cols);c++)colors[r*e.cols+c]=previous.cellColors[r*previous.cols+c];
      e.cellColors=colors;
    }
    if(e.depthCount!==previous.depthCount&&Array.isArray(previous.gradientLayers)&&!Object.hasOwn(changes,'gradientLayers')){
      e.gradientLayers=previous.gradientLayers.slice(0,e.depthCount);
      while(e.gradientLayers.length<e.depthCount)e.gradientLayers.push(clone(previous.gradientLayers.at(-1)||{tl:'#ffffff',tr:'#e8f1fb',bl:'#c8d9ee',br:'#f5f9ff'}));
    }
    if((e.rows!==previous.rows||e.cols!==previous.cols)&&!Object.hasOwn(changes,'cellColorIndex')&&e.cellColorIndex!==undefined)e.cellColorIndex=Math.min(e.cellColorIndex,e.rows*e.cols-1);
    if(e.depthCount!==previous.depthCount&&!Object.hasOwn(changes,'gradientEditLayer')&&e.gradientEditLayer!==undefined)e.gradientEditLayer=Math.min(e.gradientEditLayer,e.depthCount-1);
  }
  function syncArrows(e,changes) {
    if(e.type!=='connector')return;
    for(const end of ['Start','End']){const style='arrow'+end+'Style',flag='arrow'+end;if(Object.hasOwn(changes,style))e[flag]=e[style]!=='none';else if(Object.hasOwn(changes,flag))e[style]=e[flag]?'triangle':'none';}
    if(Object.hasOwn(changes,'curveControls')&&changes.curveControls!==null)e.curveControlVersion=2;
  }
  function describe(snapshot) {
    const context={name:snapshot.name,canvas:clone(snapshot.canvas),elements:snapshot.elements.map(e=>{
      const out={id:e.id,type:e.type};if(Object.hasOwn(e,'groupId'))out.groupId=e.groupId;for(const key of allowed(e.type).filter(k=>!['formulaTemplateId','formulaValues'].includes(k))) if(Object.hasOwn(e,key))out[key]=clone(e[key]);
      if(e.type==='tokenGrid'&&e.colorMode==='image')out.hasPooledImage=true;
      if(e.type==='image'){out.hasImage=true;for(const key of ['imageWidth','imageHeight'])if(Object.hasOwn(e,key))out[key]=e[key];}
      return out;
    })};
    context.groups=(snapshot.groups||[]).map(g=>({id:g.id,name:g.name,memberIds:clone(g.memberIds||[]),autoStack:!!g.autoStack,stackX:g.stackX,stackY:g.stackY}));
    if(Object.hasOwn(snapshot,'fileId'))context.fileId=snapshot.fileId;
    if(Object.hasOwn(snapshot,'selection'))context.selection=clone(snapshot.selection);
    return context;
  }
  // Describe the same field rules used by validation, for prompts and tool schemas.
  function contract() {
    const identifier={type:'string',minLength:1,maxLength:80,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$',not:{enum:['__proto__','constructor','prototype']}};
    const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
    const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
    const pointSchema=object({x:{type:'number',minimum:-100000,maximum:100000},y:{type:'number',minimum:-100000,maximum:100000}});
    const cornerSchema=object(Object.fromEntries(['tl','tr','bl','br'].map(k=>[k,hex])));
    const fields={id:identifier,type:{type:'string',enum:TYPES.slice()}};
    BOOL.forEach(k=>fields[k]={type:'boolean'});
    Object.entries(NUMBERS).forEach(([k,[min,max,integer]])=>fields[k]={type:integer?'integer':'number',minimum:min,...(Number.isFinite(max)?{maximum:max}:{})});
    Object.entries(ENUMS).forEach(([k,values])=>fields[k]={type:'string',enum:values.slice()});
    ['fill','stroke','textColor','bg'].forEach(k=>fields[k]={type:'string',pattern:'^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$'});
    fields.fontFamily={type:'string',minLength:1,maxLength:80,description:'只能包含字母、数字、空格、下划线、横线；默认 HarmonyOS Sans SC'};
    ['text','latex'].forEach(k=>fields[k]={type:'string',maxLength:10000});
    ['fromId','toId'].forEach(k=>fields[k]={anyOf:[identifier,{type:'null'}]});
    ['formulaTemplateId','formulaValues'].forEach(k=>fields[k]={type:'null'});
    fields.assetId={...identifier,description:'本次可信前端参考图片的 assetId；不能使用 URL 或 src'};
    fields.transparentColor={anyOf:[hex,{type:'null'}],description:'设为六位十六进制颜色将匹配像素变透明；null 关闭透明色'};
    fields.crop={anyOf:[object({x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},w:{type:'number',exclusiveMinimum:0,maximum:1},h:{type:'number',exclusiveMinimum:0,maximum:1}}),{type:'null'}],description:'源图归一化裁切坐标；x+w <= 1 且 y+h <= 1；null 恢复完整图片'};
    fields.gradientColors=cornerSchema;
    fields.gradientLayers={type:'array',minItems:1,maxItems:20,items:cornerSchema};
    fields.cellColors={type:'array',minItems:1,maxItems:10000,items:hex};
    fields.routePoints={type:'array',maxItems:100,items:pointSchema};
    fields.curveControls={anyOf:[object({from:pointSchema,to:pointSchema}),{type:'null'}]};
    fields.colorChannels={type:'array',minItems:1,maxItems:6,uniqueItems:true,items:{type:'string',enum:['r','g','b','a','color','gray']}};
    return {
      addTypes:TYPES.slice(),
      elementFields:Object.fromEntries([...TYPES,'image','group'].map(type=>[type,[...new Set(allowed(type))]])),
      fields,canvasFields:CANVAS.slice(),
      groupFields:{name:{type:'string',maxLength:200},memberIds:{type:'array',maxItems:500,uniqueItems:true,items:identifier},autoStack:{type:'boolean'},stackX:{type:'number',minimum:-200,maximum:200},stackY:{type:'number',minimum:-200,maximum:200}},
      operationFields:{add:['op','element'],update:['op','id','changes'],delete:['op','id'],canvas:['op','changes'],rename:['op','name'],clear:['op'],group:['op','id','changes'],ungroup:['op','id']}
    };
  }
  root.FlowSketchAIEngine=Object.freeze({apply,describe,contract});
})(typeof window==='undefined'?globalThis:window);
