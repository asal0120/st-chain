/* Pure generation rules shared by the viewer and Node checks. No browser or save dependency. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SceneMap=api;})(globalThis,()=>{
  'use strict';
  // tiny（迷你）：比 small 更小、前進方向一路向北的地圖；取代已封存的單次遭遇戰，供劇情連續戰鬥使用。
  const types=['london','woodland','factory','residence'], sizes=['tiny','small','medium','large'];
  function validate(spec){
    if(!spec||typeof spec!=='object'||Array.isArray(spec))throw Error('地點資料必須是物件。');
    if(Object.keys(spec).some(k=>!['locationType','size'].includes(k)))throw Error('只需 locationType（地點類型）與 size（大小）。');
    if(!types.includes(spec.locationType))throw Error('地點類型需為 london、woodland、factory 或 residence。');
    if(!sizes.includes(spec.size))throw Error('大小需為 tiny、small、medium 或 large。');
    return {locationType:spec.locationType,size:spec.size};
  }
  function parse(text){if(typeof text!=='string'||text.length>2048)throw Error('請提供簡短的地點 JSON。');let spec;try{spec=JSON.parse(text);}catch{throw Error('地點資料不是有效 JSON。');}return validate(spec);}
  function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  function adjacent(map,id){const x=id%map.cols,y=Math.floor(id/map.cols);return[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b])=>a>=0&&a<map.cols&&b>=0&&b<map.rows).map(([a,b])=>b*map.cols+a);}
  const limits=Object.freeze({maxClosedRatio:.05,maxClosedComponent:3});
  const districts=['market','genteel','industrial','oldtown'],faces=['front','side','back'],landmarkKinds=['church','hall','clocktower'];
  // 重畫的室內家具占地（格數）；舊模組的占地仍由 assets 提供。
  const furniture=Object.freeze({'f-sofa':[2,1],'f-armchair':[1,1],'f-tea':[2,1],'f-bookcase':[2,1],'f-cabinet':[1,1],'f-clock':[1,1],'f-piano':[2,1],
    'f-fireplace':[2,1],'f-desk':[2,1],'f-globe':[1,1],'f-bed':[2,2],'f-nightstand':[1,1],'f-wardrobe':[2,1],'f-washstand':[1,1],'f-sideboard':[2,1],'f-dining':[3,2],'f-plant':[1,1],
    'm-furnace':[2,1],'m-boiler':[2,2],'m-lathe':[3,1],'m-bench':[2,1],'m-press':[2,1],'m-rack':[2,1],'m-crates':[1,1],'m-barrel':[1,1],'m-cart':[1,1],
    'w-oak':[2,1],'w-willow':[2,1],'w-pine':[1,1],'w-birch':[1,1],'w-bush':[1,1],'w-rock':[1,1],'w-log':[2,1],'w-stump':[1,1],'w-fern':[1,1]});
  // 每棵各自依種子繪製的物件；存檔需帶 seed。
  const seededKeys=['w-oak','w-willow','w-pine','w-birch','w-bush','w-rock'];
  const footprint=(assets,key)=>assets[key]||(furniture[key]&&{cols:furniture[key][0],rows:furniture[key][1]});
  const roomKinds={residence:['parlour','study','bedroom','dining'],factory:['boiler','workshop','storage']};
  const walkable=(map,id)=>Number.isInteger(id)&&!!map.cells[id]?.active&&!map.cells[id].blocked;
  function reachable(map,start){if(!walkable(map,start))return[];const seen=new Set([start]),q=[start];for(let i=0;i<q.length;i++)for(const id of adjacent(map,q[i]))if(walkable(map,id)&&!seen.has(id)){seen.add(id);q.push(id);}return q;}
  function route(map,start,end){if(!walkable(map,start)||!walkable(map,end))return null;const parents=new Map([[start,null]]),q=[start];for(let i=0;i<q.length&&!parents.has(end);i++)for(const id of adjacent(map,q[i]))if(walkable(map,id)&&!parents.has(id)){parents.set(id,q[i]);q.push(id);}if(!parents.has(end))return null;const result=[];for(let n=end;n!==start;n=parents.get(n))result.unshift(n);return result;}
  // The denominator is actual ground, excluding object footprints and the outside void.
  // Check each isolated component as well as the total: a large sealed room cannot pass.
  function audit(map,start=map.spawn){
    const floor=map.cells.filter(c=>c.active&&!c.blocked).map(c=>c.id),open=reachable(map,start),seen=new Set(open),components=[];
    for(const id of floor){if(seen.has(id))continue;const part=reachable(map,id);part.forEach(n=>seen.add(n));components.push(part);}
    const closedCount=floor.length-open.length,largestClosed=Math.max(0,...components.map(c=>c.length));
    return {ok:open.length>0&&closedCount*20<=floor.length&&largestClosed<=limits.maxClosedComponent,
      floorCount:floor.length,reachableCount:open.length,closedCount,closedRatio:floor.length?closedCount/floor.length:0,
      largestClosed,components,reachable:open};
  }
  // 物件北側連續的非地面列數；碰到地圖上緣時加上畫面頂端留白（約五列）。繪製與生成共用。
  function clearance(map,o){
    let least=99;
    for(let a=o.x;a<o.x+o.cols;a++){let k=0;for(let b=o.y-1;k<9;b--,k++){if(b<1){k+=5;break;}const c=map.cells[b*map.cols+a];if(c.active&&!c.blocked)break;}least=Math.min(least,k);}
    return least;
  }
  function validLayout(map,assets){
    try{
      validate({locationType:map.locationType,size:map.size});
      const integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
      if(!integer(map.cols,9,26)||!integer(map.rows,12,25)||!integer(map.seed,0,4294967295)||
        map.indoor!==['factory','residence'].includes(map.locationType)||!Array.isArray(map.cells)||map.cells.length!==map.cols*map.rows)return false;
      if(!map.cells.every((c,i)=>c&&c.id===i&&c.x===i%map.cols&&c.y===Math.floor(i/map.cols)&&
        ['active','core','blocked'].every(k=>typeof c[k]==='boolean')&&(!c.blocked||c.active)&&(!c.core||c.active&&!c.blocked)))return false;
      if(!Array.isArray(map.objects)||map.objects.length>map.cells.length)return false;
      if(map.locationType==='london'?!districts.includes(map.district):'district' in map)return false;
      const occupied=new Set();let landmarks=0;
      for(const o of map.objects){
        if(o.key==='building'||o.key==='landmark'){
          // 拼裝建物：占地依本局生成，外觀參數只接受固定範圍。
          if(map.locationType!=='london'||!integer(o.cols,1,6)||!integer(o.rows,1,4)||!integer(o.floors,1,4)||!integer(o.seed,0,2147483647))return false;
          if(o.key==='building'?!faces.includes(o.face)||(o.face==='side')!==['east','west'].includes(o.street):o.face!=='front'||!landmarkKinds.includes(o.kind)||++landmarks>1)return false;
        }else{const a=footprint(assets,o.key);if(!a||o.cols!==a.cols||o.rows!==a.rows)return false;if(seededKeys.includes(o.key)&&!integer(o.seed,0,2147483647))return false;}
        if(!integer(o.x,0,map.cols-o.cols)||!integer(o.y,0,map.rows-o.rows)||!Array.isArray(o.ids)||o.ids.length!==o.cols*o.rows)return false;
        for(let i=0;i<o.ids.length;i++){
          const id=(o.y+Math.floor(i/o.cols))*map.cols+o.x+i%o.cols;
          if(o.ids[i]!==id||occupied.has(id)||!map.cells[id].blocked||map.cells[id].core)return false;occupied.add(id);
        }
      }
      if(occupied.size!==map.cells.filter(c=>c.blocked).length)return false;
      if(!Array.isArray(map.rooms)||map.rooms.length>9||!map.rooms.every(r=>integer(r.x,0,map.cols-1)&&integer(r.y,0,map.rows-1)&&integer(r.w,1,map.cols-r.x)&&integer(r.h,1,map.rows-r.y)))return false;
      const report=audit(map);
      return report.ok&&map.floorCount===report.reachableCount&&Array.isArray(map.markers)&&map.markers.length<=7&&new Set(map.markers).size===map.markers.length&&map.markers.every(id=>report.reachable.includes(id));
    }catch{return false;}
  }
  function generate(input,assets,seed){
    const spec=validate(input),random=rng(seed),pick=a=>a[Math.floor(random()*a.length)],int=(a,b)=>a+Math.floor(random()*(b-a+1));
    // 迷你只在自己的分支取亂數；其他規模的亂數順序與加入迷你前相同，同一個種子仍產生同一張地圖。
    // level 用於各規模的數量表（迷你在最前）；scale 保留原本 small=0、medium=1、large=2 的判斷，迷你比照 small。
    const level=sizes.indexOf(spec.size),tiny=level===0,scale=Math.max(0,level-1),indoor=['factory','residence'].includes(spec.locationType);
    const cols=tiny?(indoor?9:11)+int(0,1):[13,19,25][scale]+int(-1,1),rows=tiny?13+int(0,1):[13,18,24][scale]+int(-1,1);
    const map={...spec,seed:seed>>>0,cols,rows,indoor,cells:[],objects:[],rooms:[],paths:[],spawn:0,markers:[]};
    map.cells=Array.from({length:cols*rows},(_,id)=>({id,x:id%cols,y:Math.floor(id/cols),active:false,core:false,blocked:false}));
    const cell=(x,y)=>x>=1&&y>=1&&x<cols-1&&y<rows-1?map.cells[y*cols+x]:null;
    const box=(x,y,w,h,core=false)=>{for(let b=y;b<y+h;b++)for(let a=x;a<x+w;a++){const c=cell(a,b);if(c){c.active=true;c.core||=core;}}};
    const disk=(x,y,r,core=false)=>{for(let b=y-r;b<=y+r;b++)for(let a=x-r;a<=x+r;a++){const c=cell(a,b);if(c&&(a-x)**2+(b-y)**2<=(r+.2)**2){c.active=true;c.core||=core;}}};
    const corridor=(a,b,width=1)=>{let[x,y]=a;const pts=[[x,y]];while(x!==b[0]||y!==b[1]){if(x!==b[0]&&(y===b[1]||random()<.5))x+=Math.sign(b[0]-x);else y+=Math.sign(b[1]-y);box(x-width,y-width,width*2+1,width*2+1,true);pts.push([x,y]);}box(a[0]-width,a[1]-width,width*2+1,width*2+1,true);return pts;};
    const wpick=items=>{let s=items.reduce((a,b)=>a+b[1],0)*random();for(const[v,w]of items)if((s-=w)<=0)return v;return items[items.length-1][0];};
    // 倫敦：先鋪街道網（車道三格寬）與一格寬人行道；建地在放置階段沿街切出。
    // 鏡頭朝北看，只有東西向街道北側的房子露出店面；所以以東西向橫街為主，
    // 南北向只用短街連接，橫街之間留出夠深的街廓給房子與它的高度。
    function londonStreets(){
      map.district=pick(districts);
      // 迷你：南端入口往北，中段折向另一側再往北到底。路面一格寬，加人行道共三格。
      if(tiny){
        const x1=int(3,cols-4),x2=x1<cols/2?int(Math.ceil(cols/2),cols-4):int(3,Math.floor(cols/2)-1),y=int(6,rows-6);
        map.paths.push(corridor([x1,rows-3],[x1,y],0),corridor([x1,y],[x2,y],0),corridor([x2,y],[x2,2],0));
        for(const c of map.cells.filter(c=>c.core))box(c.x-1,c.y-1,3,3);
        return;
      }
      const ys=[],streets=[];
      for(let y=rows-int(5,6);y>=5&&ys.length<3;y-=int(8,10))ys.push(y);
      let x=int(Math.floor(cols*.3),Math.ceil(cols*.7)-1);
      map.paths.push(corridor([x,rows-3],[x,ys[0]],1));
      ys.forEach((y,i)=>{
        const full=random()<.45;
        const left=Math.min(x,full?2:int(2,Math.max(2,x-int(3,6)))),right=Math.max(x,full?cols-3:int(Math.min(cols-3,x+int(3,6)),cols-3));
        map.paths.push(corridor([left,y],[right,y],1));streets.push({y,left,right});
        if(i+1<ys.length){
          const options=[];for(let a=Math.max(left,3);a<=Math.min(right,cols-4);a++)if(Math.abs(a-x)>=4)options.push(a);
          x=options.length?pick(options):x;map.paths.push(corridor([x,y],[x,ys[i+1]],1));
        }
      });
      // 最上面一條橫街可能再往北接一段死巷，增加探索長度。
      const top=streets[streets.length-1],spur=[];
      for(let a=Math.max(top.left,3);a<=Math.min(top.right,cols-4);a++)if(Math.abs(a-x)>=3)spur.push(a);
      if(top.y>=7&&spur.length&&random()<.55){const sx=pick(spur);map.paths.push(corridor([sx,top.y],[sx,2],1));}
      for(const c of map.cells.filter(c=>c.core))box(c.x-1,c.y-1,3,3);
      // 廣場：貼在橫街北側的開闊石板地，北緣留給地標建物。
      if(scale>0||random()<.5){
        const a=pick(streets),w=int(4,scale+5),h=int(2,3),left=int(a.left,Math.max(a.left,a.right-w+1));
        if(a.y-2-h>=2){box(left,a.y-2-h,w,h);map.plaza={x:left,y:a.y-2-h,w,h};}
      }
    }
    if(spec.locationType==='london')londonStreets();
    else if(!indoor&&tiny){
      // 迷你林地：一條一格寬的小徑由南往北折一次，沿途三塊小空地。
      const cx=Math.floor(cols/2),points=[[cx,rows-3],[int(3,cols-4),Math.floor(rows*.5)],[int(3,cols-4),2]];
      for(let i=1;i<points.length;i++)map.paths.push(corridor(points[i-1],points[i],0));
      for(const[x,y]of points)disk(x,y,2);
      for(const c of map.cells.filter(c=>c.core))disk(c.x,c.y,1);
    }
    else if(!indoor){
      const cx=Math.floor(cols/2),points=[[cx,rows-3],[int(3,cols-4),Math.floor(rows*.63)],[int(3,cols-4),Math.floor(rows*.34)],[int(3,cols-4),2]];
      for(let i=1;i<points.length;i++)map.paths.push(corridor(points[i-1],points[i],1));
      for(const[x,y]of points)disk(x,y,int(3,scale+4));
      const road=map.cells.filter(c=>c.core);for(const c of road)disk(c.x,c.y,2);
    }else{
      // 迷你室內：兩間房南北相連，各自隨機寬度與左右位置。
      const nx=tiny?1:scale===2?3:2,ny=tiny?2:scale===0?2:3;
      for(let ry=0;ry<ny;ry++)for(let rx=0;rx<nx;rx++){
        if(map.rooms.length>=3&&random()<.16)continue;
        const sectionW=(cols-2)/nx,sectionH=(rows-2)/ny;
        const w=tiny?int(4,cols-3):Math.max(4,Math.floor(sectionW)-int(0,1)),h=Math.max(3,Math.floor(sectionH)-1-int(0,1));
        const x=tiny?int(1,cols-w-1):Math.min(cols-w-1,1+Math.floor(rx*sectionW)),y=Math.min(rows-h-1,1+Math.floor(ry*sectionH));
        box(x,y,w,h);map.rooms.push({x,y,w,h,cx:x+Math.floor(w/2),cy:y+Math.floor(h/2)});
      }
      for(let i=1;i<map.rooms.length;i++){
        const a=map.rooms[i],prior=map.rooms.slice(0,i).sort((b,c)=>Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy)-Math.abs(a.cx-c.cx)-Math.abs(a.cy-c.cy))[0];
        map.paths.push(corridor([a.cx,a.cy],[prior.cx,prior.cy],0));
      }
      for(const r of map.rooms)box(r.cx,r.cy,1,1,true);
    }
    // Drop accidental isolated lots before placing anything. Corridor spine is always retained.
    const provisional=map.cells.find(c=>c.core).id,keep=new Set(reachable(map,provisional));
    map.cells.forEach(c=>{if(!keep.has(c.id))c.active=false;});
    const core=map.cells.filter(c=>c.core&&c.active).sort((a,b)=>b.y-a.y);
    map.spawn=core[0].id;
    const minimumFloor=Math.max(24,Math.ceil(map.cells.filter(c=>c.active).length*.45));
    let availableFloor=map.cells.filter(c=>c.active).length;
    function place(key,x,y){
      const a=footprint(assets,key),ids=[];
      if(availableFloor-a.cols*a.rows<minimumFloor)return false;
      for(let yy=y;yy<y+a.rows;yy++)for(let xx=x;xx<x+a.cols;xx++){
        const c=cell(xx,yy);if(!c||!c.active||c.blocked||c.core||adjacent(map,map.spawn).includes(c.id))return false;ids.push(c.id);
      }
      ids.forEach(id=>map.cells[id].blocked=true);
      if(reachable(map,map.spawn).length!==map.cells.filter(c=>c.active&&!c.blocked).length){ids.forEach(id=>map.cells[id].blocked=false);return false;}
      map.objects.push({key,x,y,cols:a.cols,rows:a.rows,ids});availableFloor-=ids.length;return true;
    }
    // 倫敦建地：人行道外側的空格依朝向分組，沿街切成寬窄不同的連棟建物。
    // 正面朝南（看得到店面）優先，其次是街角側牆，最後是背面朝向鏡頭的街南側。
    function londonLots(){
      const D={market:{width:[[2,.3],[3,.4],[4,.2],[5,.1]],floors:[[2,.35],[3,.45],[4,.2]],alley:.12,landmark:['hall','clocktower']},
        genteel:{width:[[2,.2],[3,.5],[4,.3]],floors:[[2,.25],[3,.5],[4,.25]],alley:.08,landmark:['church','clocktower']},
        industrial:{width:[[3,.3],[4,.4],[5,.3]],floors:[[2,.3],[3,.45],[4,.25]],alley:.16,landmark:['hall','clocktower']},
        oldtown:{width:[[2,.45],[3,.4],[4,.15]],floors:[[1,.1],[2,.45],[3,.45]],alley:.14,landmark:['church','clocktower']}}[map.district];
      const free=(x,y,w,h)=>{for(let b=y;b<y+h;b++)for(let a=x;a<x+w;a++){const c=cell(a,b);if(!c||c.active)return false;}return true;};
      const open=c=>c&&c.active;
      const front=[],back=[],east=[],west=[];
      for(const c of map.cells){if(!cell(c.x,c.y)||c.active)continue;
        if(open(cell(c.x,c.y+1)))front.push(c);else if(open(cell(c.x+1,c.y)))east.push(c);else if(open(cell(c.x-1,c.y)))west.push(c);else if(open(cell(c.x,c.y-1)))back.push(c);}
      const runs=(list,horizontal)=>{const k=c=>horizontal?c.y:c.x,p=c=>horizontal?c.x:c.y,out=[];
        for(const c of list.slice().sort((a,b)=>k(a)-k(b)||p(a)-p(b))){const last=out[out.length-1];if(last&&k(last[0])===k(c)&&p(last[last.length-1])===p(c)-1)last.push(c);else out.push([c]);}return out;};
      const rect=(s,face,w,d)=>face==='front'?{x:s.x,y:s.y-d+1,cols:w,rows:d}:face==='back'?{x:s.x,y:s.y,cols:w,rows:d}:face==='east'?{x:s.x-d+1,y:s.y,cols:d,rows:w}:{x:s.x,y:s.y,cols:d,rows:w};
      const claim=o=>{o.ids=[];for(let b=o.y;b<o.y+o.rows;b++)for(let a=o.x;a<o.x+o.cols;a++){const c=map.cells[b*cols+a];c.active=c.blocked=true;o.ids.push(c.id);}map.objects.push(o);};
      const lane=(s,face)=>{
        s.active=true;availableFloor++;
        const step=face==='front'?[0,-1]:face==='back'?[0,1]:face==='east'?[-1,0]:[1,0];
        for(let i=1,n=int(0,2);i<=n;i++){const c=cell(s.x+step[0]*i,s.y+step[1]*i);if(!c||c.active)break;c.active=true;availableFloor++;}
      };
      const frontRuns=runs(front,true);
      if(scale>0||random()<.5){
        const kind=pick(D.landmark),[w,d]={church:[4,3],hall:[5,2],clocktower:[3,2]}[kind],plaza=map.plaza,options=[];
        for(const run of frontRuns)for(let i=0;i+w<=run.length;i++){const o=rect(run[i],'front',w,d);
          if(free(o.x,o.y,w,d)&&clearance(map,o)>=4)options.push({o,score:plaza&&run[i].y===plaza.y-1&&o.x+w>plaza.x&&o.x<plaza.x+plaza.w?1:0});}
        const best=options.filter(v=>v.score===Math.max(...options.map(v=>v.score)));
        if(best.length)claim({key:'landmark',kind,face:'front',...pick(best).o,floors:kind==='hall'?2:3,seed:Math.floor(random()*2147483647)});
      }
      for(const[face,list]of [['front',frontRuns],['east',runs(east,false)],['west',runs(west,false)],['back',runs(back,true)]])for(const whole of list){
        // 街角可能已被其他方向的建物占用：只處理仍空著的連續段。
        const parts=[];for(const c of whole){if(c.active){parts.push([]);continue;}if(!parts.length)parts.push([]);parts[parts.length-1].push(c);}
        for(const run of parts){
          let pos=0,previous=null;
          while(pos<run.length){
            const remaining=run.length-pos;
            if(remaining===1||pos>0&&remaining>=3&&random()<D.alley){lane(run[pos],face);pos++;previous=null;continue;}
            let w=Math.min(face==='front'?wpick(D.width):face==='back'?wpick([[2,.4],[3,.4],[4,.2]]):wpick([[2,.6],[3,.4]]),remaining);
            if(remaining-w===1)w=w<5?w+1:w-1;
            let d=face==='front'?wpick([[1,.2],[2,.55],[3,.25]]):face==='back'?wpick([[1,.6],[2,.4]]):wpick([[2,.5],[3,.5]]),o=null;
            for(;d>0;d--){const r=rect(run[pos],face,w,d);if(free(r.x,r.y,r.cols,r.rows)){o=r;break;}}
            if(!o){lane(run[pos],face);pos++;previous=null;continue;}
            let floors=face==='front'?wpick(D.floors):face==='back'?1:wpick([[1,.1],[2,.45],[3,.45]]);
            if(floors===previous&&face!=='back'&&random()<.6)floors=Math.max(1,Math.min(4,floors+(random()<.5?-1:1)));
            const side=face==='east'||face==='west';
            claim({key:'building',face:side?'side':face,...(side?{street:face}:{}),...o,floors,seed:Math.floor(random()*2147483647)});
            previous=floors;pos+=w;
          }
        }
      }
      // 房子高度會蓋住北側地面：依北側空出的列數限制樓層，最多蓋到隔壁街的人行道。
      for(const o of map.objects)if(o.key==='building')o.floors=Math.max(1,Math.min(o.floors,clearance(map,o)+1));
      // 路燈、長椅、花台只放在人行道與廣場，彼此至少隔兩格。
      const spots=map.cells.filter(c=>c.active&&!c.core&&!c.blocked).map(c=>c.id),placed=[];
      for(let i=spots.length-1;i>0;i--){const j=int(0,i);[spots[i],spots[j]]=[spots[j],spots[i]];}
      let count=0;
      for(const id of spots){if(count>=[3,6,10,14][level])break;const c=map.cells[id];
        if(placed.some(p=>Math.max(Math.abs(p.x-c.x),Math.abs(p.y-c.y))<3))continue;
        if(place(wpick([['lamp',.5],['planter',.3],['bench',.2]]),c.x,c.y)){placed.push(c);count++;}}
    }
    // 林地：大樹成片長在離小徑較遠處，北側空地越多才長越高的樹，免得樹冠整段蓋住小徑；
    // 小徑兩旁只放蕨類、灌木與石頭，空地放倒木與樹樁。每棵樹各有種子，外觀不重複。
    function plantWoods(){
      const dist=new Map(),queue=[];
      for(const c of map.cells)if(c.active&&c.core){dist.set(c.id,0);queue.push(c.id);}
      for(let i=0;i<queue.length;i++)for(const n of adjacent(map,queue[i]))if(map.cells[n].active&&!dist.has(n)){dist.set(n,dist.get(queue[i])+1);queue.push(n);}
      const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=int(0,i);[a[i],a[j]]=[a[j],a[i]];}return a;};
      const cells=map.cells.filter(c=>c.active&&!c.core),deep=cells.filter(c=>dist.get(c.id)>=2);
      const groves=[];for(let i=0;i<[2,3,5,8][level]&&deep.length;i++)groves.push(pick(deep));
      const near=c=>groves.length?Math.min(...groves.map(g=>Math.abs(g.x-c.x)+Math.abs(g.y-c.y))):0;
      const put=(key,x,y)=>{if(!place(key,x,y))return false;if(seededKeys.includes(key))map.objects[map.objects.length-1].seed=Math.floor(random()*2147483647);return true;};
      let trees=0;
      const order=cells.map(c=>[c,near(c)+random()*3+(dist.get(c.id)<2?4:0)]).sort((a,b)=>a[1]-b[1]).map(v=>v[0]);
      for(const c of order){
        if(trees>=[8,16,32,52][level])break;
        const wide=clearance(map,{x:c.x,y:c.y,cols:2,rows:1}),narrow=clearance(map,{x:c.x,y:c.y,cols:1,rows:1}),choices=[];
        if(wide>=2||wide>=1&&random()<.4||random()<.12)choices.push(['w-oak',.35],['w-willow',.12]);
        if(narrow>=1||random()<.3)choices.push(['w-pine',.3],['w-birch',.25]);
        if(!choices.length&&random()<.65)continue;
        choices.push(['w-bush',choices.length?.06:1]);
        if(put(wpick(choices),c.x,c.y))trees++;
      }
      let count=0;
      for(const c of shuffle(cells.filter(c=>dist.get(c.id)===1))){if(count>=[5,8,14,22][level])break;if(put(wpick([['w-fern',.5],['w-bush',.25],['w-rock',.25]]),c.x,c.y))count++;}
      count=0;
      for(const c of shuffle(deep.slice())){if(count>=[1,2,4,6][level])break;if(put(wpick([['w-log',.4],['w-stump',.35],['w-rock',.25]]),c.x,c.y))count++;}
    }
    // 住宅：每間房依類型擺家具。高的家具只靠北牆（正面朝向鏡頭）；房間中央只放成組家具；
    // 南緣一列只放矮的盆栽，免得擋住房內。place 會確認不擋住走道。
    function furnishRooms(){
      const kinds=roomKinds[spec.locationType].slice();for(let i=kinds.length-1;i>0;i--){const j=int(0,i);[kinds[i],kinds[j]]=[kinds[j],kinds[i]];}
      map.rooms.forEach((r,i)=>{r.kind=kinds[i%kinds.length];});
      // 走道會穿過房間中央；房內不必保留整條通道，place 仍會確認所有地面互相連通。
      for(const r of map.rooms)for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){const c=cell(x,y);if(c&&c.id!==map.spawn)c.core=false;}
      const undo=n=>{while(map.objects.length>n){const o=map.objects.pop();o.ids.forEach(id=>{map.cells[id].blocked=false;});availableFloor+=o.ids.length;}};
      const group=(items,ox,oy)=>{const n=map.objects.length;for(const[key,dx,dy]of items)if(!place(key,ox+dx,oy+dy)){undo(n);return false;}return true;};
      const span=(a,b)=>{const out=[];for(let v=a;v<=b;v++)out.push(v);return out;};
      const near=(list,centre)=>list.map(v=>[v,Math.abs(v-centre)+random()*.9]).sort((a,b)=>a[1]-b[1]).map(v=>v[0]);
      const plans={
        parlour:{north:[[['f-fireplace',0,0]],[['f-bookcase',0,0]],[['f-piano',0,0]],[['f-cabinet',0,0]],[['f-clock',0,0]]],
          centre:[[['f-sofa',0,0],['f-tea',0,1],['f-armchair',2,1]],[['f-sofa',0,0],['f-tea',0,1],['f-armchair',-1,1]]],small:[['f-armchair',0,0],['f-armchair',2,0]],side:['f-plant','f-armchair','f-cabinet']},
        study:{north:[[['f-desk',0,0]],[['f-bookcase',0,0]],[['f-bookcase',0,0]],[['f-clock',0,0]],[['f-cabinet',0,0]]],
          centre:[[['f-armchair',0,0],['f-globe',1,0],['f-armchair',2,0]]],small:[['f-globe',0,0]],side:['f-plant','f-globe','f-cabinet']},
        bedroom:{north:[[['f-bed',0,0],['f-nightstand',2,0]],[['f-wardrobe',0,0]],[['f-washstand',0,0]],[['f-nightstand',0,0]]],
          centre:[],small:[],side:['f-armchair','f-plant','f-washstand']},
        dining:{north:[[['f-sideboard',0,0]],[['f-clock',0,0]],[['f-cabinet',0,0]]],
          centre:[[['f-dining',0,0]]],small:[],side:['f-plant','f-cabinet']},
        // 工廠：熔爐、鍋爐、蒸汽錘、零件架與工作台靠北牆；車床與貨堆在中央；角落放木桶。
        boiler:{north:[[['m-furnace',0,0]],[['m-boiler',0,0]],[['m-rack',0,0]],[['m-furnace',0,0]]],
          centre:[[['m-cart',0,0],['m-barrel',1,0]]],small:[['m-cart',0,0]],side:['m-barrel','m-crates','m-cart']},
        workshop:{north:[[['m-bench',0,0]],[['m-press',0,0]],[['m-rack',0,0]],[['m-bench',0,0]]],
          centre:[[['m-lathe',0,0]]],small:[['m-lathe',0,0]],side:['m-crates','m-barrel']},
        storage:{north:[[['m-rack',0,0]],[['m-crates',0,0],['m-crates',1,0]],[['m-rack',0,0]]],
          centre:[[['m-crates',0,0],['m-crates',1,0],['m-barrel',0,1]],[['m-barrel',0,0],['m-barrel',1,0],['m-crates',2,0]]],small:[['m-crates',0,0],['m-barrel',1,0]],side:['m-barrel','m-crates']}
      };
      const corner=spec.locationType==='factory'?'m-barrel':'f-plant';
      for(const r of map.rooms){
        const plan=plans[r.kind],cx=r.x+(r.w-1)/2,bottom=r.y+r.h-1;
        plan.north.forEach((items,i)=>{
          if(i>0&&random()<.25)return;
          const width=Math.max(...items.map(([k,dx])=>dx+footprint(assets,k).cols));
          for(const x of near(span(r.x,r.x+r.w-width),cx))if(group(items,x,r.y))break;
        });
        // 中央成組：至少要留出北牆列與南緣列。
        const options=r.h>=4?plan.centre:plan.small.length?[plan.small]:[];
        if(options.length){const items=pick(options),w=Math.max(...items.map(([k,dx])=>dx+footprint(assets,k).cols)),h=Math.max(...items.map(([k,,dy])=>dy+footprint(assets,k).rows)),dmin=Math.min(...items.map(i=>i[1]));
          const origins=[];for(const y of span(r.y+1,bottom-h))for(const x of span(r.x+1-dmin,r.x+r.w-1-w))origins.push([x,y,Math.abs(x+w/2-.5-cx)+Math.abs(y+h/2-.5-(r.y+r.h/2))]);
          origins.sort((a,b)=>a[2]-b[2]);for(const[x,y]of origins)if(group(items,x,y))break;}
        for(let k=0,n=int(1,2);k<n;k++){const x=random()<.5?r.x:r.x+r.w-1;for(const y of near(span(r.y+1,bottom-1),r.y+r.h/2))if(place(pick(plan.side),x,y))break;}
        for(const x of [r.x,r.x+r.w-1])if(random()<.45)place(corner,x,bottom);
      }
    }
    if(spec.locationType==='london')londonLots();
    else if(indoor)furnishRooms();
    else plantWoods();

    const floor=reachable(map,map.spawn),dist=new Map([[map.spawn,0]]),queue=[map.spawn];
    for(let i=0;i<queue.length;i++)for(const n of adjacent(map,queue[i]))if(map.cells[n].active&&!map.cells[n].blocked&&!dist.has(n)){dist.set(n,dist.get(queue[i])+1);queue.push(n);}
    const far=floor.filter(id=>dist.get(id)>3).sort((a,b)=>dist.get(b)-dist.get(a));
    for(const id of far){if(map.markers.length>=[3,3,5,7][level])break;const c=map.cells[id];if(map.markers.every(n=>Math.abs(c.x-n%cols)+Math.abs(c.y-Math.floor(n/cols))>=(tiny?3:4)))map.markers.push(id);}
    if(tiny)for(const id of far){if(map.markers.length>=3)break;if(!map.markers.includes(id))map.markers.push(id);}
    map.floorCount=floor.length;
    if(!audit(map).ok)throw Error('地圖的封閉地面超出 5% 或單塊 3 格上限。');
    return map;
  }
  return {validate,parse,generate,route,reachable,adjacent,rng,types,sizes,limits,audit,validLayout,clearance};
});
