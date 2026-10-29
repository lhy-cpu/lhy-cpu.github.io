(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FlowSketchConnectorPaint=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const EPS=1e-9;
  const cross=(a,b)=>a.x*b.y-a.y*b.x;
  const delta=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const area=points=>points.reduce((sum,p,i)=>sum+cross(p,points[(i+1)%points.length]),0)/2;
  function positive(points){return area(points)<0?points.slice().reverse():points}
  function geometryPoints(geometry){
    const vertices=geometry.vertices||geometry.points||[],a=geometry.a||vertices[0],b=geometry.b||vertices[vertices.length-1];
    const curve=geometry.curve||(geometry.type==='curve'?geometry:null);
    return{vertices,a,b,curve};
  }
  // Tangents always face out of the logical endpoint, never a clipped endpoint.
  function terminalTangent(geometry,start){
    const {vertices,a,b,curve}=geometryPoints(geometry);
    let points=curve?[a,curve.sa,curve.c1,curve.c2,curve.eb,b]:vertices.length?vertices:[a,b];
    if(!start)points=points.slice().reverse();
    const tip=points[0];if(!valid(tip))return null;
    const next=points.find(p=>valid(p)&&distance(p,tip)>EPS);if(!next)return null;
    const d=delta(tip,next),length=Math.hypot(d.x,d.y);
    return{tip:{x:tip.x,y:tip.y},ux:d.x/length,uy:d.y/length};
  }
  function clipHalfPlane(polygon,value){
    if(!polygon.length)return[];
    const clipped=[];
    polygon.forEach((b,i)=>{
      const a=polygon[(i+polygon.length-1)%polygon.length],va=value(a),vb=value(b),insideA=va<=EPS,insideB=vb<=EPS;
      if(insideA!==insideB)clipped.push(lerp(a,b,va/(va-vb)));
      if(insideB)clipped.push({x:b.x,y:b.y});
    });
    return clipped;
  }
  // SVG and PPTX use this same convex clipping region. Zero marker sizes mean no clipping.
  function clipRegion(geometry,options){
    const width=Number(options.width),height=Number(options.height);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return[];
    let polygon=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
    const arrowWidth=Number(options.arrowWidth),length=Number(options.arrowLength),strokeWidth=Math.max(0,Number(options.strokeWidth)||0);
    if(!(arrowWidth>0&&length>0&&Number.isFinite(arrowWidth)&&Number.isFinite(length)))return polygon;
    for(const start of [true,false]){
      const style=(start?options.startStyle:options.endStyle)||'none';if(style==='none')continue;
      const tangent=terminalTangent(geometry,start);if(!tangent)continue;
      const factor={triangle:.85,stealth:.62,diamond:.43,circle:.32}[style]??.85;
      const setback=style==='open'?Math.min(.83*length,Math.max(.07*length,.83*length*strokeWidth/(.825*arrowWidth))):factor*length;
      polygon=clipHalfPlane(polygon,p=>(p.x-tangent.tip.x)*tangent.ux+(p.y-tangent.tip.y)*tangent.uy+setback);
      if(polygon.length<3||Math.abs(area(polygon))<EPS)return[];
    }
    return polygon;
  }
  function flatten(geometry){
    const {vertices,a,b,curve}=geometryPoints(geometry),points=[];
    const add=p=>{if(valid(p)&&(!points.length||distance(points[points.length-1],p)>EPS))points.push({x:p.x,y:p.y})};
    if(!curve){(vertices.length?vertices:[a,b]).forEach(add);return points}
    if(![a,curve.sa,curve.c1,curve.c2,curve.eb,b].every(valid))return[];
    add(a);add(curve.sa);
    const lineDistance=(p,a,b)=>{const chord=delta(b,a),length=Math.hypot(chord.x,chord.y);return length>EPS?Math.abs(cross(delta(p,a),chord))/length:distance(p,a)};
    function cubic(p0,p1,p2,p3,depth){
      // Control polygon excess also detects collinear curves that reverse direction.
      const flat=Math.max(lineDistance(p1,p0,p3),lineDistance(p2,p0,p3)),excess=distance(p0,p1)+distance(p1,p2)+distance(p2,p3)-distance(p0,p3);
      if(depth>=12||(flat<=.15&&excess<=.15)){add(p3);return}
      const p01=lerp(p0,p1,.5),p12=lerp(p1,p2,.5),p23=lerp(p2,p3,.5),p012=lerp(p01,p12,.5),p123=lerp(p12,p23,.5),mid=lerp(p012,p123,.5);
      cubic(p0,p01,p012,mid,depth+1);cubic(mid,p123,p23,p3,depth+1);
    }
    cubic(curve.sa,curve.c1,curve.c2,curve.eb,0);add(b);return points;
  }
  function dashRuns(points,dash){
    if(!dash)return[points];
    const runs=[];let run=[],remaining=8,on=true;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);let offset=0;
      while(offset<length-EPS){
        const take=Math.min(remaining,length-offset),from=lerp(a,b,offset/length),to=lerp(a,b,(offset+take)/length);
        if(on){if(!run.length)run.push(from);run.push(to)}
        offset+=take;remaining-=take;
        if(remaining<=EPS){if(on&&run.length>1)runs.push(run);run=[];on=!on;remaining=on?8:6}
      }
    }
    if(on&&run.length>1)runs.push(run);return runs;
  }
  function strokeRun(points,radius){
    const polygons=[],segments=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);if(length<=EPS)continue;
      const u={x:(b.x-a.x)/length,y:(b.y-a.y)/length},n={x:-u.y*radius,y:u.x*radius};segments.push({a,b,u,n});
      polygons.push(positive([{x:a.x+n.x,y:a.y+n.y},{x:b.x+n.x,y:b.y+n.y},{x:b.x-n.x,y:b.y-n.y},{x:a.x-n.x,y:a.y-n.y}]));
    }
    for(let i=1;i<segments.length;i++){
      const before=segments[i-1],after=segments[i],turn=cross(before.u,after.u);if(Math.abs(turn)<=EPS)continue;
      const p=before.b,side=turn>0?-1:1,n1={x:before.n.x*side,y:before.n.y*side},n2={x:after.n.x*side,y:after.n.y*side},outer1={x:p.x+n1.x,y:p.y+n1.y},outer2={x:p.x+n2.x,y:p.y+n2.y};
      const t=cross(delta(n2,n1),after.u)/turn,miter={x:outer1.x+before.u.x*t,y:outer1.y+before.u.y*t};
      const wedge=distance(miter,p)<=radius*4+EPS?[p,outer1,miter,outer2]:[p,outer1,outer2];polygons.push(positive(wedge));
    }
    return polygons;
  }
  // Polygons all share one winding for a single nonzero-fill shape (no alpha overlaps).
  function strokePolygons(geometry,strokeWidth,dash){
    const width=Number(strokeWidth);if(!(width>0&&Number.isFinite(width)))return[];
    return dashRuns(flatten(geometry),dash).flatMap(points=>strokeRun(points,width/2));
  }
  function clipPolygons(polygons,region){
    if(!Array.isArray(region)||region.length<3||Math.abs(area(region))<EPS)return[];
    const clip=positive(region),result=[];
    for(const polygon of polygons){
      let clipped=polygon;
      for(let i=0;i<clip.length&&clipped.length;i++){
        const a=clip[i],b=clip[(i+1)%clip.length],edge=delta(b,a);
        clipped=clipHalfPlane(clipped,p=>-cross(edge,delta(p,a)));
      }
      if(clipped.length>=3&&Math.abs(area(clipped))>EPS)result.push(positive(clipped));
    }
    return result;
  }
  return{clipRegion,strokePolygons,clipPolygons,terminalTangent};
});
