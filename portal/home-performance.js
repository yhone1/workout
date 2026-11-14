/**
 * 轻健身 · 居家训练核心逻辑（次数区间、RIR 判定、逐轮目标与训练分析）
 *
 * 这些函数原先内联在 index.html，现迁移到本模块并改为通过 ctx 读取宿主状态：
 * index.html 在自身作用域里调用 HomePerformance.create(ctx) 得到实例，并在原位置保留同名薄封装转调，
 * 因此页面调用点、localStorage 结构与既有测试的桩接口都保持不变。
 * ctx 需要提供：sessionState、performanceState、WORKOUT_TARGET_MS、HomePlan、HomeProgression、
 * levelSnapshot、exerciseSlug、persistPerformance、clamp。
 */
(function exposeHomePerformance(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.HomePerformance = api;
})(globalThis, function exposeHomePerformanceModule() {
  'use strict';

  function create(ctx) {
  function recordedNumber(value){
      if(value===null||value===undefined||String(value).trim()==='') return null;
      return Number.isFinite(Number(value))?Number(value):null;
    }

  function exerciseTargetRir(ex){ return recordedNumber(ex.rir)??2; }

  function defaultRir(){ return {rir:null,rirSource:'default',rirRange:[1,2]}; }

  function rirBounds(value){
      const row=value&&typeof value==='object'?value:{rir:value};
      const rir=recordedNumber(row.rir);
      if(rir!==null)return {min:rir,max:rir,source:'manual'};
      if(row.rirSource==='default'&&Array.isArray(row.rirRange)&&row.rirRange[0]===1&&row.rirRange[1]===2)return {min:1,max:2,source:'default'};
      return null;
    }

  function rirAllowsProgress(row,targetRir=2){
      const bounds=rirBounds(row);
      return !!bounds&&bounds.min>=(targetRir>=3?3:1);
    }

  function rirLabel(value){
      const bounds=rirBounds(value);
      return !bounds?'未记录':bounds.source==='default'?'1–2（默认）':bounds.min>=3?'3+':String(bounds.min);
    }

  function nextRoundAdvice(reps,rir,range,targetRir=2){
      const value=recordedNumber(reps), bounds=rirBounds(rir), reserve=bounds?.min;
      if(value===null) return null;
      if(!bounds) return {target:value,label:'RIR未记录，维持次数'};
      if(bounds.source==='default')return {target:value,label:'默认RIR 1–2，维持次数；更轻松时手动记录'};
      if(reserve===0) return {target:Math.max(1,value-2),label:'减少2次或降低难度'};
      if(reserve>targetRir) return {target:Math.min(range.max,value+1),label:value<range.max?'余力高于目标，增加1次':'已达次数上限，维持'};
      return {target:value,label:'维持次数，动作变形再减量'};
    }

  function parseRepRange(ex){
      const perSide=ctx.levelSnapshot(ex.name)?.current?.perSide??!!ex.perSide;
      if(Number.isInteger(ex.repMin)&&Number.isInteger(ex.repMax)) return {min:ex.repMin,max:ex.repMax,perSide};
      const match=String(ex.detail||'').match(/(\d+)\s*[–—~-]\s*(\d+)\s*次/);
      if(match) return {min:Number(match[1]),max:Number(match[2]),perSide:perSide||String(ex.detail||'').includes('每侧')};
      const single=String(ex.detail||'').match(/(?:做|完成)?\s*(\d+)\s*次/);
      if(single) return {min:Number(single[1]),max:Number(single[1]),perSide:String(ex.detail||'').includes('每侧')};
      return null;
    }

  function performanceSessionId(startedAt){ return String(Number(startedAt)||0); }

  function ensurePerformanceSession(active=ctx.sessionState.active){
      if(!active) return null;
      const id=performanceSessionId(active.startedAt);
      if(!ctx.performanceState.sessions[id]) ctx.performanceState.sessions[id]={day:active.day,variant:active.variant,startedAt:active.startedAt,planRevision:active.planRevision,homeSchedule:active.homeSchedule||active.planSnapshot?.schedule||'threeDay',planSnapshot:active.planSnapshot?ctx.HomePlan.clone(active.planSnapshot):null,finalized:false,values:{}};
      if(!ctx.performanceState.sessions[id].values) ctx.performanceState.sessions[id].values={};
      return ctx.performanceState.sessions[id];
    }

  function performanceEntryKey(sectionId,round,name){ return `${sectionId}::${round}::${ctx.exerciseSlug(name)}`; }

  function activePerformanceEntry(sectionId,round,name){
      const record=ensurePerformanceSession();
      return record?.values?.[performanceEntryKey(sectionId,round,name)] || null;
    }

  function savePerformanceEntry(sectionId,round,name,patch){
      const record=ensurePerformanceSession(); if(!record) return;
      const key=performanceEntryKey(sectionId,round,name);
      const level=ctx.levelSnapshot(name);
      record.values[key]={...(record.values[key]||{}),...patch,levelIndex:level?.index??null,levelName:level?.current?.name||name,perSide:level?.current?.perSide??null,setupNote:level?.entry?.setupNote||'',setupRevision:ctx.HomeProgression.setupRevision(level?.entry),bandLoad:ctx.HomeProgression.bandLoad(level?.entry,level?.index),updatedAt:Date.now()};
      if(Object.prototype.hasOwnProperty.call(patch,'rir')){
        const row=record.values[key];
        if(recordedNumber(patch.rir)!==null){row.rirSource='manual';delete row.rirRange;}
        else if(patch.rirSource==='default')Object.assign(row,defaultRir());
        else {delete row.rirSource;delete row.rirRange;}
      }
      ctx.persistPerformance();
    }

  function confirmStrengthRir(sectionId,round,name){
      const value=activePerformanceEntry(sectionId,round,name);
      if(!rirBounds(value))savePerformanceEntry(sectionId,round,name,defaultRir());
    }

  function latestFinalizedPerformance(day,sectionId,name,currentLevel=null){
      const sessions=Object.values(ctx.performanceState.sessions)
        .filter(s=>s?.finalized && s.day===day)
        .sort((a,b)=>Number(b.endedAt||b.startedAt)-Number(a.endedAt||a.startedAt));
      const suffix=`::${ctx.exerciseSlug(name)}`;
      let latest=null;
      for(const session of sessions){
        const groups=new Map();
        for(const [key,value] of Object.entries(session.values||{})){
          if(!key.endsWith(suffix))continue;
          const [groupId,roundText]=key.split('::');
          const round=Number(roundText),reps=recordedNumber(value?.reps);
          const completed=session.roundProgress?.[groupId]?.completed;
          if(reps===null || (completed!==undefined && round>completed))continue;
          if(!groups.has(groupId))groups.set(groupId,[]);
          groups.get(groupId).push({round,reps,rir:recordedNumber(value.rir),rirSource:value.rirSource,
            rirRange:value.rirRange,levelIndex:recordedNumber(value.levelIndex),setupRevision:value.setupRevision});
        }
        // A/B 轮换可能把同一个动作放进不同组。每个组独立比较，避免把同次训练的两个剂量合并。
        const groupIds=[sectionId,...[...groups.keys()].filter(id=>id!==sectionId)];
        for(const groupId of groupIds){
          const rows=groups.get(groupId);
          if(!rows)continue;
          rows.sort((a,b)=>a.round-b.round);
          const candidate={session,rows};
          latest??=candidate;
          if(!currentLevel || rows.every(row=>ctx.HomeProgression.sameSetup(row,currentLevel.entry,currentLevel.index)))return candidate;
        }
      }
      return latest;
    }

  function baseRoundTargets(ex,rounds){
      const range=parseRepRange(ex); if(!range) return [];
      const middle=Math.round((range.min+range.max)/2);
      return Array.from({length:rounds},(_,i)=>ctx.clamp(middle-Math.ceil(i*.75),range.min,range.max));
    }

  function recalibratedTargets(ex,rounds,rows){
      const range=parseRepRange(ex); if(!range) return [];
      const reps=recordedNumber(rows?.[0]?.reps);
      if(reps===null) return baseRoundTargets(ex,rounds);
      const seed=ctx.clamp(reps-1,range.min,range.max);
      return Array.from({length:rounds},(_,i)=>ctx.clamp(seed-Math.ceil(i*.75),range.min,range.max));
    }

  function performanceAnalysis(day,variant,section,ex){
      const range=parseRepRange(ex); const baseTargets=baseRoundTargets(ex,section.rounds||1);
      if(!range) return {mode:'hold',targets:baseTargets,rows:[],reason:'按动作标准完成'};
      const currentLevel=ctx.levelSnapshot(ex.name);
      const latest=latestFinalizedPerformance(day,section.id,ex.name,currentLevel);
      if(!latest) return {mode:'new',targets:baseTargets,rows:[],reason:`首次校准：按建议次数尝试，以目标RIR ${exerciseTargetRir(ex)}结束`};
      const rows=latest.rows; const first=rows[0],last=rows[rows.length-1];
      if(currentLevel&&rows.some(row=>!ctx.HomeProgression.sameSetup(row,currentLevel.entry,currentLevel.index))){
        const targets=recalibratedTargets(ex,section.rounds||1,rows);
        return {mode:'new',targets,rows:[],reason:`动作等级或阻力/设置已改变，按上次首轮 ${recordedNumber(rows[0]?.reps)}次微调为首轮 ${targets[0]}次；旧记录保留`};
      }
      const hardEarly=first.rir!==null && (first.reps<range.min || (first.rir===0 && first.reps<=Math.min(range.max,range.min+1)));
      const easyAll=rows.length>=ctx.HomePlan.setCount(section,ex) && rows.every(x=>x.reps>=range.max && rirAllowsProgress(x,exerciseTargetRir(ex)));
      const fatigueDrop=rows.length>=2 && rirBounds(first) && rirBounds(last) && last.reps<=first.reps*.75;
      const repeatedFailure=rows.length>=2 && rows.slice(-2).every(x=>x.rir===0);
      let mode='hold';
      if(hardEarly) mode='recover'; else if(easyAll) mode='progress'; else if(fatigueDrop||repeatedFailure) mode='fatigue';
      let targets=[]; let holdNote='';
      if(mode==='progress') targets=Array(section.rounds).fill(range.max);
      else if(mode==='recover') targets=baseTargets;
      else if(mode==='fatigue'){
        const start=ctx.clamp(Math.min(first.reps,Math.max(range.min,baseTargets[0])),range.min,range.max);
        targets=Array.from({length:section.rounds},(_,i)=>ctx.clamp(start-i,Math.max(1,range.min),range.max));
      } else {
        // 后续轮次明显高于首轮，说明首轮还有余力；下次首轮只加 1 次，不因后两轮的高次数直接跳到上限。
        // 若历史 RIR 高于目标 RIR，说明余力高于预期，也加 1。
        const peak=Math.max(...rows.map(row=>row.reps));
        const firstRir=rirBounds(first)?.min;
        const targetRir=exerciseTargetRir(ex);
        const reserve=first.rir!==0 && first.reps>=range.min && (peak>=first.reps+2 || (firstRir!=null && firstRir>targetRir));
        const start=ctx.clamp(reserve?first.reps+1:first.reps,range.min,range.max);
        targets=Array(section.rounds).fill(start);
        holdNote=reserve?`；后续轮次高于首轮或 RIR 高于目标，下次首轮 ${start} 次`:`；下次首轮维持 ${start} 次`;
      }
      const reason=mode==='recover'?`上次第1轮 ${first.reps}次 / RIR ${rirLabel(first)}，动作难度过高`:
        mode==='progress'?`上次所有轮达到上限且RIR达到进阶要求，可考虑提高难度`:
        mode==='fatigue'?`上次由第1轮 ${first.reps}次降到末轮 ${last.reps}次，疲劳下降明显`:
        `根据上次 ${rows.map(x=>`${x.reps}/RIR ${rirLabel(x)}`).join('、')} 校准${holdNote}`;
      return {mode,targets,rows,reason};
    }

  function activePerformanceRows(sectionId,name,uptoRound=99){
      const record=ensurePerformanceSession(); if(!record) return [];
      const snap=ctx.levelSnapshot(name);
      return Object.entries(record.values||{}).filter(([key])=>key.startsWith(`${sectionId}::`) && key.endsWith(`::${ctx.exerciseSlug(name)}`))
        .map(([key,value])=>({round:Number(key.split('::')[1]),reps:recordedNumber(value.reps),rir:recordedNumber(value.rir),rirSource:value.rirSource,rirRange:value.rirRange,levelIndex:value.levelIndex,setupRevision:value.setupRevision}))
        .filter(x=>x.round<=uptoRound&&x.reps!==null&&(!snap||ctx.HomeProgression.sameSetup(x,snap.entry,snap.index))).sort((a,b)=>a.round-b.round);
    }

  function targetForRound(day,variant,section,ex,round){
      const result=performanceAnalysis(day,variant,section,ex); const range=parseRepRange(ex);
      const liveRows=activePerformanceRows(section.id,ex.name,round-1);
      if(range && liveRows.length){
        const first=liveRows[0],last=liveRows[liveRows.length-1];
        let {target,label:reason}=nextRoundAdvice(last.reps,last,range,exerciseTargetRir(ex));
        if(first.rir===0 && first.reps<=Math.min(range.max,range.min+1)){
          target=Math.max(1,last.reps-1); reason='本次第一轮已接近或达到力竭：下一轮先减1次，以RIR 1–2结束；连续两次才自动降级';
        }
        return {target,mode:result.mode,targets:result.targets,rows:result.rows,reason};
      }
      return {target:result.targets[Math.max(0,round-1)]||result.targets[0]||'',...result};
    }

  function finishSuggestion(day){
      const active=ctx.sessionState.active; if(!active||active.day!==day) return null;
      const elapsed=Date.now()-Number(active.startedAt||Date.now());
      if(elapsed>=ctx.WORKOUT_TARGET_MS) return {reason:'本次已到40分钟参考时长，可跳过可选间歇，也可按状态继续'};
      const values=Object.values(ctx.performanceState.sessions[performanceSessionId(active.startedAt)]?.values||{});
      const hardRows=values.filter(value=>recordedNumber(value?.rir)===0).length;
      return hardRows>=2?{reason:'本次已有两项动作达到RIR 0'}:null;
    }

  function workoutTimeAssessment(durationMs){
      return durationMs<=ctx.WORKOUT_TARGET_MS?'已按实际完成内容保存，不必凑满40分钟。':'本次已按实际时长保存；40分钟仅作参考，下次按状态安排间歇，保留必要休息。';
    }

    return {
      recordedNumber,
      exerciseTargetRir,
      defaultRir,
      rirBounds,
      rirAllowsProgress,
      rirLabel,
      nextRoundAdvice,
      parseRepRange,
      performanceSessionId,
      ensurePerformanceSession,
      performanceEntryKey,
      activePerformanceEntry,
      savePerformanceEntry,
      confirmStrengthRir,
      latestFinalizedPerformance,
      baseRoundTargets,
      recalibratedTargets,
      performanceAnalysis,
      activePerformanceRows,
      targetForRound,
      finishSuggestion,
      workoutTimeAssessment
    };
  }

  return { create };
});
