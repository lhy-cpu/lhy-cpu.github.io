/* Non-destructive source cropping; the project keeps the original image. */
(function(root){
  'use strict';
  const $=id=>root.document.getElementById(id);
  const limit=(v,a,b)=>Math.max(a,Math.min(b,v));
  async function open(element,actions){
    const images=root.FlowSketchImages;
    try{await images.ensureSourceSize(element)}catch{actions.toast('无法读取图片，暂时不能裁切。');return}
    if(actions.isCurrent&&!actions.isCurrent(element))return;
    const size=images.sourceSize(element),draft={...element,crop:images.normalizedCrop(element.crop)||{x:0,y:0,w:1,h:1}};
    const field=(label,key)=>`<label>${label}（%）<input class="field" type="number" data-crop-field="${key}" min="${key==='w'||key==='h'?0.01:0}" max="100" step="0.1"></label>`;
    actions.modal('编辑图片',`<p class="hint">拖动画框移动裁切范围，拖动四角调整大小。原图会保留，可随时恢复。</p><div class="image-crop-layout"><div><div id="imageCropStage" class="image-crop-stage"><img id="imageCropSource" draggable="false" alt="原图"><div id="imageCropBox" class="image-crop-box" role="group" aria-label="裁切区域"><i data-crop-corner="nw"></i><i data-crop-corner="ne"></i><i data-crop-corner="sw"></i><i data-crop-corner="se"></i></div></div><div class="image-crop-presets"><button class="btn" data-crop-ratio="1">正方形</button><button class="btn" data-crop-ratio="1.7777777777777777">16:9</button><button class="btn" data-crop-ratio="0.75">3:4</button><button class="btn" id="imageCropReset">完整原图</button></div><div class="image-crop-fields">${field('左侧','x')}${field('顶部','y')}${field('宽度','w')}${field('高度','h')}</div></div><div><div class="prop-title">裁切预览</div><div id="imageCropPreview" class="image-crop-preview"></div><label class="check"><input id="imageCropAspect" type="checkbox" checked> 画框适应裁切比例</label><label class="check"><input id="imageCropFlipX" type="checkbox" ${draft.flipX?'checked':''}> 水平翻转</label><label class="check"><input id="imageCropFlipY" type="checkbox" ${draft.flipY?'checked':''}> 垂直翻转</label><div class="row"><label>显示</label><select class="field" id="imageCropFit"><option value="contain">完整显示</option><option value="cover">填满画框</option></select></div><p class="hint">预览显示裁切和翻转，画布上的旋转角度保持不变。</p><p id="imageCropError" role="alert" class="image-crop-error"></p></div></div>`,`<button class="btn" id="imageCropCancel">取消</button><button class="btn primary" id="imageCropApply">应用</button>`);
    root.document.querySelector('#modal .modal').classList.add('image-edit-modal');
    $('imageCropSource').src=images.safeSource(element.src);
    $('imageCropError').insertAdjacentHTML('beforebegin',`<div class="image-color-key"><label class="check"><input id="imageTransparentEnabled" type="checkbox" ${draft.transparentColor?'checked':''}> 指定颜色透明</label><div class="row"><input id="imageTransparentColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(draft.transparentColor||'')?draft.transparentColor:'#ffffff'}" aria-label="透明颜色"><button class="btn" id="imagePickColor">从原图取色</button></div><div class="row"><label for="imageColorTolerance">容差</label><input class="field" id="imageColorTolerance" type="number" min="0" max="255" step="1" value="${Number.isInteger(draft.colorTolerance)?draft.colorTolerance:24}" aria-label="颜色容差"></div><p class="hint">0 为精确匹配；提高容差可去除近似背景色。</p></div>`);
    const scale=Math.min(580/size.width,Math.min(340,root.innerHeight*.35)/size.height,1);
    Object.assign($('imageCropStage').style,{width:size.width*scale+'px',aspectRatio:`${size.width}/${size.height}`});
    $('imageCropFit').value=draft.fit==='contain'?'contain':'cover';
    const fields=[...root.document.querySelectorAll('[data-crop-field]')];
    function update(sync=true){
      const c=draft.crop,box=$('imageCropBox');
      Object.assign(box.style,{left:c.x*100+'%',top:c.y*100+'%',width:c.w*100+'%',height:c.h*100+'%'});
      if(sync)fields.forEach(n=>n.value=+(c[n.dataset.cropField]*100).toFixed(4));
      const ratio=$('imageCropAspect').checked?(size.width*c.w)/(size.height*c.h):draft.w/draft.h;
      const w=Math.min(220,160*ratio),h=w/ratio;
      const preview=$('imageCropPreview');Object.assign(preview.style,{width:w+'px',height:h+'px'});
      preview.replaceChildren(images.createElement({...draft,w,h}));
      $('imageCropError').textContent='';$('imageCropApply').disabled=false;
    }
    fields.forEach(n=>n.oninput=()=>{
      const candidate=Object.fromEntries(fields.map(input=>[input.dataset.cropField,Number(input.value)/100]));
      const c=images.normalizedCrop(candidate);
      if(!fields.every(input=>input.value.trim())||!c){$('imageCropError').textContent='裁切区域必须在原图内，宽度和高度必须大于 0。';$('imageCropApply').disabled=true;return}
      draft.crop=c;update(false);
    });
    root.document.querySelectorAll('[data-crop-ratio]').forEach(n=>n.onclick=()=>{
      const ratio=Number(n.dataset.cropRatio),c=draft.crop,cx=c.x+c.w/2,cy=c.y+c.h/2;
      let w=c.w,h=w*size.width/(ratio*size.height);if(h>c.h){h=c.h;w=h*ratio*size.height/size.width}
      draft.crop={x:limit(cx-w/2,0,1-w),y:limit(cy-h/2,0,1-h),w,h};update();
    });
    $('imageCropReset').onclick=()=>{draft.crop={x:0,y:0,w:1,h:1};update()};
    $('imageCropFlipX').onchange=ev=>{draft.flipX=ev.target.checked;update()};
    $('imageCropFlipY').onchange=ev=>{draft.flipY=ev.target.checked;update()};
    $('imageCropFit').onchange=ev=>{draft.fit=ev.target.value;update()};
    $('imageCropAspect').onchange=()=>update();
    const stage=$('imageCropStage'),box=$('imageCropBox');let drag=null,picking=false;
    function readColor(){draft.transparentColor=$('imageTransparentEnabled').checked?$('imageTransparentColor').value:null;draft.colorTolerance=limit(Math.round(Number($('imageColorTolerance').value)||0),0,255);update()}
    $('imageTransparentEnabled').onchange=readColor;$('imageTransparentColor').oninput=()=>{$('imageTransparentEnabled').checked=true;readColor()};$('imageColorTolerance').oninput=readColor;
    $('imagePickColor').onclick=()=>{picking=!picking;stage.classList.toggle('picking-color',picking);$('imagePickColor').textContent=picking?'点击原图取色…':'从原图取色'};
    async function pick(ev){ev.preventDefault();ev.stopPropagation();const rect=stage.getBoundingClientRect();try{const color=await images.sampleColor(element,(ev.clientX-rect.left)/rect.width,(ev.clientY-rect.top)/rect.height);if(!$('imageTransparentColor'))return;$('imageTransparentColor').value=color;$('imageTransparentEnabled').checked=true;picking=false;stage.classList.remove('picking-color');$('imagePickColor').textContent='从原图取色';readColor()}catch{$('imageCropError').textContent='取色失败，请使用颜色选择器。'}}
    stage.onpointerdown=ev=>{if(picking)pick(ev)};
    box.onpointerdown=ev=>{if(ev.button!==0)return;if(picking){pick(ev);return}ev.preventDefault();ev.stopPropagation();const rect=stage.getBoundingClientRect();drag={id:ev.pointerId,startX:ev.clientX,startY:ev.clientY,rect,c:{...draft.crop},corner:ev.target.dataset.cropCorner};box.setPointerCapture(ev.pointerId)};
    box.onpointermove=ev=>{if(!drag||ev.pointerId!==drag.id)return;const {c,rect,corner}=drag,dx=(ev.clientX-drag.startX)/rect.width,dy=(ev.clientY-drag.startY)/rect.height;let x=c.x,y=c.y,r=c.x+c.w,b=c.y+c.h;
      if(!corner){x=limit(c.x+dx,0,1-c.w);y=limit(c.y+dy,0,1-c.h);r=x+c.w;b=y+c.h}
      else{const minW=Math.min(1,1/size.width),minH=Math.min(1,1/size.height);if(corner.includes('w'))x=limit(c.x+dx,0,r-minW);if(corner.includes('e'))r=limit(c.x+c.w+dx,x+minW,1);if(corner.includes('n'))y=limit(c.y+dy,0,b-minH);if(corner.includes('s'))b=limit(c.y+c.h+dy,y+minH,1)}
      draft.crop={x,y,w:r-x,h:b-y};update();
    };
    box.onpointerup=box.onpointercancel=()=>{drag=null};
    $('imageCropCancel').onclick=actions.close;
    $('imageCropApply').onclick=()=>{
      if($('imageCropApply').disabled)return;
      if(actions.isCurrent&&!actions.isCurrent(element)){$('imageCropError').textContent='图片或文件已变化，请关闭窗口后重新编辑。';return}
      const c=draft.crop,patch={crop:c.x===0&&c.y===0&&c.w===1&&c.h===1?null:{...c},flipX:draft.flipX===true,flipY:draft.flipY===true,fit:draft.fit==='contain'?'contain':'cover',transparentColor:draft.transparentColor||null,colorTolerance:Number.isInteger(draft.colorTolerance)?draft.colorTolerance:24};
      if($('imageCropAspect').checked)patch.h=limit(element.w*(size.height*c.h)/(size.width*c.w),1,20000);
      if(actions.onApply(element,patch)===false){$('imageCropError').textContent='图片未更新，请重新打开编辑窗口。';return}actions.close();actions.toast('图片已更新，可撤销或恢复原图。');
    };
    update();
  }
  root.FlowSketchImageControls=Object.freeze({open});
})(window);
