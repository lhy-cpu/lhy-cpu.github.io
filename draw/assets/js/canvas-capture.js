(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FlowSketchCanvasCapture=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const MAX_EDGE=1600,MAX_BYTES=8*1024*1024,MAX_NODES=30000;
  let sequence=0;
  const CONTROLS='.selected-outline,.handle,.rotate-handle,.endpoint,.connector-control,.connector-guide,.anchor-port,.selection-label,.guide,.guide-dot,.marquee,.connector-hit';
  function abortError(){const e=new Error('画布截图已取消');e.name='AbortError';return e}
  function validateURL(url){
    if(typeof url!=='string'||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(url))throw Error('画布截图编码无效');
    const payload=url.slice(url.indexOf(',')+1);
    if(url.startsWith('data:image/png;')?!payload.startsWith('iVBORw0KGgo'):!payload.startsWith('/9j/'))throw Error('画布截图编码无效');
    if(payload.length%4!==0||payload.length*3/4-(payload.endsWith('==')?2:payload.endsWith('=')?1:0)>MAX_BYTES)throw Error('画布截图超过大小限制');
    return url;
  }
  function captureRegion(region,width,height){
    if(region===undefined)return{x:0,y:0,w:width,h:height};
    if(!region||typeof region!=='object'||Array.isArray(region)||Reflect.ownKeys(region).length!==4||!['x','y','w','h'].every(key=>Object.prototype.hasOwnProperty.call(region,key)))throw Error('画布截图区域无效');
    const {x,y,w,h}=region;
    if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<1||h<1||x+w>width||y+h>height)throw Error('画布截图区域无效');
    return{x,y,w,h};
  }
  async function capture({canvas,width,height,region,background='#ffffff',signal,assertCurrent=()=>{},prepare=()=>{}}={}){
    const doc=canvas?.ownerDocument,win=doc?.defaultView||root;
    let holder,aborted=false,abortReject;
    const rendererFrames=new Set();
    const abortPromise=new Promise((_,reject)=>{abortReject=reject});
    // A catch prevents an idle abort rejection before the first awaited stage.
    abortPromise.catch(()=>{});
    function check(){if(aborted||signal?.aborted)throw abortError();assertCurrent();if(signal?.aborted)throw abortError()}
    const onAbort=()=>{aborted=true;holder?.remove();for(const frame of rendererFrames)frame.remove();abortReject(abortError())};
    async function stage(work){check();const result=await Promise.race([Promise.resolve().then(()=>{check();return work()}),abortPromise]);check();return result}
    signal?.addEventListener('abort',onAbort,{once:true});
    try{
      check();
      if(!canvas||!doc?.body||typeof canvas.cloneNode!=='function')throw Error('画布不可用');
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>32768||height>32768||width*height>268435456)throw Error('画布尺寸无效或过大');
      const bounds=captureRegion(region,width,height);
      if(canvas.querySelectorAll('*').length>MAX_NODES)throw Error('画布内容过多');
      if(typeof win.html2canvas!=='function')throw Error('PNG 组件未载入');
      if(doc.fonts?.ready)await stage(()=>doc.fonts.ready);
      check();
      const copy=canvas.cloneNode(true);
      await stage(()=>prepare(copy));
      copy.removeAttribute('id');copy.classList.remove('grid','dots','grabbing');
      copy.querySelectorAll(CONTROLS).forEach(n=>n.remove());
      copy.querySelectorAll('[contenteditable]').forEach(n=>n.setAttribute('contenteditable','false'));
      Object.assign(copy.style,{position:'absolute',left:'0',top:'0',width:width+'px',height:height+'px',transform:'none',transformOrigin:'0 0',margin:'0',border:'0',boxShadow:'none',outline:'none',background,backgroundImage:'none',overflow:'hidden'});
      holder=doc.createElement('div');holder.id='flowsketch-capture-'+(++sequence);holder.className='copy-surface';holder.setAttribute('aria-hidden','true');
      Object.assign(holder.style,{position:'fixed',left:'-100000px',top:'0',width:width+'px',height:height+'px',overflow:'hidden',background,pointerEvents:'none',transform:'none'});
      holder.append(copy);
      // Do not fetch new remote resources. Prepared image sources must be local.
      for(const img of copy.querySelectorAll('img')){
        const src=img.getAttribute('src')||'';
        if(!/^(data:image\/|blob:)/i.test(src))throw Error('画布图片尚未准备为本地资源');
        img.removeAttribute('srcset');img.removeAttribute('loading');
        if(typeof img.decode==='function')await stage(()=>img.decode());
      }
      for(const svg of [...copy.querySelectorAll('svg')]){
        check();
        for(const n of svg.querySelectorAll('[href],[xlink\\:href]')){
          const href=n.getAttribute('href')||n.getAttribute('xlink:href')||'';
          if(href&&!href.startsWith('#')&&!/^data:image\//i.test(href))throw Error('画布 SVG 包含外部资源');
        }
        if(svg.querySelector('foreignObject'))throw Error('画布 SVG 包含不支持的外部内容');
      }
      // Attach the validated clone before resolving CSS pixels, including KaTeX
      // SVGs whose intrinsic dimensions use em or percentages.
      doc.body.append(holder);
      // html2canvas does not support all SVG clip/marker semantics. A self-contained
      // SVG image preserves native clipPath, arrow markers and token geometry.
      for(const svg of [...copy.querySelectorAll('svg')]){
        check();
        const svgCopy=svg.cloneNode(true),computed=win.getComputedStyle(svg),viewBox=svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
        const svgW=parseFloat(computed.width)||Number(svg.getAttribute('width'))||viewBox?.[2],svgH=parseFloat(computed.height)||Number(svg.getAttribute('height'))||viewBox?.[3];
        if(!(svgW>0&&svgH>0))throw Error('画布 SVG 尺寸无效');
        for(const property of ['color','fill','stroke','fontFamily','fontSize'])if(computed[property])svgCopy.style[property]=computed[property];
        svgCopy.setAttribute('xmlns','http://www.w3.org/2000/svg');svgCopy.setAttribute('width',String(svgW));svgCopy.setAttribute('height',String(svgH));
        const image=doc.createElement('img');image.setAttribute('src','data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new win.XMLSerializer().serializeToString(svgCopy)));
        image.className=svg.getAttribute('class')||'';image.style.cssText=svg.style.cssText;
        Object.assign(image.style,{width:svgW+'px',height:svgH+'px',display:computed.display,position:computed.position,left:computed.left,top:computed.top,opacity:computed.opacity,transform:computed.transform,zIndex:computed.zIndex});
        svg.replaceWith(image);
        if(typeof image.decode==='function')await stage(()=>image.decode());
      }
      check();
      const scale=Math.min(1,MAX_EDGE/Math.max(bounds.w,bounds.h));
      const rendered=await stage(()=>win.html2canvas(holder,{backgroundColor:background,scale,x:bounds.x,y:bounds.y,width:bounds.w,height:bounds.h,useCORS:false,allowTaint:false,logging:false,removeContainer:true,imageTimeout:10000,scrollX:0,scrollY:0,onclone(clonedDoc){const frame=clonedDoc.defaultView?.frameElement;if(frame){rendererFrames.add(frame);if(aborted||signal?.aborted)frame.remove()}check();const surface=clonedDoc.getElementById(holder.id);if(!surface)throw Error('画布截图副本缺失');for(const sibling of [...clonedDoc.body.children])if(sibling!==surface)sibling.remove();surface.style.left='0';surface.style.top='0';check()}}));
      check();
      if(!Number.isInteger(rendered.width)||!Number.isInteger(rendered.height)||rendered.width<1||rendered.height<1||rendered.width>MAX_EDGE||rendered.height>MAX_EDGE)throw Error('画布截图尺寸无效');
      let url;try{url=validateURL(await stage(()=>rendered.toDataURL('image/png')))}catch(err){check();if(!String(err.message).includes('大小限制'))throw err;
        for(const quality of [.9,.8,.65,.5]){check();try{url=validateURL(await stage(()=>rendered.toDataURL('image/jpeg',quality)));break}catch(e){check();if(!String(e.message).includes('大小限制'))throw e}}
        if(!url)throw Error('画布截图超过大小限制');
      }
      check();return{url,width:rendered.width,height:rendered.height,canvasWidth:width,canvasHeight:height,region:bounds};
    }finally{signal?.removeEventListener('abort',onAbort);holder?.remove();for(const frame of rendererFrames)frame.remove()}
  }
  return{capture};
});
