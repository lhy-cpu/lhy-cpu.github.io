'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const catalogSource=html.slice(html.indexOf('  const shapeCatalog=')+'  const shapeCatalog='.length,html.indexOf('\n  ];',html.indexOf('  const shapeCatalog='))+5);
const shapeCatalog=vm.runInNewContext(catalogSource);
const base=(id,type,x,y,extra={})=>({id,type,x,y,w:190,h:95,rotation:0,opacity:1,visible:true,locked:false,text:'',fontSize:18,fontWeight:600,fontFamily:'HarmonyOS Sans SC',textColor:'#172554',fill:'#dbeafe',stroke:'#2563eb',strokeWidth:2,radius:8,align:'center',vAlign:'center',padding:8,dash:false,shadow:false,colorMode:'solid',...extra});
const project=(name,elements,groups=[])=>({version:12,name,canvas:{width:1600,height:1200,bg:'#ffffff',grid:false,gridSize:20,snap:true,theme:0},elements,groups});
const label=(id,text,x,y,w=230)=>base(id,'text',x,y,{text,w,h:30,fontSize:18,align:'left',fill:'transparent',strokeWidth:0,padding:0});
const shapeElements=[];
shapeCatalog.forEach((shape,index)=>{
  const x=45+index%6*260,y=45+Math.floor(index/6)*210;
  shapeElements.push(label('label-'+shape.kind,shape.name,x,y));
  shapeElements.push(base('shape-'+shape.kind,'basicShape',x,y+45,{shapeKind:shape.kind,fill:shape.kind.startsWith('brace')?'transparent':'#dbeafe',text:shape.kind.startsWith('brace')?'':'Aa 中',h:120}));
});
const variants=[
  ['Rounded rect',{type:'basicShape',shapeKind:'rect',radius:24}],
  ['Rotated dashed',{type:'basicShape',shapeKind:'rect',rotation:20,dash:true,opacity:.5}],
  ['Gradient + shadow',{type:'basicShape',shapeKind:'rect',colorMode:'gradient',shadow:true,gradientColors:{tl:'#ef4444',tr:'#facc15',bl:'#3b82f6',br:'#22c55e'}}],
  ['Note',{type:'note',fill:'#fef08a'}],
  ['Text + XML chars',{type:'text',text:'中文 & <text>\nBold / italic',fontWeight:700,italic:true,align:'left',vAlign:'top',fill:'transparent',strokeWidth:0}],
  ['Legacy token',{type:'token',text:'Token',fill:'#6366f1',textColor:'#ffffff'}],
  ['Legacy group',{type:'group',text:'Legacy frame',fill:'transparent',dash:true}],
  ['No fill / no line',{type:'basicShape',shapeKind:'ellipse',fill:'transparent',strokeWidth:0,text:'Text only'}]
];
variants.forEach(([name,extra],index)=>{
  const x=45+index%4*385,y=900+Math.floor(index/4)*145;
  shapeElements.push(label('variant-label-'+index,name,x,y,350));
  shapeElements.push(base('variant-'+index,extra.type,x,y+35,{w:280,h:85,text:name,...extra}));
});
shapeElements.push(base('hidden-shape','basicShape',0,0,{shapeKind:'rect',visible:false,text:'HIDDEN_SENTINEL'}));
const shapes=project('PPTX all shapes and styles',shapeElements);
const connectorElements=[],routes=['straight','orthogonal','curve'],arrowStyles=['none','triangle','stealth','open','diamond','circle'];
for(const [row,style] of arrowStyles.entries())for(const [column,route] of routes.entries()){
  const x=45+column*520,y=40+row*145;
  connectorElements.push(label(`label-${route}-${style}`,`${route} / ${style}`,x,y,450));
  connectorElements.push(base(`${route}-${style}`,'connector',0,0,{fromX:x+30,fromY:y+65,toX:x+425,toY:y+95,route,routeBias:row%2?'vertical':'horizontal',routePoints:[],curveControls:route==='curve'?{from:{x:120,y:-35},to:{x:-120,y:35}}:null,curveControlVersion:2,strokeWidth:row+1,dash:row%2===1,arrowStartStyle:style,arrowEndStyle:style,arrowWidth:18+row*5,arrowLength:22+row*6}));
}
const edgeCases=[
  {name:'Thick / small arrows',fromX:70,fromY:1020,toX:430,toY:1020,strokeWidth:30,arrowWidth:12,arrowLength:14},
  {name:'Reverse curve',fromX:940,fromY:1020,toX:570,toY:980,route:'curve',curveControls:{from:{x:-100,y:-60},to:{x:100,y:60}}},
  {name:'Manual detour',fromX:1100,fromY:970,toX:1510,toY:1050,route:'orthogonal',routePoints:[{x:1250,y:970},{x:1250,y:1100},{x:1410,y:1100}]}
];
edgeCases.forEach((extra,index)=>{
  connectorElements.push(label('edge-label-'+index,extra.name,45+index*520,925,450));
  connectorElements.push(base('edge-'+index,'connector',0,0,{route:'straight',routePoints:[],strokeWidth:5,arrowStartStyle:'triangle',arrowEndStyle:'open',arrowWidth:30,arrowLength:35,...extra}));
});
const connectors=project('PPTX all connectors',connectorElements);
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="white"/><rect width="120" height="60" fill="#ef4444"/><rect x="120" width="120" height="60" fill="#22c55e"/><rect y="60" width="120" height="60" fill="#3b82f6"/><text x="145" y="100" font-size="30">TEST</text></svg>';
const svgSource='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
function pngChunk(type,data){
  const body=Buffer.concat([Buffer.from(type),data]),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);
  let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,body,checksum]);
}
const pngHeader=Buffer.alloc(13);pngHeader.writeUInt32BE(80,0);pngHeader.writeUInt32BE(40,4);pngHeader[8]=8;pngHeader[9]=6;
const pngPixels=Buffer.alloc(40*(1+80*4));
for(let row=0;row<40;row++)for(let column=0;column<80;column++){
  const offset=row*(1+80*4)+1+column*4;pngPixels.set(column<40?[239,68,68,255]:[34,197,94,row<20?255:100],offset);
}
const pngSource='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',pngHeader),pngChunk('IDAT',require('node:zlib').deflateSync(pngPixels)),pngChunk('IEND',Buffer.alloc(0))]).toString('base64');
const jpegSource='data:image/jpeg;base64,'+fs.readFileSync(path.join(__dirname,'../../assets/readme-editor.jpg')).toString('base64');
const imageCases=[['SVG contain',{fit:'contain'}],['SVG cover',{fit:'cover'}],['Crop + horizontal flip',{crop:{x:.1,y:.1,w:.65,h:.8},flipX:true}],['Vertical flip',{flipY:true}],['Rotation + opacity',{rotation:12,opacity:.45}],['White color key',{transparentColor:'#ffffff',colorTolerance:0}],['PNG',{src:pngSource}],['JPEG',{src:jpegSource}]];
const mediaElements=[];
imageCases.forEach(([name,extra],index)=>{
  const x=45+index%4*390,y=35+Math.floor(index/4)*220;
  mediaElements.push(label('image-label-'+index,name,x,y,350));
  mediaElements.push(base('image-'+index,'image',x,y+40,{src:svgSource,w:280,h:140,fit:'contain',fill:'transparent',strokeWidth:0,...extra}));
});
const tokenCases=[
  ['Solid 2D',{token3d:false}],['Solid 3D + layers',{token3d:true,depthCount:3}],
  ['Cell colors',{token3d:true,colorMode:'cells',cellColors:['#ef4444','#22c55e','#3b82f6','#facc15','#a855f7','#06b6d4']}],
  ['Gradient layers',{colorMode:'gradient',depthCount:2,gradientLayers:[{tl:'#ef4444',tr:'#22c55e',bl:'#3b82f6',br:'#facc15'},{tl:'#a855f7',tr:'#06b6d4',bl:'#f97316',br:'#ec4899'}]}],
  ['Image RGBA + gray',{colorMode:'image',colorImage:svgSource,colorChannels:['r','g','b','a','color','gray'],poolRows:2,poolCols:3,poolColors:[[255,0,0,255],[0,255,0,255],[0,0,255,255],[240,210,0,150],[30,100,230,70],[255,255,255,255]]}],
  ['Rotated + translucent',{token3d:true,rotation:15,opacity:.6,depthCount:2}]
];
tokenCases.forEach(([name,extra],index)=>{
  const x=45+index%3*520,y=495+Math.floor(index/3)*260;
  mediaElements.push(label('token-label-'+index,name,x,y,450));
  mediaElements.push(base('token-'+index,'tokenGrid',x+30,y+45,{w:300,h:150,rows:2,cols:3,depthCount:1,cellW:55,cellH:35,gapX:8,gapY:8,extrude:12,stackX:10,stackY:10,colorChannels:['color'],...extra}));
});
mediaElements.push(base('group-one','basicShape',60,1060,{shapeKind:'rect',w:220,h:80,text:'Grouped A',groupId:'pair'}),base('group-two','basicShape',300,1060,{shapeKind:'ellipse',w:220,h:80,text:'Grouped B',groupId:'pair'}));
mediaElements.push(label('group-label','True group members',60,1020,480));
mediaElements.push(base('bound-edge','connector',0,0,{fromId:'group-one',fromSide:'right',toId:'group-two',toSide:'left',fromX:280,fromY:1100,toX:300,toY:1100,route:'straight',arrowEndStyle:'triangle',arrowStartStyle:'none',arrowWidth:14,arrowLength:18}));
const media=project('PPTX images tokens and groups',mediaElements,[{id:'pair',name:'True group',memberIds:['group-one','group-two'],autoStack:false,stackX:12,stackY:12}]);
module.exports={shapes,connectors,media,shapeCatalog,arrowStyles,routes};
