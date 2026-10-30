'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fflate=require('../assets/vendor/fflate.min.js');
const window={fflate};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/flowsketch-pptx.js'),'utf8'),{window,Uint8Array});
async function packageFiles(){
  return fflate.unzipSync(await window.FlowSketchPptx.generate({name:'Package regression',width:800,height:600,items:[],media:[]}));
}
function ids(source,tag){return [...source.matchAll(new RegExp(`<p:${tag}\\b[^>]*\\bid="(\\d+)"`,'g'))].map(match=>Number(match[1]))}
test('slide, master and layout identifiers use their distinct PresentationML ranges',async()=>{
  const files=await packageFiles(),presentation=fflate.strFromU8(files['ppt/presentation.xml']),master=fflate.strFromU8(files['ppt/slideMasters/slideMaster1.xml']);
  const slideIds=ids(presentation,'sldId'),masterIds=ids(presentation,'sldMasterId'),layoutIds=ids(master,'sldLayoutId');
  assert.equal(slideIds.length,1);assert.equal(masterIds.length,1);assert.equal(layoutIds.length,1);
  for(const id of slideIds)assert.ok(id>=256&&id<2147483648,`Slide ID ${id} is outside the slide range`);
  for(const id of [...masterIds,...layoutIds])assert.ok(id>=2147483648&&id<=4294967295,`Master/layout ID ${id} is outside the unsigned high range`);
  assert.equal(new Set([...masterIds,...layoutIds]).size,masterIds.length+layoutIds.length);
});
test('all internal package relationships resolve and IDs are unique within each relationship part',async()=>{
  const files=await packageFiles();
  for(const [name,bytes] of Object.entries(files).filter(([name])=>name.endsWith('.rels'))){
    const relationships=[...fflate.strFromU8(bytes).matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)];
    assert.ok(relationships.length,name);
    assert.equal(new Set(relationships.map(match=>match[1])).size,relationships.length,name);
    const folder=name==='_rels/.rels'?'':path.posix.dirname(path.posix.dirname(name));
    for(const [,id,target] of relationships)assert.ok(files[path.posix.normalize(path.posix.join(folder,target))],`${name} ${id} has a missing target ${target}`);
  }
});
