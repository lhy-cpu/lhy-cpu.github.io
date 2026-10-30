'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
for(const filename of ['draw.md','draw.en.md']){
  const source=fs.readFileSync(path.join(root,filename),'utf8');
  const examples=[...source.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(match=>{
    const text=match[1].trim();return JSON.parse(text.startsWith('"groups"')?'{'+text+'}':text);
  });
  test(`${filename}: every JSON example parses and full projects have valid IDs and references`,()=>{
    assert.ok(examples.length>=7);
    for(const project of examples.filter(example=>example.canvas&&Array.isArray(example.elements))){
      assert.equal(project.version,12);assert.ok(Array.isArray(project.groups));
      const ids=project.elements.map(element=>element.id);assert.equal(new Set(ids).size,ids.length);
      for(const element of project.elements)for(const key of ['fromId','toId'])if(element[key])assert.ok(ids.includes(element[key]));
      for(const group of project.groups)for(const id of group.memberIds){assert.ok(ids.includes(id));assert.equal(project.elements.find(element=>element.id===id).groupId,group.id)}
    }
  });
  test(`${filename}: token examples agree with their dimensions, cell colors and depth`,()=>{
    const matrices=examples.filter(example=>example.type==='tokenGrid');assert.ok(matrices.length);
    for(const element of matrices){
      assert.equal(element.cellColors.length,element.rows*element.cols);assert.equal(element.gradientLayers.length,element.depthCount);
      const layers=element.colorMode==='image'?element.colorChannels.length:element.depthCount,extrude=element.token3d?element.extrude:0;
      assert.equal(element.w,element.cols*element.cellW+(element.cols-1)*element.gapX+extrude+(layers-1)*element.stackX);
      assert.equal(element.h,element.rows*element.cellH+(element.rows-1)*element.gapY+extrude+(layers-1)*element.stackY);
    }
  });
}
test('drawing specifications and user guides link to existing local files',()=>{
  for(const filename of ['draw.md','draw.en.md','README.md','README.en.md','AI.md']){
    const source=fs.readFileSync(path.join(root,filename),'utf8');
    for(const [,target] of source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)){
      if(/^[a-z][a-z0-9+.-]*:/i.test(target)||target.startsWith('#'))continue;
      const local=decodeURIComponent(target.split('#')[0]);assert.ok(fs.existsSync(path.resolve(root,local)),`${filename}: ${target}`);
    }
  }
});
