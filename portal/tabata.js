(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HomeTabata=api;})(globalThis,()=>{
  'use strict';
  const TAGS={jump:'跳跃',support:'手腕支撑'};
  const DEFAULT_EXCLUDES=['jump','support'];
  const action=(id,name,cue,media,tags=[],reference='')=>({id,name,cue,media,tags,reference});
  const LIBRARY=[
    action('step-jack','低冲击开合步','左右脚依次向外迈步并收回，双臂随步开合，全程不跳。','challenge/tabata-step-jack.svg'),
    action('quick-step','快速点步','小步快速交替点地，膝盖微屈，上身稳定，轻落地。','challenge/quick-step.gif'),
    action('knee-raise','站姿交替提膝','左右交替提膝，身体直立，脚落地后再换另一侧。','challenge/high-knees.gif'),
    action('march','原地快走','原地交替迈步，手臂自然摆动，保持均匀节奏。','challenge/tabata-march.svg'),
    action('side-step','侧向踏步','向一侧迈步，另一脚跟上，再换方向；不交叉脚。','challenge/tabata-side-step.svg'),
    action('punch','站姿轻拳击','站稳后左右轻快出拳，肩颈放松，肘部不猛锁死。','challenge/standing-punch.gif'),
    action('jumping-jack','开合跳','双脚轻跳开合，手臂随之举起放下，膝盖保持自然。','warmup/jumping-jack.gif',['jump']),
    action('mountain-climber','登山跑','双手撑稳、躯干保持直线，交替将膝盖收向胸前。','challenge/tabata-mountain-climber.svg',['support'])
  ];
  const find=value=>LIBRARY.find(a=>a.id===value||a.name===value||a.id===({'站姿出拳':'punch','站姿快速提膝':'knee-raise','站姿高抬腿':'knee-raise'}[value]))||null;
  const randomSettings=()=>({mode:'random',excludedTags:[...DEFAULT_EXCLUDES],excludedIds:[]});
  function pool(plan={}){const tags=Array.isArray(plan.excludedTags)?plan.excludedTags:DEFAULT_EXCLUDES,ids=Array.isArray(plan.excludedIds)?plan.excludedIds:[];return LIBRARY.filter(a=>!ids.includes(a.id)&&!a.tags.some(t=>tags.includes(t)));}
  function validate(plan){
    if(plan.mode!=null&&!['random','fixed'].includes(plan.mode))return '请选择随机抽取或固定动作。';
    if(plan.mode!=='random')return '';
    if(plan.excludedTags!=null&&(!Array.isArray(plan.excludedTags)||plan.excludedTags.some(t=>!Object.hasOwn(TAGS,t))))return 'Tabata排除标签无效。';
    if(plan.excludedIds!=null&&(!Array.isArray(plan.excludedIds)||plan.excludedIds.some(id=>!LIBRARY.some(a=>a.id===id))))return 'Tabata候选动作无效。';
    return pool(plan).length<2?'随机Tabata至少保留两个候选动作。':'';
  }
  function pick(plan,avoid=[],random=Math.random){
    const error=validate({...plan,mode:'random'});if(error)throw Error(error);
    const available=pool(plan),key=items=>items.map(a=>find(a)?.id||a).sort().join('|'),blocked=new Set(avoid.map(key));
    const pairs=[];for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++)pairs.push([available[i],available[j]]);
    const fresh=pairs.filter(p=>!blocked.has(key(p.map(a=>a.id)))),choices=fresh.length?fresh:pairs;
    const n=Math.max(0,Math.min(.999999999,Number(random())||0)),pair=choices[Math.floor(n*choices.length)].slice();
    if(random()<.5)pair.reverse();
    return {ids:pair.map(a=>a.id),actions:pair.map(a=>a.name),locked:false};
  }
  function ensure(active,key,plan,previous=[],redraw=false,random=Math.random){
    if(!active.tabataChoices||typeof active.tabataChoices!=='object'||Array.isArray(active.tabataChoices))active.tabataChoices={};
    const cached=active.tabataChoices[key],old=Array.isArray(cached?.actions)&&cached.actions.length===2&&cached.actions.every(a=>typeof a==='string'&&a.trim())?cached:null;
    if(old&&(!redraw||old.locked))return old;
    const next=pick(plan,[...(old?[old.actions]:[]),...(previous.length?[previous]:[])],random);
    active.tabataChoices[key]=next;return next;
  }
  return {LIBRARY,TAGS,DEFAULT_EXCLUDES,find,randomSettings,pool,validate,pick,ensure};
});
