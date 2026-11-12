(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomeDashboard=api;
})(globalThis,()=>{
  'use strict';
  const DAY_MS=86400000;
  const MUSCLES=Object.freeze([
    {id:'chest',label:'胸',low:8,target:10,high:20},
    {id:'back',label:'背',low:10,target:12,high:22},
    {id:'shoulders',label:'肩',low:6,target:8,high:18},
    {id:'biceps',label:'二头',low:4,target:6,high:14},
    {id:'triceps',label:'三头',low:4,target:6,high:14},
    {id:'legs',label:'臀腿',low:10,target:12,high:22},
    {id:'core',label:'核心',low:4,target:6,high:14}
  ]);
  const MUSCLE_IDS=MUSCLES.map(x=>x.id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
  const dateKey=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const startOfDay=value=>{const d=new Date(value);d.setHours(0,0,0,0);return d;};
  const addDays=(value,days)=>{const d=new Date(value);d.setDate(d.getDate()+days);return d;};
  function focusGroups(focus){
    const text=String(focus||''),found=[];
    const add=id=>{if(!found.includes(id))found.push(id);};
    if(/胸/.test(text))add('chest');
    if(/背|斜方/.test(text))add('back');
    if(/肩/.test(text))add('shoulders');
    if(/二头|肱肌/.test(text))add('biceps');
    if(/三头/.test(text))add('triceps');
    if(/臀|腿|股|腘绳|小腿/.test(text))add('legs');
    if(/核心|腹/.test(text))add('core');
    return found;
  }
  function catalogMaps(catalog){
    const byId=new Map(),bySlug=new Map();
    for(const item of catalog||[]){
      if(!item||!item.id)continue;
      byId.set(item.id,item);
      for(const name of [item.name,item.displayName])if(name)bySlug.set(encodeURIComponent(name),item);
    }
    return {byId,bySlug};
  }
  function sessionGroups(session){
    const snapshot=session?.planSnapshot;
    if(!snapshot)return [];
    if(Array.isArray(snapshot[session.variant]))return snapshot[session.variant];
    const variant=snapshot.days?.[session.day]?.[session.variant];
    return Array.isArray(variant?.groups)?variant.groups:[];
  }
  function sessionVolume(session,catalog){
    const sets=Object.fromEntries(MUSCLE_IDS.map(id=>[id,0])),byId=catalogMaps(catalog).byId;
    const groups=sessionGroups(session);
    for(const group of groups){
      const progress=session.roundProgress?.[group.id];
      const raw=Number(progress?.completed);
      const rounds=Number.isFinite(raw)?Math.max(0,raw):Math.max(0,number(group.rounds));
      for(let round=1;round<=rounds;round++)for(const ex of group.exercises||[]){
        if(ex?.sets!=null&&round>number(ex.sets))continue;
        const item=byId.get(ex?.exerciseId||ex?.id);
        if(ex?.timer||item?.timerType)continue;
        const focus=item?.focus||ex?.focus||'';
        for(const id of focusGroups(focus))sets[id]++;
      }
    }
    const totalSets=MUSCLE_IDS.reduce((n,id)=>n+sets[id],0);
    return {id:String(session.startedAt||session.endedAt||''),startedAt:number(session.startedAt),endedAt:number(session.endedAt||session.startedAt),day:session.day,variant:session.variant,date:dateKey(session.endedAt||session.startedAt),durationMs:number(session.durationMs),sets,totalSets};
  }
  function volumeSummary(volumes,{days=8,now=Date.now()}={}){
    const first=dateKey(addDays(now,-(days-1))),last=dateKey(now);
    const rows=volumes.filter(row=>row.date>=first&&row.date<=last);
    const totals=Object.fromEntries(MUSCLE_IDS.map(id=>[id,0]));
    rows.forEach(row=>MUSCLE_IDS.forEach(id=>{totals[id]+=row.sets[id]||0;}));
    return MUSCLES.map(muscle=>{
      const sets=totals[muscle.id],weekly=sets*7/days;
      return {...muscle,sets,weekly,status:volumeStatus(weekly,muscle)};
    });
  }
  function volumeStatus(weekly,muscle){
    if(weekly<=0)return 'none';
    if(weekly<muscle.low)return 'low';
    if(weekly<muscle.target)return 'building';
    if(weekly<=muscle.high)return 'ok';
    return 'high';
  }
  function weeklyTrend(volumes,{weeks=4,now=Date.now(),days={}}={}){
    const today=startOfDay(now),monday=new Date(today);
    monday.setDate(today.getDate()-(today.getDay()+6)%7);
    const rows=[];
    for(let i=weeks-1;i>=0;i--){
      const start=addDays(monday,-i*7),end=addDays(start,7);
      const startKey=dateKey(start),endKey=dateKey(end);
      const volumeRows=volumes.filter(row=>row.date>=startKey&&row.date<endKey);
      let sessions=0,totalMs=0;
      for(const [date,records] of Object.entries(days||{})){
        if(date<startKey||date>=endKey||!records||typeof records!=='object')continue;
        for(const record of Object.values(records)){
          if(!record||typeof record!=='object')continue;
          const count=Math.max(number(record.count),Array.isArray(record.sessions)?record.sessions.length:0);
          sessions+=count;totalMs+=number(record.totalMs);
        }
      }
      rows.push({start:startKey,label:`${start.getMonth()+1}/${start.getDate()}`,sessions,totalMs,sets:volumeRows.reduce((n,row)=>n+row.totalSets,0)});
    }
    return rows;
  }
  function loadInfo(value){
    const raw=Number(value?.levelIndex),levelIndex=Number.isFinite(raw)?raw:null;
    const levelName=String(value?.levelName||'');
    const rawBand=value?.bandLoad&&typeof value.bandLoad==='object'&&!Array.isArray(value.bandLoad)?value.bandLoad:null;
    const rawCombination=String(rawBand?.combination??'').trim().replace(/\s/g,'').replace(/＋/g,'+');
    const parts=rawCombination?rawCombination.split('+').map(Number):[];
    const combination=rawCombination&&parts.every(n=>Number.isFinite(n)&&n>0)?parts.join('+'):'';
    const bandMin=combination?parts.reduce((sum,n)=>sum+n,0):number(rawBand?.min);
    const bandMax=combination?bandMin:Math.max(bandMin,number(rawBand?.max));
    const band=rawBand&&bandMin>0
      ? {min:bandMin,max:bandMax,unit:String(rawBand.unit||''),mode:String(rawBand.mode||'resistance'),combination}
      : null;
    return {levelIndex,levelName,band,key:JSON.stringify([levelIndex,levelName,band?.mode,band?.unit,band?.min,band?.max,band?.combination])};
  }
  function bandDirection(prev,next){
    if(!prev&&!next)return 0;
    if(!prev)return next.mode==='assistance'?-1:1;
    if(!next)return prev.mode==='assistance'?1:-1;
    if(prev.mode!==next.mode||prev.unit!==next.unit)return 0;
    const score=band=>band.mode==='assistance'?[-band.min,-band.max]:[band.min,band.max];
    const [prevLow,prevHigh]=score(prev),[nextLow,nextHigh]=score(next);
    return Math.sign(nextLow-prevLow)||Math.sign(nextHigh-prevHigh)||0;
  }
  function loadDirection(prev,next){
    if(prev.key===next.key)return 0;
    const level=prev.levelIndex!=null&&next.levelIndex!=null?Math.sign(next.levelIndex-prev.levelIndex):0;
    const band=bandDirection(prev.band,next.band);
    if(level&&band&&level!==band)return 0;
    return level||band||0;
  }
  function loadLabel(load){
    if(!load?.band)return '';
    const {min,max,unit,mode,combination}=load.band;
    const amount=combination||`${min}${max!==min?'–'+max:''}`;
    return `${mode==='assistance'?'辅助':'阻力'} ${amount} ${unit}`.trim();
  }
  function progressRows(volumes,sessions,catalog,{limit=6}={}){
    const {bySlug}=catalogMaps(catalog),groups=new Map();
    for(const session of sessions||[]){
      if(!session||session.finalized===false)continue;
      const plan=session.planSnapshot,variant=plan?.days?.[session.day]?.[session.variant],sectionIds=new Set((Array.isArray(plan?.[session.variant])?plan[session.variant]:variant?.groups||[]).map(g=>g.id));
      const progress=session.roundProgress||{},date=session.endedAt||session.startedAt;
      for(const [key,value] of Object.entries(session.values||{})){
        const [sectionId,roundText,slug]=key.split('::');
        if(!slug||(sectionIds.size&&!sectionIds.has(sectionId)))continue;
        if(!slug)continue;
        const round=number(roundText),completed=progress?.[sectionId]?.completed;
        if(Number.isFinite(Number(completed))&&round>Number(completed))continue;
        if(!value||value.reps==null||value.reps===''||!Number.isFinite(Number(value.reps)))continue;
        const reps=Number(value.reps),load=loadInfo(value);
        if(!groups.has(slug))groups.set(slug,{slug,item:bySlug.get(slug),points:new Map()});
        const row=groups.get(slug),existing=row.points.get(String(date));
        if(!existing||reps>existing.reps)row.points.set(String(date),{reps,load,levelName:value?.levelName||'',name:value?.levelName||bySlug.get(slug)?.name||decodeURIComponent(slug)});
      }
    }
    return [...groups.values()].map(row=>{
      const history=[...row.points.entries()].sort((a,b)=>Number(a[0])-Number(b[0])).map(([ts,point])=>({ts:Number(ts),...point}));
      const last=history.at(-1),previous=history.at(-2);
      const changed=!!previous&&previous.load.key!==last.load.key;
      const transition=previous?loadDirection(previous.load,last.load):0;
      // Reps are only comparable inside the same level and band resistance.
      const points=history.filter(point=>point.load.key===last.load.key);
      const best=Math.max(...points.map(p=>p.reps)),first=points[0],delta=last.reps-first.reps;
      const previousBest=points.slice(0,-1).length?Math.max(...points.slice(0,-1).map(p=>p.reps)):first.reps;
      const lastThree=points.slice(-3),beforeLastThree=points.slice(0,-3);
      const stalled=points.length>=3&&beforeLastThree.length>0&&Math.max(...lastThree.map(p=>p.reps))<=Math.max(...beforeLastThree.map(p=>p.reps));
      const regress=points.length>=2&&last.reps<=previousBest-2;
      const status=transition>0?'advance':transition<0?'deload':changed?'adjust':history.length<3?'new':regress?'regress':stalled?'stall':last.reps>previousBest?'up':last.reps>first.reps?'up':'hold';
      const note=transition>0?'负荷提升':transition<0?'负荷下调':changed?'负荷调整':delta===0?'最近保持':`${delta>0?'+':''}${delta} 次`;
      return {slug:row.slug,name:last.name,item:row.item,points,best,delta,status,note,load:last.load,loadLabel:loadLabel(last.load),lastReps:last.reps,lastTs:last.ts};
    }).sort((a,b)=>b.lastTs-a.lastTs||b.points.length-a.points.length||b.best-a.best).slice(0,limit);
  }
  function summary(volumes,{days={},now=Date.now()}={}){
    const today=startOfDay(now),start=dateKey(addDays(today,-6)),prevStart=dateKey(addDays(today,-13)),prevEnd=start;
    let sessions=0,totalMs=0,prevSessions=0,prevMs=0;
    const activeDates=new Set();
    for(const [date,records] of Object.entries(days||{})){
      if(!records||typeof records!=='object')continue;
      for(const record of Object.values(records)){
        if(!record||typeof record!=='object')continue;
        const count=Math.max(number(record.count),Array.isArray(record.sessions)?record.sessions.length:0);
        if(date>=start){sessions+=count;totalMs+=number(record.totalMs);if(count)activeDates.add(date);}
        else if(date>=prevStart&&date<prevEnd){prevSessions+=count;prevMs+=number(record.totalMs);}
      }
    }
    const activeDays=activeDates.size;
    const sets=volumes.filter(row=>row.date>=start).reduce((n,row)=>n+row.totalSets,0);
    const prevSets=volumes.filter(row=>row.date>=prevStart&&row.date<prevEnd).reduce((n,row)=>n+row.totalSets,0);
    return {sessions,totalMs,sets,prevSessions,prevMs,prevSets,activeDays};
  }
  function progressStatusLabel(row){
    if(row.status==='new')return {label:'样本较少',tone:'new'};
    if(row.status==='advance')return {label:'进阶',tone:'advance'};
    if(row.status==='deload')return {label:'降载',tone:'deload'};
    if(row.status==='adjust')return {label:'调整',tone:'adjust'};
    if(row.status==='regress')return {label:'回落',tone:'regress'};
    if(row.status==='stall')return {label:'停滞',tone:'stall'};
    if(row.status==='up')return {label:'进步',tone:'up'};
    return {label:'保持',tone:'hold'};
  }
  function sparkline(points){
    if(!points.length)return '';
    const width=96,height=30,pad=3,values=points.map(p=>p.reps),min=Math.min(...values),max=Math.max(...values),span=Math.max(1,max-min);
    const step=points.length>1?(width-pad*2)/(points.length-1):0;
    const d=points.map((p,i)=>`${i?'L':'M'}${(pad+i*step).toFixed(1)} ${(height-pad-(p.reps-min)/span*(height-pad*2)).toFixed(1)}`).join(' ');
    return `<svg class="dash-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="最近${points.length}次同负荷最佳次数：${values.join('、')}"><path d="${d}"/></svg>`;
  }
  function formatMinutes(ms){
    const minutes=Math.round(number(ms)/60000);
    return minutes>=60?`${Math.floor(minutes/60)}小时${String(minutes%60).padStart(2,'0')}分`:`${minutes}分`;
  }
  function deltaText(nowValue,beforeValue,unit){
    const diff=number(nowValue)-number(beforeValue);
    return diff===0?'持平':(diff>0?'+':'')+diff+unit;
  }
  function volumeStatusLabel(status){
    return {none:'未训练',low:'不足',building:'接近',ok:'达标',high:'偏高'}[status]||'';
  }
  const state={window:8,hosts:[],data:null};
  function html(){
    const data=state.data||{volumes:[],sessions:[],catalog:[],days:{},now:Date.now()};
    const now=data.now||Date.now(),volume=volumeSummary(data.volumes,{days:state.window,now}),trend=weeklyTrend(data.volumes,{weeks:4,now,days:data.days}),stat=summary(data.volumes,{days:data.days,now}),progress=progressRows(data.volumes,data.sessions,data.catalog);
    const hasData=stat.sessions>0||data.sessions.some(s=>s&&s.finalized!==false);
    const maxSets=Math.max(1,...trend.map(row=>row.sets));
    const progressHtml=progress.length?progress.map(row=>{
      const status=progressStatusLabel(row),range=row.item?`${row.item.equipment} · ${row.item.focus}`:'动作记录',load=row.loadLabel?` · ${row.loadLabel}`:'';
      return `<div class="dash-progress-row"><div class="dash-progress-name"><strong>${escape(row.name)}</strong><span>${escape(range)} · 最佳 ${row.best} 次${escape(load)}</span></div>${sparkline(row.points)}<div class="dash-progress-state ${status.tone}"><b>${status.label}</b><span>${escape(row.note)}</span></div></div>`;
    }).join(''):'<p class="dash-empty">记录两次以上同一负荷的逐组次数后，这里会显示进步、停滞与回落。</p>';
    const volumeHtml=volume.map(muscle=>{
      const width=Math.min(100,muscle.weekly/muscle.high*100),marker=Math.min(100,muscle.target/muscle.high*100);
      return `<div class="dash-muscle ${muscle.status}"><div class="dash-muscle-head"><strong>${muscle.label}<em>${volumeStatusLabel(muscle.status)}</em></strong><span>${muscle.weekly.toFixed(1)} / ${muscle.target} 组</span></div><div class="dash-bar"><div class="dash-bar-fill" style="width:${width.toFixed(1)}%"></div><i style="left:${marker.toFixed(1)}%"></i></div></div>`;
    }).join('');
    return `<div class="dash-head"><div><p class="dash-eyebrow">TRAINING ANALYTICS</p><h2>训练数据看板</h2><p>8天窗口与推拉腿 A/B 循环对齐；训练量按每轮实际完成的动作计为工作组。</p></div><div class="dash-window" role="group" aria-label="统计窗口">${[8,28].map(days=>`<button type="button" data-dash-window="${days}" aria-pressed="${state.window===days}">近${days}天</button>`).join('')}</div></div><div class="dash-summary"><div><strong>${stat.sessions}</strong><span>近7天训练次数</span><small>较前7天 ${deltaText(stat.sessions,stat.prevSessions,' 次')}</small></div><div><strong>${stat.sets}</strong><span>近7天工作组</span><small>较前7天 ${deltaText(stat.sets,stat.prevSets,' 组')}</small></div><div><strong>${formatMinutes(stat.totalMs)}</strong><span>近7天训练时长</span><small>较前7天 ${deltaText(Math.round(stat.totalMs/60000),Math.round(stat.prevMs/60000),' 分钟')}</small></div><div><strong>${stat.activeDays}</strong><span>近7天训练天数</span><small>${stat.activeDays>=3?'节奏稳定':'可从2–3天开始'}</small></div></div>${hasData?`<div class="dash-grid"><section class="dash-panel"><div class="dash-panel-head"><h3>肌群训练量</h3><span>近${state.window}天 · 折算每周</span></div><div class="dash-muscles">${volumeHtml}</div><p class="dash-note">折线标记为建议目标；单侧动作按一组计。按实际完成轮次统计，未填写次数的已完成轮次也计入。胸背肩优先时，二头和三头也会从拉/推动作中获得部分刺激。</p></section><section class="dash-panel"><div class="dash-panel-head"><h3>动作进展</h3><span>同负荷最佳组次数</span></div><div class="dash-progress-list">${progressHtml}</div><p class="dash-note">只有同一等级和阻力内的次数才参与进步、停滞与回落判断；等级提高或加阻标为进阶，减载标为降载。单次下降不一定需要降级，先看RIR和动作稳定性。</p></section></div><section class="dash-panel dash-trend"><div class="dash-panel-head"><h3>最近4周</h3><span>工作组 / 起始日期</span></div><div class="dash-weeks">${trend.map(row=>`<div class="dash-week"><div class="dash-week-bar"><div style="height:${Math.max(row.sets?8:0,row.sets/maxSets*100).toFixed(1)}%"></div></div><strong>${row.sets}组</strong><span>${row.label}起</span></div>`).join('')}</div></section>`:'<p class="dash-empty dash-empty-main">完成一次训练并记录逐组次数后，这里会生成肌群训练量、动作进展和周趋势。</p>'}`;
  }
  function render(host){
    if(!host)return;
    const next=html();
    if(host.__dashHtml===next)return;
    host.__dashHtml=next;host.innerHTML=next;
  }
  function renderAll(){state.hosts=state.hosts.filter(host=>host.isConnected);state.hosts.forEach(render);}
  function mount(){
    if(typeof document==='undefined')return;
    const host=document.getElementById('dashboardCard');
    if(!host||host.dataset.dashMounted)return;
    host.dataset.dashMounted='true';host.classList.add('home-dashboard');state.hosts.push(host);
    host.addEventListener('click',event=>{
      const button=event.target.closest('[data-dash-window]');if(!button)return;
      const value=Number(button.dataset.dashWindow);
      if(value===8||value===28){state.window=value;renderAll();}
    });
    render(host);
  }
  function updateHome(value={}){
    state.data={volumes:(value.sessions?Object.values(value.sessions):[]).filter(s=>s&&s.finalized).map(s=>sessionVolume(s,value.catalog||[])),sessions:value.sessions?Object.values(value.sessions).filter(s=>s&&s.finalized):[],catalog:value.catalog||[],days:value.days||{},now:value.now||Date.now()};
    if(typeof document!=='undefined'){mount();renderAll();}
  }
  return {MUSCLES,focusGroups,sessionVolume,volumeSummary,weeklyTrend,progressRows,summary,progressStatusLabel,sparkline,formatMinutes,volumeStatusLabel,updateHome,mount,renderAll,state};
});
