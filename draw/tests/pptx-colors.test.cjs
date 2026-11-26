'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fflate=require('../assets/vendor/fflate.min.js');
const window={fflate,FlowSketchConnectorPaint:require('../assets/js/connector-paint.js')};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/flowsketch-pptx.js'),'utf8'),{window,Uint8Array});
const {parseColor,generate}=window.FlowSketchPptx;
test('CSS colours resolve to six-digit sRGB plus alpha for DrawingML',()=>{
  const cases={'#fff':['FFFFFF',1],'#EFF6FF':['EFF6FF',1],'#ff000080':['FF0000',128/255],'red':['FF0000',1],'RebeccaPurple':['663399',1],
    'rgb(16, 185, 129)':['10B981',1],'rgba(0,0,0,.5)':['000000',.5],'rgb(16 185 129 / 50%)':['10B981',.5],'hsl(120, 100%, 25%)':['008000',1],'hsla(240,100%,50%,0.25)':['0000FF',.25]};
  for(const [input,[hex,alpha]] of Object.entries(cases)){const c=parseColor(input);assert.equal(c.hex,hex,input);assert.ok(Math.abs(c.alpha-alpha)<1e-9,input)}
  for(const none of ['transparent','none','','bogus','rgb(1,2)','url(x)',null])assert.equal(parseColor(none),null);
});
test('exported shapes never contain non-hex colour values',async()=>{
  const shape=(fill,stroke,textColor,x)=>({type:'shape',kind:'rect',x,y:10,w:80,h:40,fill,stroke,strokeWidth:2,textColor,text:'A',opacity:1});
  const items=[shape('#fff','red','navy',10),shape('rgb(16, 185, 129)','hsl(0 0% 20%)','rgba(0,0,0,.5)',100),shape('transparent','bogus','#ff000080',200)];
  const xml=fflate.strFromU8(fflate.unzipSync(await generate({width:400,height:100,items,media:[]}))['ppt/slides/slide1.xml']);
  const values=[...xml.matchAll(/srgbClr val="([^"]*)"/g)].map(m=>m[1]);
  assert.ok(values.length>=6);assert.deepEqual(values.filter(v=>!/^[0-9A-F]{6}$/.test(v)),[]);
  assert.ok(xml.includes('<a:srgbClr val="10B981">'));assert.ok(/<a:srgbClr val="000000"><a:alpha val="50000"\/>/.test(xml));
});
