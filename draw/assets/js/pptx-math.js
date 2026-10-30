(function(global){
  'use strict';
  const MATH_NS='http://schemas.openxmlformats.org/officeDocument/2006/math';
  const DRAWING_NS='http://schemas.openxmlformats.org/drawingml/2006/main';
  const escapeXml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
  const children=node=>Array.from(node.children||[]);
  const attribute=(node,name)=>node.getAttribute(name);
  const naryCharacters=new Set(Array.from('∑∏∐∫∬∭∮∯∰⋀⋁⋂⋃'));
  const variants={normal:['p'],italic:['i'],bold:['b'],'bold-italic':['bi'],'double-struck':['p','double-struck'],script:['p','script'],'bold-script':['b','script'],fraktur:['p','fraktur'],'bold-fraktur':['b','fraktur'],'sans-serif':['p','sans-serif'],'bold-sans-serif':['b','sans-serif'],'sans-serif-italic':['i','sans-serif'],'sans-serif-bold-italic':['bi','sans-serif'],monospace:['p','monospace']};
  const colors={black:'000000',white:'FFFFFF',red:'FF0000',green:'008000',blue:'0000FF',gray:'808080',grey:'808080',orange:'FFA500',purple:'800080',yellow:'FFFF00'};
  function color(value){
    const source=String(value||'#172554').toLowerCase();
    if(colors[source])return colors[source];
    if(/^#[\da-f]{6}$/i.test(source))return source.slice(1).toUpperCase();
    if(/^#[\da-f]{3}$/i.test(source))return source.slice(1).split('').map(character=>character+character).join('').toUpperCase();
    throw Error('Unsupported math color');
  }
  function drawingProperties(style){
    const size=Math.round(style.fontSize*75),opacity=Math.round(style.opacity*100000);
    return `<a:rPr sz="${size}"><a:solidFill><a:srgbClr val="${style.color}"><a:alpha val="${opacity}"/></a:srgbClr></a:solidFill><a:latin typeface="Cambria Math"/><a:ea typeface="Cambria Math"/><a:cs typeface="Cambria Math"/></a:rPr>`;
  }
  function run(text,style,variant){
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('Invalid math text');
    const properties=variant?variants[variant]:null;
    if(variant&&!properties)throw Error('Unsupported math variant');
    const mathProperties=properties?`<m:rPr>${properties[1]?`<m:scr m:val="${properties[1]}"/>`:''}<m:sty m:val="${properties[0]}"/></m:rPr>`:'';
    return text?`<m:r>${mathProperties}${drawingProperties(style)}<m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`:'';
  }
  function toOmml(math,options={}){
    try{
      if(!math||math.localName!=='math')return null;
      let count=0,textLength=0;
      const initial={fontSize:Number(options.fontSize)||32,color:color(options.textColor),opacity:Math.max(0,Math.min(1,Number(options.opacity??1))),variant:null};
      if(!Number.isFinite(initial.opacity)||initial.fontSize<=0||initial.fontSize>1000)return null;
      function control(style){return `<m:ctrlPr>${drawingProperties(style)}</m:ctrlPr>`}
      function operator(node){
        let base=children(node)[0];
        while(base&&['mrow','mstyle'].includes(base.localName)&&children(base).length===1)base=children(base)[0];
        return base?.localName==='mo'&&naryCharacters.has(base.textContent)?base.textContent:null;
      }
      function scripts(node,style,depth,body=''){
        const parts=children(node),kind=node.localName,hasLower=['msub','msubsup','munder','munderover'].includes(kind),hasUpper=['msup','msubsup','mover','munderover'].includes(kind);
        if(parts.length!==(hasLower&&hasUpper?3:2))throw Error('Invalid math scripts');
        const base=visit(parts[0],style,depth+1),lower=hasLower?visit(parts[1],style,depth+1):'',upper=hasUpper?visit(parts[hasLower?2:1],style,depth+1):'',character=operator(node);
        if(character){
          const location=['munder','mover','munderover'].includes(kind)?'undOvr':'subSup';
          return `<m:nary><m:naryPr><m:chr m:val="${character}"/><m:limLoc m:val="${location}"/><m:subHide m:val="${hasLower?0:1}"/><m:supHide m:val="${hasUpper?0:1}"/>${control(style)}</m:naryPr><m:sub>${lower}</m:sub><m:sup>${upper}</m:sup><m:e>${body}</m:e></m:nary>`;
        }
        if(['msub','msup','msubsup'].includes(kind)){
          const tag=hasLower?(hasUpper?'sSubSup':'sSub'):'sSup';
          return `<m:${tag}><m:e>${base}</m:e>${hasLower?`<m:sub>${lower}</m:sub>`:''}${hasUpper?`<m:sup>${upper}</m:sup>`:''}</m:${tag}>`;
        }
        if(kind==='mover'&&attribute(node,'accent')==='true'){
          const accent=parts[1].textContent;
          if(['‾','¯','―'].includes(accent))return `<m:bar><m:barPr><m:pos m:val="top"/>${control(style)}</m:barPr><m:e>${base}</m:e></m:bar>`;
          const accents={'^':'̂','~':'̃','→':'⃗','⃗':'⃗','˙':'̇','¨':'̈','ˇ':'̌','˘':'̆','´':'́','`':'̀'};
          if(!accents[accent])throw Error('Unsupported math accent');
          return `<m:acc><m:accPr><m:chr m:val="${escapeXml(accents[accent])}"/>${control(style)}</m:accPr><m:e>${base}</m:e></m:acc>`;
        }
        if(kind==='munder'&&attribute(node,'accentunder')==='true'){
          if(!['‾','¯','―','_'].includes(parts[1].textContent))throw Error('Unsupported math accent');
          return `<m:bar><m:barPr><m:pos m:val="bot"/>${control(style)}</m:barPr><m:e>${base}</m:e></m:bar>`;
        }
        if(parts.slice(1).some(part=>/^[⏞⏟]$/.test(part.textContent)))throw Error('Unsupported math brace');
        let result=base;
        if(hasLower)result=`<m:limLow><m:e>${result}</m:e><m:lim>${lower}</m:lim></m:limLow>`;
        if(hasUpper)result=`<m:limUpp><m:e>${result}</m:e><m:lim>${upper}</m:lim></m:limUpp>`;
        return result;
      }
      function row(parts,style,depth){
        let result='';
        const first=parts[0],last=parts[parts.length-1],isFence=node=>node?.localName==='mo'&&attribute(node,'fence')==='true';
        if(parts.length>1&&(isFence(first)||isFence(last))){
          const opening=isFence(first)?first.textContent:'',closing=isFence(last)?last.textContent:'';
          if(Array.from(opening).length>1||Array.from(closing).length>1)throw Error('Unsupported math fence');
          const middle=parts.slice(isFence(first)?1:0,isFence(last)?-1:undefined);
          return `<m:d><m:dPr><m:begChr m:val="${escapeXml(opening)}"/><m:endChr m:val="${escapeXml(closing)}"/><m:grow m:val="1"/>${control(style)}</m:dPr><m:e>${row(middle,style,depth+1)}</m:e></m:d>`;
        }
        for(let index=0;index<parts.length;index++){
          const node=parts[index],next=parts[index+1];
          if(['msub','msup','msubsup','munder','mover','munderover'].includes(node.localName)&&operator(node)&&next&&next.localName!=='mo'){
            result+=scripts(node,style,depth+1,visit(next,style,depth+1));index++;
          }else result+=visit(node,style,depth+1);
        }
        return result;
      }
      function visit(node,style,depth){
        if(++count>8000||depth>64)throw Error('Math export budget exceeded');
        const kind=node.localName,parts=children(node),variant=attribute(node,'mathvariant')||style.variant;
        if(attribute(node,'mathcolor'))style={...style,color:color(attribute(node,'mathcolor'))};
        if(variant)style={...style,variant};
        switch(kind){
          case 'math':case 'mrow':case 'mtd':return row(parts,style,depth);
          case 'semantics':if(!parts[0])throw Error('Empty math');return visit(parts[0],style,depth+1);
          case 'mstyle':
            if(attribute(node,'mathbackground')||attribute(node,'mathsize')||!['',null,'0'].includes(attribute(node,'scriptlevel')))throw Error('Unsupported math style');
            return row(parts,style,depth);
          case 'mi':case 'mn':case 'mo':case 'mtext':{
            if(parts.length)throw Error('Unsupported token children');
            const text=node.textContent;
            textLength+=text.length;
            if(textLength>20000)throw Error('Math text budget exceeded');
            return run(text,style,variant||((kind==='mi'&&Array.from(text).length===1)?null:'normal'));
          }
          case 'mfrac':{
            if(parts.length!==2||attribute(node,'bevelled')==='true')throw Error('Unsupported fraction');
            const thickness=attribute(node,'linethickness');
            if(thickness&&!/^0(?:px|pt|em)?$/.test(thickness))throw Error('Unsupported fraction thickness');
            return `<m:f><m:fPr><m:type m:val="${thickness?'noBar':'bar'}"/>${control(style)}</m:fPr><m:num>${visit(parts[0],style,depth+1)}</m:num><m:den>${visit(parts[1],style,depth+1)}</m:den></m:f>`;
          }
          case 'msqrt':case 'mroot':{
            if(kind==='mroot'&&parts.length!==2)throw Error('Invalid root');
            const degree=kind==='mroot'?visit(parts[1],style,depth+1):'',body=kind==='mroot'?visit(parts[0],style,depth+1):row(parts,style,depth);
            return `<m:rad><m:radPr><m:degHide m:val="${kind==='msqrt'?1:0}"/>${control(style)}</m:radPr><m:deg>${degree}</m:deg><m:e>${body}</m:e></m:rad>`;
          }
          case 'msub':case 'msup':case 'msubsup':case 'munder':case 'mover':case 'munderover':return scripts(node,style,depth);
          case 'mtable':{
            if(!parts.length||parts.some(part=>part.localName!=='mtr'))throw Error('Unsupported math table');
            if(['columnlines','rowlines','frame'].some(name=>attribute(node,name)&&attribute(node,name)!=='none'))throw Error('Unsupported matrix borders');
            const columns=Math.max(...parts.map(part=>children(part).length)),alignments=(attribute(node,'columnalign')||'center').trim().split(/\s+/);
            if(!columns||columns>64||parts.length>128)throw Error('Math table budget exceeded');
            const columnProperties=Array.from({length:columns},(_,index)=>{
              const alignment=alignments[index]||alignments[alignments.length-1];
              if(!['left','center','right'].includes(alignment))throw Error('Unsupported matrix alignment');
              return `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${alignment}"/></m:mcPr></m:mc>`;
            }).join('');
            const rows=parts.map(part=>{
              const cells=children(part);
              if(cells.some(cell=>cell.localName!=='mtd'||attribute(cell,'columnspan')||attribute(cell,'rowspan')))throw Error('Unsupported matrix cell');
              return `<m:mr>${Array.from({length:columns},(_,index)=>`<m:e>${cells[index]?visit(cells[index],style,depth+1):''}</m:e>`).join('')}</m:mr>`;
            }).join('');
            return `<m:m><m:mPr><m:mcs>${columnProperties}</m:mcs>${control(style)}</m:mPr>${rows}</m:m>`;
          }
          case 'mspace':{
            const width=attribute(node,'width')||'0em';
            if(!/^\d+(?:\.\d+)?em$/.test(width)||attribute(node,'height')||attribute(node,'depth'))throw Error('Unsupported math spacing');
            return run('\u2009'.repeat(Math.min(12,Math.round(parseFloat(width)*6))),style,'normal');
          }
          default:throw Error('Unsupported MathML element');
        }
      }
      const body=visit(math,initial,0);
      if(!body)return null;
      return `<m:oMathPara xmlns:m="${MATH_NS}" xmlns:a="${DRAWING_NS}"><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${body}</m:oMath></m:oMathPara>`;
    }catch{return null}
  }
  const api={toOmml};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else global.FlowSketchPptxMath=api;
})(typeof window==='undefined'?globalThis:window);
