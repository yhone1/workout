(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrainingCalendar=api;})(globalThis,()=>{
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Math.max(0,Number(value)||0);
  const dateKey=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const labels={push:'推 · 三练一休',pull:'拉 · 三练一休',legs:'腿 · 三练一休',four_push:'推＋腿前侧 · 四练',four_pull:'拉＋腿后侧 · 四练',mrt:'MRT',cindy:'Cindy'};
  function selectHomeState(remote,local,owner,userId){
    const stamp=raw=>{try{return Number(JSON.parse(raw)?.updatedAt)||0;}catch{return 0;}};
    return owner!=null&&userId!=null&&String(owner)===String(userId)&&stamp(local.thinMuscleWorkoutSessionV3)>stamp(remote.thinMuscleWorkoutSessionV3)?local:remote;
  }
  function homeEntries(days={},cindy=[]){
    const entries=[],known=new Set();
    for(const [date,groups] of Object.entries(days||{})){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!groups||typeof groups!=='object')continue;
      for(const [key,record] of Object.entries(groups)){
        if(!record||typeof record!=='object')continue;
        const sessions=Array.isArray(record.sessions)?record.sessions:[],count=Math.max(number(record.count),sessions.length);
        if(!count)continue;
        for(const session of sessions)if(key==='cindy')known.add(String(session.startedAt||session.endedAt));
        const last=sessions.at(-1),rounds=last?.roundProgress;
        const volume=rounds?Object.entries(rounds).map(([phase,r])=>`${r.label||(phase==='main'?'主关卡':phase==='support'?'补强':phase)} ${number(r.completed)}轮${r.addedCompleted?`（加练${number(r.addedCompleted)}轮）`:''}`).join('，'):'';
        const variants=[...new Set(sessions.map(s=>s.variant).filter(v=>v==='A'||v==='B'))];
        const feedback={easy:'偏轻松',right:'刚刚好',hard:'偏吃力',joint:'关节不适'}[record.lastFeedback];
        entries.push({id:`home:${date}:${key}`,date,source:key==='mrt'||key==='cindy'?'挑战':'居家',label:labels[key]||key,count,totalMs:number(record.totalMs),detail:[variants.length?variants.join('/')+'版':'',volume,feedback].filter(Boolean).join(' · ')});
      }
    }
    const seen=new Set();
    for(const session of cindy||[]){
      const id=String(session.startedAt||session.endedAt),date=dateKey(session.endedAt||session.startedAt);
      if(!date||known.has(id)||seen.has(id))continue;seen.add(id);
      entries.push({id:'cindy:'+id,date,source:'挑战',label:'Cindy',count:1,totalMs:number(session.durationMs),detail:`${number(session.completedRounds)}轮`});
    }
    return entries;
  }
  function mergeEntries({days,cindy,gym=[],member=[]}={}){
    const entries=homeEntries(days,cindy),seen=new Set();
    for(const [source,rows] of [['健身房',gym],['会员自助',member]])for(const row of rows){
      if(row.status!=='completed'||row.id==null)continue;
      const id='db:'+String(row.id),date=dateKey(row.endedAt||row.ended_at||row.startedAt||row.started_at);
      if(!date||seen.has(id))continue;seen.add(id);
      const seconds=row.durationSeconds??row.duration_seconds;
      const duration=seconds==null?Math.max(0,new Date(row.endedAt||row.ended_at)-new Date(row.startedAt||row.started_at)):number(seconds)*1000;
      entries.push({id,date,source,label:row.dayName||row.day_name||'训练',count:1,totalMs:number(duration),detail:''});
    }
    return entries.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  }
  function stats(entries,dates){const keys=new Set(dates),rows=entries.filter(e=>keys.has(e.date));return {days:new Set(rows.map(r=>r.date)).size,count:rows.reduce((n,r)=>n+r.count,0),totalMs:rows.reduce((n,r)=>n+r.totalMs,0)};}
  const duration=ms=>{const minutes=Math.round(number(ms)/60000);return minutes>=60?`${Math.floor(minutes/60)}小时${minutes%60}分`:`${minutes}分`;};
  let localHome=null,remote={},hosts=[],tokenSeen=null,owner=null,loading=null,errors=[],notice='',generation=0;
  function updateHome(value){localHome=value;renderAll();}
  function entries(){return mergeEntries({...remote,...(localHome||{})});}
  function weekDates(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return Array.from({length:7},(_,i)=>{const day=new Date(d);day.setDate(d.getDate()+i);return day;});}
  function render(host){
    const rows=entries(),now=new Date(),today=dateKey(now),week=weekDates(),state=host.calendarState||{expanded:false,selected:null,y:now.getFullYear(),m:now.getMonth()};host.calendarState=state;
    const signature=JSON.stringify([rows,state,errors,notice,Boolean(loading),today]);if(signature===host.calendarSignature)return;host.calendarSignature=signature;
    const cell=(d,month)=>{const key=dateKey(d),trained=rows.filter(r=>r.date===key);return `<button type="button" class="tc-day${trained.length?' tc-done':''}${today===key?' tc-today':''}${state.selected===key?' tc-selected':''}" data-tc-date="${key}" aria-label="${key}${trained.length?' 已训练':''}"><span>${d.getDate()}</span>${month&&trained.length?`<small>${escape([...new Set(trained.map(r=>r.source==='居家'?(r.label.startsWith('推')?'推':r.label.startsWith('拉')?'拉':'腿'):r.source==='挑战'?r.label:r.source))].join('·'))}</small>`:''}</button>`;};
    const weekStats=stats(rows,week.map(dateKey));
    let html=`<div class="tc-heading"><div><strong>训练日历</strong><span>所有训练共用 · 本周已练 ${weekStats.days} 天 · ${duration(weekStats.totalMs)}</span></div><button type="button" data-tc-toggle aria-expanded="${state.expanded}">${state.expanded?'收起日历':'查看月度日历'}</button></div><div class="tc-week">${week.map(d=>cell(d,false)).join('')}</div>`;
    if(state.expanded){
      const dates=Array.from({length:new Date(state.y,state.m+1,0).getDate()},(_,i)=>new Date(state.y,state.m,i+1)),monthStats=stats(rows,dates.map(dateKey));
      const selected=rows.filter(r=>r.date===state.selected);
      html+=`<div class="tc-month"><div class="tc-controls"><button type="button" data-tc-nav="-1" aria-label="上个月">◀</button><strong>${state.y}年${state.m+1}月</strong><button type="button" data-tc-nav="1" aria-label="下个月">▶</button><button type="button" data-tc-now>回到本月</button></div><p class="tc-summary">本月已练 ${monthStats.days} 天 · 共 ${monthStats.count} 次 · ${duration(monthStats.totalMs)}</p><div class="tc-grid tc-weekdays">${['一','二','三','四','五','六','日'].map(d=>`<span>${d}</span>`).join('')}</div><div class="tc-grid">${'<span></span>'.repeat((dates[0].getDay()+6)%7)}${dates.map(d=>cell(d,true)).join('')}</div>${state.selected?`<div class="tc-detail"><strong>${escape(state.selected)}</strong>${selected.length?selected.map(r=>`<p><b>${escape(r.source)} · ${escape(r.label)}</b><span>${r.count}次 · ${duration(r.totalMs)}${r.detail?' · '+escape(r.detail):''}</span></p>`).join(''):'<p>当天暂无已完成训练。</p>'}</div>`:''}</div>`;
    }
    if(errors.length)html+=`<p class="tc-error" role="status">${escape(errors.join('；'))}，统计暂不完整。<button type="button" data-tc-refresh>重试</button></p>`;
    else if(loading)html+='<p class="tc-note">正在汇总账号训练记录…</p>';
    if(notice)html+=`<p class="tc-note">${escape(notice)}</p>`;
    host.innerHTML=html;
  }
  function renderAll(){hosts=hosts.filter(h=>h.isConnected);hosts.forEach(render);}
  function mount(){
    if(typeof document==='undefined')return;
    document.querySelectorAll('[data-training-calendar]').forEach(host=>{
      if(host.dataset.tcMounted)return;host.dataset.tcMounted='true';host.classList.add('training-calendar');hosts.push(host);
      host.addEventListener('click',event=>{
        const b=event.target.closest('button');if(!b)return;const state=host.calendarState;
        if(b.hasAttribute('data-tc-toggle'))state.expanded=!state.expanded;
        if(b.dataset.tcDate){state.selected=state.selected===b.dataset.tcDate?null:b.dataset.tcDate;state.expanded=true;const d=new Date(b.dataset.tcDate+'T12:00:00');state.y=d.getFullYear();state.m=d.getMonth();}
        if(b.dataset.tcNav){const d=new Date(state.y,state.m+Number(b.dataset.tcNav),1);state.y=d.getFullYear();state.m=d.getMonth();state.selected=null;}
        if(b.hasAttribute('data-tc-now')){state.y=new Date().getFullYear();state.m=new Date().getMonth();state.selected=null;}
        if(b.hasAttribute('data-tc-refresh'))refresh();else render(host);
      });render(host);
    });
  }
  async function refresh(){
    mount();const token=localStorage.getItem('thinMuscleAuthToken')||'';
    if(token!==tokenSeen){tokenSeen=token;owner=null;remote={};localHome=null;errors=[];generation++;}
    if(!token){notice='本机居家训练记录；登录后可汇总账号训练。';renderAll();return;}
    const version=generation;if(loading)return loading;
    const get=async path=>{const response=await fetch(path,{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw new Error('读取失败');return response.json();};
    loading=(async()=>{
      errors=[];notice='健身房与会员自助历史按现有接口各汇总最近100条；仅统计已完成训练。';
      try{
        const viewer=await get('/api/auth/me');if(version!==generation)return;
        if(owner!==null&&String(owner)!==String(viewer.id))localHome=null;owner=viewer.id;
        const jobs=[['健身房',()=>get('/api/gym/sessions').then(data=>({gym:data.sessions||[]}))]];
        if(viewer.isSuperAdmin||viewer.entitlements?.homeTraining)jobs.push(['居家',()=>get('/api/state').then(data=>{
          const local=Object.fromEntries(['thinMuscleWorkoutSessionV3','thinMuscleCindyV1'].map(key=>[key,localStorage.getItem(key)]));
          const selected=selectHomeState(data,local,localStorage.getItem('thinMuscleStateOwnerV1'),viewer.id);
          const parse=key=>{try{return JSON.parse(selected[key]||'{}');}catch{throw new Error('记录格式错误');}};
          return {days:parse('thinMuscleWorkoutSessionV3').days||{},cindy:parse('thinMuscleCindyV1').history||[]};
        })]);
        if(viewer.isSuperAdmin||viewer.entitlements?.memberPlans)jobs.push(['会员自助',()=>get('/api/member/sessions').then(data=>({member:data.sessions||[]}))]);
        const results=await Promise.allSettled(jobs.map(([,job])=>job()));if(version!==generation)return;
        remote={};results.forEach((result,i)=>{if(result.status==='fulfilled')Object.assign(remote,result.value);else errors.push(jobs[i][0]+'记录读取失败');});
      }catch{if(version===generation)errors=['账号训练记录读取失败'];}
    })();renderAll();
    try{await loading;}finally{loading=null;if(version===generation)renderAll();else refresh();}
  }
  if(typeof document!=='undefined'){
    const boot=()=>{mount();refresh();new MutationObserver(()=>{mount();if((localStorage.getItem('thinMuscleAuthToken')||'')!==tokenSeen)refresh();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
    window.addEventListener('focus',()=>refresh());window.addEventListener('training-records-changed',()=>refresh());
    window.addEventListener('storage',event=>{if(event.key==='thinMuscleAuthToken')refresh();});
  }
  return {dateKey,selectHomeState,homeEntries,mergeEntries,stats,updateHome,refresh,mount};
});
