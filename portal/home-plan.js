(function(root, factory){const api=factory(typeof module==='object'&&module.exports?require('./tabata'):root.HomeTabata);if(typeof module==='object'&&module.exports)module.exports=api;else root.HomePlan=api;})(globalThis,(Tabata)=>{
  'use strict';
  const KEY='thinMuscleHomePlanV1';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const home=(id,name,equipment,focus,cue,gif)=>({id,name,equipment,focus,cue,gif:gif||''});
  const HOME_CATALOG=[
  {
    "id": "feet-push",
    "name": "脚抬高俯卧撑",
    "equipment": "徒手",
    "focus": "上胸",
    "cue": "双脚放稳固低台，保持躯干直线；下放约2秒，肩前不适降低台面。",
    "gif": "warmup/push-up.gif"
  },
  {
    "id": "push",
    "name": "普通俯卧撑",
    "equipment": "徒手",
    "focus": "胸",
    "cue": "肘与躯干约30–45度，胸接近地面；肩胛自然移动，不塌腰。",
    "gif": "warmup/push-up.gif"
  },
  {
    "id": "trx-push",
    "name": "TRX俯卧撑",
    "equipment": "TRX",
    "focus": "胸",
    "cue": "身体保持直线，控制下放；身体更直立可降低难度。",
    "gif": "push/trx-push-up.gif"
  },
  {
    "id": "lateral",
    "name": "弹力带侧平举",
    "equipment": "弹力带",
    "focus": "侧肩",
    "cue": "单臂交替，手肘微屈，抬至肩高附近；不耸肩、不甩腰。",
    "gif": "push/band-lateral-raise.gif"
  },
  {
    "id": "press",
    "name": "弹力带站姿肩推",
    "equipment": "弹力带",
    "focus": "肩",
    "cue": "肋骨不外翻，手臂上举时允许肩胛自然上旋。",
    "gif": "push/band-shoulder-press.gif"
  },
  {
    "id": "triceps",
    "name": "弹力带下压",
    "equipment": "弹力带",
    "focus": "三头",
    "cue": "固定点牢靠，大臂贴近身体，只伸肘，不压肩。",
    "gif": "push/cable-pushdown-with-rope-attachment.gif"
  },
  {
    "id": "overhead",
    "name": "弹力带过顶臂屈伸",
    "equipment": "弹力带",
    "focus": "三头",
    "cue": "大臂尽量稳定，避免腰椎过伸；肘部不适减少拉伸幅度。",
    "gif": "push/cable-high-pulley-overhead-tricep-extension.gif"
  },
  {
    "id": "pull",
    "name": "引体向上 / 弹力带辅助",
    "equipment": "引体杆",
    "focus": "背",
    "cue": "选足够辅助完成全程，控制下降，不摆动、不跳跃凑次数。",
    "gif": "pull/pull-up.gif"
  },
  {
    "id": "chin",
    "name": "反手引体向上 / 弹力带辅助",
    "equipment": "引体杆",
    "focus": "背、二头",
    "cue": "握距约肩宽，控制下降；手腕或肘不适改中立/正握辅助。",
    "gif": "pull/pull-up.gif"
  },
  {
    "id": "row",
    "name": "TRX划船",
    "equipment": "TRX",
    "focus": "背",
    "cue": "肘贴近身体拉向肋部，躯干保持直线，控制回落。",
    "gif": "pull/trx-row.gif"
  },
  {
    "id": "wide-row",
    "name": "宽握TRX划船",
    "equipment": "TRX",
    "focus": "上背",
    "cue": "肘与身体约45–60度，向胸侧拉，肩胛自然移动。",
    "gif": "pull/trx-row.gif"
  },
  {
    "id": "pulldown",
    "name": "弹力带直臂下压",
    "equipment": "弹力带",
    "focus": "背",
    "cue": "高位固定，肘微屈且角度稳定，将上臂拉向身体两侧。",
    "gif": "pull/band-straight-arm-pulldown.gif"
  },
  {
    "id": "face",
    "name": "弹力带面拉",
    "equipment": "弹力带",
    "focus": "后肩、上背",
    "cue": "向面部拉，手向耳侧分开；不用腰后仰，不强行夹肩胛。",
    "gif": "pull/band-face-pull.gif"
  },
  {
    "id": "fly",
    "name": "TRX反向飞鸟",
    "equipment": "TRX",
    "focus": "后肩",
    "cue": "从较直立角度开始，肘微屈，打开双臂；避免肩前疼痛。",
    "gif": "pull/trx-reverse-fly.gif"
  },
  {
    "id": "curl",
    "name": "弹力带二头弯举",
    "equipment": "弹力带",
    "focus": "二头",
    "cue": "掌心向上，大臂稳定，控制下放。",
    "gif": "pull/band-biceps-curl.gif"
  },
  {
    "id": "hammer",
    "name": "弹力带锤式弯举",
    "equipment": "弹力带",
    "focus": "二头、肱肌",
    "cue": "掌心相对，大臂稳定；避免身体后仰借力。",
    "gif": "pull/cable-hammer-curl-with-rope.gif"
  },
  {
    "id": "lunge",
    "name": "徒手反向弓步",
    "equipment": "徒手",
    "focus": "臀腿",
    "cue": "向后落步，前脚全脚掌稳定；膝盖顺脚尖方向移动。",
    "gif": "warmup/bodyweight-lunge.gif"
  },
  {
    "id": "split",
    "name": "分腿蹲",
    "equipment": "徒手",
    "focus": "臀腿",
    "cue": "双脚前后站稳并着地，垂直下蹲；深度以膝髋舒适为准。",
    "gif": "legs/bodyweight-split-squat.gif"
  },
  {
    "id": "rdl",
    "name": "弹力带罗马尼亚硬拉",
    "equipment": "弹力带",
    "focus": "臀、腿后侧",
    "cue": "双脚踩稳弹力带并握住两端，膝微屈，臀向后推；背部中立，靠髋伸展站起。",
    "gif": "legs/band-romanian-deadlift.gif"
  },
  {
    "id": "leg-curl",
    "name": "弹力带俯卧腿弯举",
    "equipment": "弹力带",
    "focus": "腿后侧",
    "cue": "低位固定弹力带并连接脚踝，俯卧屈膝；骨盆贴地，固定点必须牢靠。",
    "gif": "legs/band-prone-leg-curl.gif"
  },
  {
    "id": "calf",
    "name": "单腿提踵",
    "equipment": "徒手",
    "focus": "小腿",
    "cue": "扶墙保持平衡，膝伸直但不锁死，脚跟慢落；单侧完成。",
    "gif": "legs/single-leg-calf-raise.gif"
  },
  {
    "id": "bent-calf",
    "name": "微屈膝单腿提踵",
    "equipment": "徒手",
    "focus": "小腿",
    "cue": "扶墙，保持膝微屈，脚跟受控升降，不靠上下蹲借力。",
    "gif": "legs/bent-knee-single-leg-calf-raise.gif"
  },
  {
    "id": "wheel",
    "name": "跪姿健腹轮",
    "equipment": "健腹轮",
    "focus": "核心",
    "cue": "收紧腹部，骨盆不前倾；只滚到能保持腰背稳定的距离。",
    "gif": "core/kneeling-ab-wheel-rollout.gif"
  },
  {
    "id": "pallof",
    "name": "站姿弹力带抗旋转",
    "equipment": "弹力带",
    "focus": "核心",
    "cue": "站在固定点侧面，将手向前推出，身体不转；两侧分别完成。",
    "gif": "core/band-pallof-press.gif"
  },
  {
    "id": "squat",
    "name": "徒手深蹲",
    "equipment": "徒手",
    "focus": "臀腿",
    "cue": "脚掌稳定，膝盖顺脚尖移动，下蹲至可控深度。",
    "gif": "warmup/bodyweight-squat.gif"
  },
  {
    "id": "bridge",
    "name": "臀桥",
    "equipment": "徒手",
    "focus": "臀",
    "cue": "收紧腹部，靠臀部伸髋，顶端不反弓腰。",
    "gif": ""
  },
  {
    "id": "deadbug",
    "name": "死虫式",
    "equipment": "徒手",
    "focus": "核心",
    "cue": "腰背稳定贴地，缓慢交替伸展对侧手脚，保持呼吸。",
    "gif": ""
  },
  {
    "id": "pike",
    "name": "倒V俯卧撑",
    "equipment": "徒手",
    "focus": "肩",
    "cue": "髋抬高，头向双手之间下落；控制幅度，不用颈部承重。",
    "gif": ""
  }
];
  const ref=(id,min,max,perSide=false,rir=2)=>({exerciseId:id,repMin:min,repMax:max,perSide,rir,cue:''});
  const SCHEDULES={threeDay:{label:'练三休一',days:['push','pull','legs'],names:{push:'推 · 胸肩三头',pull:'拉 · 背后肩二头',legs:'腿 · 臀腿核心'},sequence:'推A → 拉A → 腿A → 休 → 推B → 拉B → 腿B → 休'},fourDay:{label:'一周四练',days:['push','pull'],names:{push:'推＋腿前侧',pull:'拉＋腿后侧'},sequence:'周一推A → 周二拉A → 周三休 → 周四推B → 周五拉B → 周末休'}};
  const schedule=plan=>plan?.schedule==='fourDay'?'fourDay':'threeDay';
  const dayKeys=plan=>SCHEDULES[schedule(plan)].days;
  function weeklySlot(value=new Date()){
    const day=new Date(value).getDay();
    return [{day:'rest',variant:'A'},{day:'push',variant:'A'},{day:'pull',variant:'A'},{day:'rest',variant:'B'},{day:'push',variant:'B'},{day:'pull',variant:'B'},{day:'rest',variant:'A'}][day];
  }
  function exercisesForRound(section,round){return section.exercises.filter(ex=>ex.sets==null||round<=ex.sets||round>(section.plannedRounds??section.rounds));}
  function setCount(section,ex){return Math.min(ex.sets??section.rounds,section.plannedRounds??section.rounds)+Math.max(0,section.rounds-(section.plannedRounds??section.rounds));}
  function defaults(mode='threeDay'){
    if(mode==='fourDay')return fourDayDefaults();
    const d={schema:1,label:'肩背优先 · 居家 A/B',days:{}};
    const make=(main,support,rest)=>({warmupEnabled:true,warmupSeconds:180,main:{rounds:3,restSeconds:rest,exercises:main},support:{rounds:2,restSeconds:rest===120?90:75,exercises:support},tabataEnabled:true,tabata:{work:20,rest:10,rounds:6,actions:['低冲击开合步','站姿交替提膝']}});
    d.days.push={A:make([ref('feet-push',8,12),ref('lateral',12,18,true,3)],[ref('press',8,12),ref('triceps',10,15)],90),B:make([ref('push',8,12),ref('lateral',12,18,true,3)],[ref('fly',12,18,false,3),ref('overhead',10,15)],90)};
    d.days.pull={A:make([ref('pull',4,8),ref('row',8,12)],[ref('pulldown',10,15),ref('face',12,18,false,3),ref('curl',10,15)],120),B:make([ref('chin',4,8),ref('wide-row',8,12)],[ref('pulldown',10,15),ref('hammer',10,15)],120)};
    d.days.legs={A:make([ref('lunge',8,12,true,3),ref('rdl',10,15,false,3)],[ref('calf',10,15,true,3),ref('wheel',5,8)],90),B:make([ref('split',8,12,true,3),ref('leg-curl',10,15,false,3)],[ref('bent-calf',10,15,true,3),ref('pallof',8,12,true)],90)};
    ['A','B'].forEach(v=>d.days.legs[v].support.restSeconds=90);
    d.days.pull.A.tabata.actions=['原地快走','站姿交替提膝'];d.days.pull.B.tabata.actions=['侧向踏步','原地快走'];d.days.legs.A.tabata.actions=['站姿轻拳击','低冲击开合步'];d.days.legs.B.tabata.actions=['站姿轻拳击','侧向踏步'];
    return d;
  }
  function fourDayDefaults(){
    const make=(main,support,rest=90)=>({warmupEnabled:true,warmupSeconds:180,main:{rounds:3,restSeconds:rest,exercises:main},support:{rounds:2,restSeconds:75,exercises:support},tabataEnabled:false,tabata:{work:20,rest:10,rounds:8,actions:['低冲击开合步','站姿交替提膝']}});
    const d={schema:1,schedule:'fourDay',label:'肩背优先 · 一周四练 A/B',days:{
      push:{A:make([ref('feet-push',8,15),ref('lunge',8,12,true)],[ref('lateral',12,20,true),{...ref('overhead',12,20),sets:2}]),B:make([ref('band-push',8,15),ref('split',8,12,true)],[ref('lateral',12,20,true),{...ref('fly',12,20),sets:2}])},
      pull:{A:make([ref('pull',4,10),ref('rdl',10,15)],[ref('row',8,15),ref('curl',10,20)],120),B:make([ref('row',8,15),ref('rdl',10,15)],[ref('pull',4,10),ref('hammer',10,20)],120)}
    }};
    for(const v of ['A','B'])d.days.push[v].support.rounds=3;
    return d;
  }
  HOME_CATALOG.push(home('band-push','弹力带抗阻俯卧撑','弹力带','胸','弹力带绕过上背，两端压稳在手掌下；选择可控阻力，身体保持直线。','warmup/push-up.gif'));
  const TIMED_CATALOG=[
    {...home('prepare','热身活动','计时','热身','轻松活动关节，再用主动作低难度试做。'),timerType:'timer'},
    {...home('tabata','Tabata / 间歇','计时','间歇','按设定工作、休息时间交替完成动作。'),timerType:'interval'}
  ];
  function catalog(extra=[],custom=[]){return [...HOME_CATALOG,...TIMED_CATALOG,...extra,...custom];}
  function groupName(index){return `第${['一','二','三','四','五','六','七','八','九','十'][index]||index+1}组`;}
  function toGroups(plan){
    const next=clone(plan);
    for(const day of dayKeys(next))for(const variant of ['A','B']){
      const p=next.days[day][variant];if(Array.isArray(p.groups))continue;
      const groups=[];
      if(p.warmupEnabled)groups.push({id:'warmup',rounds:1,restSeconds:0,exercises:[{exerciseId:'prepare',seconds:p.warmupSeconds,cue:''}]});
      for(const id of ['main','support'])groups.push({id,...clone(p[id])});
      if(p.tabataEnabled)groups.push({id:'challenge',rounds:1,restSeconds:0,optional:true,exercises:[{exerciseId:'tabata',interval:clone(p.tabata),cue:''}]});
      next.days[day][variant]={groups};
    }return next;
  }
  function groupDefaults(mode='threeDay'){
    const plan=toGroups(defaults(mode));
    if(mode==='fourDay')return plan;
    plan.label='增肌质量优先 · 推拉腿 A/B';
    const group=(id,rounds,restSeconds,exercises)=>({id,rounds,restSeconds,exercises});
    const dose=(id,min,max,perSide=false,rir=2,cue='')=>({...ref(id,min,max,perSide,rir),cue});
    const warmup=(seconds,cue)=>group('warmup',1,30,[{exerciseId:'prepare',seconds,cue}]);
    const pushWarmup=()=>warmup(180,'活动肩、肘、腕，再用低难度俯卧撑递增试做1–2组，不接近力竭。');
    const pullWarmup=()=>warmup(180,'活动肩肘，做轻量肩胛引体和轻角度划船，再试做首个主动作，不接近力竭。');
    const legWarmup=()=>warmup(240,'活动踝、膝、髋，徒手试做分腿蹲与髋铰链，再逐步试到工作阻力，不接近力竭。');
    const lateral=()=>dose('lateral',12,20,true,2);
    const bandCue='弹力带绕过上背，两端压稳；选择能在目标次数内保留约2次余力的阻力，全程控制。';
    const strength={
      push:{
        A:[pushWarmup(),group('main',3,150,[dose('feet-push',6,12)]),group('secondary',2,120,[dose('band-push',10,15,false,2,bandCue)]),group('support',4,90,[lateral(),{...dose('triceps',10,20),sets:3}])],
        B:[pushWarmup(),group('main',3,150,[dose('band-push',6,12,false,2,bandCue)]),group('secondary',2,120,[dose('feet-push',8,15)]),group('support',4,90,[lateral(),{...dose('overhead',10,20),sets:3}])]
      },
      pull:{
        A:[pullWarmup(),group('main',3,180,[dose('pull',5,8)]),group('secondary',3,150,[dose('row',8,15)]),group('support',3,90,[dose('face',12,20,false,3),dose('curl',10,15)])],
        B:[pullWarmup(),group('main',3,180,[dose('wide-row',8,15)]),group('secondary',3,150,[dose('chin',5,8)]),group('support',3,90,[dose('fly',12,20,false,3),dose('hammer',10,15)])]
      },
      legs:{
        A:[legWarmup(),group('main',4,150,[dose('split',8,12,true,2,'弹力带分腿蹲：双脚前后着地站稳，前脚踩稳弹力带，两手握带增加阻力；TRX仅在需要时辅助平衡，不悬挂后脚。')]),group('secondary',3,120,[dose('rdl',10,15,false,2,'弹力带双腿RDL：双脚踩稳弹力带、握住两端，膝微屈，臀向后推；背部中立，靠髋伸展站起。')]),group('support',3,90,[dose('calf',10,20,true),{...dose('wheel',6,10),sets:2}])],
        B:[legWarmup(),group('main',4,150,[dose('lunge',8,12,true,2,'弹力带反向弓步：前脚踩稳弹力带，两手握带增加阻力；向后落步，前脚全脚掌稳定，膝盖顺脚尖方向移动。')]),group('secondary',3,90,[dose('leg-curl',10,20)]),group('support',3,90,[dose('bent-calf',12,20,true),{...dose('pallof',8,12,true),sets:2}])]
      }
    };
    for(const day of dayKeys(plan))for(const variant of ['A','B']){
      const challenge=plan.days[day][variant].groups.find(g=>g.id==='challenge');
      if(challenge)Object.assign(challenge.exercises[0].interval,Tabata.randomSettings());
      plan.days[day][variant].groups=[...strength[day][variant],...(challenge?[challenge]:[])];
    }
    return plan;
  }
  function newExercise(id,items){
    const c=items.find(x=>x.id===id);
    if(c?.timerType==='timer')return {exerciseId:id,seconds:180,cue:''};
    if(c?.timerType==='interval')return {exerciseId:id,interval:{work:20,rest:10,rounds:6,actions:['低冲击开合步','站姿交替提膝'],...Tabata.randomSettings()},cue:''};
    return {exerciseId:id,repMin:8,repMax:12,perSide:false,rir:2,cue:''};
  }
  function migrateGroups(state){
    let changed=false;
    const convert=p=>{if(!p||dayKeys(p).every(d=>['A','B'].every(v=>Array.isArray(p.days?.[d]?.[v]?.groups))))return p;changed=true;return toGroups(p);};
    state.active=convert(state.active);state.draft=convert(state.draft);
    for(const key of ['programs','drafts'])if(state[key])for(const mode of Object.keys(state[key]))state[key][mode]=convert(state[key][mode]);
    if(changed)state.revision=(Number(state.revision)||1)+1;
    return changed;
  }
  function validateGroups(p,prefix,map){
    const errors=[],int=(n,a,b)=>Number.isInteger(n)&&n>=a&&n<=b;
    if(!Array.isArray(p.groups)||p.groups.length<1||p.groups.length>50)return [`${prefix}需1–50个动作组。`];
    const ids=new Set();
    p.groups.forEach((s,i)=>{
      const label=prefix+groupName(i);
      if(!s||typeof s.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(s.id)||s.id==='finish'||ids.has(s.id)){errors.push(`${label}标识无效或重复。`);return;}ids.add(s.id);
      if(!int(s.rounds,1,20)||!int(s.restSeconds,0,600)||s.optional!=null&&typeof s.optional!=='boolean')errors.push(`${label}轮数需1–20，休息需0–600秒。`);
      if(!Array.isArray(s.exercises)||!s.exercises.length||s.exercises.length>8){errors.push(`${label}至少需要1个动作，最多8个。`);return;}
      const seen=new Set();
      for(const ex of s.exercises){
        const c=map.get(ex?.exerciseId);if(!c){errors.push(`${label}动作不存在。`);continue;}
        if(seen.has(ex.exerciseId))errors.push(`${label}同一动作不能重复，请增加轮数或放入另一组。`);seen.add(ex.exerciseId);
        if(typeof ex.cue!=='string'||ex.cue.length>600)errors.push(`${label}动作要领最多600字。`);
        if(ex.sets!=null&&!int(ex.sets,1,s.rounds))errors.push(`${label}动作执行轮数需在1至本组轮数之间。`);
        if(c.timerType==='timer'){if(!int(ex.seconds,5,3600))errors.push(`${label}计时时长需5–3600秒。`);}
        else if(c.timerType==='interval'){
          const t=ex.interval;if(!t||!int(t.work,5,300)||!int(t.rest,0,300)||!int(t.rounds,1,60)||!Array.isArray(t.actions)||t.actions.length<1||t.actions.length>8||t.actions.some(a=>typeof a!=='string'||!a.trim()||a.length>60))errors.push(`${label}Tabata参数或动作名称不合法。`);
          else {const error=Tabata.validate(t);if(error)errors.push(label+error);}
        }else if(!int(ex.repMin,1,100)||!int(ex.repMax,ex.repMin,100)||!int(ex.rir,0,3)||typeof ex.perSide!=='boolean')errors.push(`${label}次数或RIR不合法。`);
      }
      if(s.exercises.every(ex=>ex.sets!=null&&ex.sets<s.rounds))errors.push(`${label}至少一个动作需完成本组全部轮次。`);
    });return errors;
  }
  function compileGroups(p,map){return p.groups.map((s,i)=>({
    ...clone(s),title:`${groupName(i)} · ${s.rounds}轮`,label:groupName(i),grouped:true,mode:'rounds',required:s.rounds,intensity:false,
    note:`本组动作依次完成，每轮后休息${s.restSeconds}秒`,
    exercises:s.exercises.map(x=>{
      const c=map.get(x.exerciseId),base={...clone(x),id:c.id,name:c.name,displayName:c.custom?escape(c.displayName):undefined,focus:escape(c.focus),manualResistance:!c.timerType&&!HOME_CATALOG.some(h=>h.id===c.id)};
      if(c.timerType==='timer')return {...base,timer:x.seconds,detail:escape(x.cue||c.cue)};
      if(c.timerType==='interval'){const t=x.interval;return {...base,timer:(t.work+t.rest)*t.rounds,intervalPlan:{...clone(t),actions:t.actions.map(escape)},detail:`${t.work}秒动作 / ${t.rest}秒休息，共${t.rounds}轮。${escape(x.cue||c.cue)}`};}
      return {...base,detail:`${x.perSide?'每侧':''}${x.repMin}–${x.repMax}次 · 目标RIR ${x.rir}。${escape(x.cue||c.cue)}`};
    })
  }));}
  function validate(plan,items){
    const errors=[],map=new Map(items.map(x=>[x.id,x])),int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
    if(!plan||plan.schema!==1||typeof plan.label!=='string'||!plan.label.trim()||plan.label.length>80)return ['计划名称不能为空，最多80字。'];
    if(plan.schedule!=null&&!Object.hasOwn(SCHEDULES,plan.schedule))return ['训练安排无效。'];
    for(const day of dayKeys(plan))for(const variant of ['A','B']){
      const p=plan.days?.[day]?.[variant],prefix=`${{push:'推',pull:'拉',legs:'腿'}[day]}${variant}`;
      if(!p){errors.push(`${prefix}缺少配置。`);continue;}
      if(p.groups!==undefined){errors.push(...validateGroups(p,prefix,map));continue;}
      if(typeof p.warmupEnabled!=='boolean'||!int(p.warmupSeconds,30,600))errors.push(`${prefix}热身需30–600秒。`);
      const seen=new Set();
      for(const key of ['main','support']){
        const s=p[key];if(!s||!int(s.rounds,1,6)||!int(s.restSeconds,15,300)){errors.push(`${prefix}轮数需1–6，休息需15–300秒。`);continue;}
        if(!Array.isArray(s.exercises)||!s.exercises.length||s.exercises.length>8){errors.push(`${prefix}每关卡需1–8个动作。`);continue;}
        for(const ex of s.exercises){
          if(!map.has(ex.exerciseId))errors.push(`${prefix}动作不存在。`);
          if(seen.has(ex.exerciseId))errors.push(`${prefix}同一动作请只放在一个位置，避免重复记录。`);seen.add(ex.exerciseId);
          if(!int(ex.repMin,1,100)||!int(ex.repMax,ex.repMin,100)||!int(ex.rir,0,3)||typeof ex.perSide!=='boolean'||typeof ex.cue!=='string'||ex.cue.length>600)errors.push(`${prefix}次数、RIR或动作要领不合法。`);
          if(ex.sets!=null&&!int(ex.sets,1,s.rounds))errors.push(`${prefix}动作组数需在1至本关轮数之间。`);
        }
        if(s.exercises.every(ex=>ex.sets!=null&&ex.sets<s.rounds))errors.push(`${prefix}至少一个动作需要完成本关全部轮次。`);
      }
      const t=p.tabata;if(typeof p.tabataEnabled!=='boolean'||!t||!int(t.work,10,60)||!int(t.rest,5,60)||!int(t.rounds,1,12)||!Array.isArray(t.actions)||t.actions.length!==2||t.actions.some(x=>typeof x!=='string'||!x.trim()||x.length>60))errors.push(`${prefix}间歇参数或动作名称不合法。`);
    }return [...new Set(errors)];
  }
  function compile(plan,items){
    const errors=validate(plan,items);if(errors.length)throw new Error(errors.join('\n'));
    const map=new Map(items.map(x=>[x.id,x])),result={};
    for(const day of dayKeys(plan)){
      const mode=schedule(plan),title=mode==='fourDay'?SCHEDULES.fourDay.names[day]:{push:'推力塑形',pull:'背部塑形',legs:'臀腿与核心'}[day];
      result[day]={name:title,schedule:mode,subtitle:SCHEDULES[mode].label+' · 肩背优先 · 按实际训练量安排时间',variantTitle:'A / B 动作轮换',variantDesc:{A:'A版 · '+escape(plan.label),B:'B版 · '+escape(plan.label)},common:[]};
      for(const v of ['A','B']){
        const p=plan.days[day][v],sections=[];
        if(p.groups){result[day][v]=compileGroups(p,map);continue;}
        if(p.warmupEnabled)sections.push({id:'warmup',title:`热身 · ${p.warmupSeconds}秒`,note:'轻松活动；不练到疲劳',mode:'single',exercises:[{id:'prepare',name:'训练前活动',displayName:'训练前活动',detail:day==='legs'?'原地走动、髋铰链练习、轻松弓步，逐渐提高体温。':'原地走动、肩绕环、轻阻力拉开，再用主动作轻松试做。',timer:p.warmupSeconds}]});
        for(const key of ['main','support']){
          const s=p[key];sections.push({id:key,title:`${v}版${key==='main'?'主关卡':'补强'} · ${s.rounds}轮`,note:`全部动作依次完成后休息${s.restSeconds}秒`,mode:'rounds',rounds:s.rounds,required:s.rounds,restSeconds:s.restSeconds,intensity:key==='main',exercises:s.exercises.map(x=>{const c=map.get(x.exerciseId);return {...clone(x),id:c.id,name:c.name,displayName:c.custom?escape(c.displayName):undefined,focus:escape(c.focus),detail:`${x.perSide?'每侧':''}${x.repMin}–${x.repMax}次 · 目标RIR ${x.rir}。${escape(x.cue||c.cue)}`,manualResistance:!HOME_CATALOG.some(h=>h.id===c.id)};})});
        }
        if(p.tabataEnabled){const t=p.tabata;sections.push({id:'challenge',title:`可选间歇 · ${(t.work+t.rest)*t.rounds}秒`,note:'达到40分钟参考时长或恢复不足时可跳过',mode:'single',optional:true,exercises:[{id:'tabata',name:`${escape(t.actions[0])} + ${escape(t.actions[1])}`,detail:`${t.work}秒动作 / ${t.rest}秒休息，共${t.rounds}轮。动作保持可控，是否完成由你决定。`,timer:(t.work+t.rest)*t.rounds,intervalPlan:{work:t.work,rest:t.rest,rounds:t.rounds,actions:t.actions.map(escape)}}]});}
        result[day][v]=sections;
      }
    }return result;
  }
  function groupSummary(p,map){
    let sets=0,seconds=0,optionalSeconds=0;
    for(const s of p.groups){
      let time=s.rounds*s.restSeconds;
      for(const ex of s.exercises){const n=setCount(s,ex),type=map.get(ex.exerciseId)?.timerType;
        if(!type)sets+=n;
        time+=n*(type==='timer'?ex.seconds:type==='interval'?(ex.interval.work+ex.interval.rest)*ex.interval.rounds:((ex.repMin+ex.repMax)/2)*3*(ex.perSide?2:1)+10);
      }
      if(s.optional)optionalSeconds+=time;else seconds+=time;
    }
    return {sets,minutes:Math.round(seconds/60),tabataMinutes:Math.round(optionalSeconds/6)/10,names:p.groups.flatMap(s=>s.exercises.map(x=>map.get(x.exerciseId)?.displayName||map.get(x.exerciseId)?.name||'未知动作'))};
  }
  function summary(plan,items){const map=new Map(items.map(x=>[x.id,x]));return dayKeys(plan).flatMap(day=>['A','B'].map(v=>{const p=plan.days[day][v];if(p.groups)return {day,variant:v,...groupSummary(p,map)};let sets=0,work=0,rest=0;for(const k of ['main','support']){const s=p[k];sets+=s.exercises.reduce((n,x)=>n+setCount(s,x),0);work+=s.exercises.reduce((n,x)=>n+setCount(s,x)*(((x.repMin+x.repMax)/2)*3*(x.perSide?2:1)+10),0);rest+=Math.max(0,s.rounds-1)*s.restSeconds;}rest+=p.main.restSeconds;const seconds=(p.warmupEnabled?p.warmupSeconds:0)+work+rest;return{day,variant:v,sets,minutes:Math.round(seconds/60),tabataMinutes:p.tabataEnabled?Math.round((p.tabata.work+p.tabata.rest)*p.tabata.rounds/6)/10:0,names:['main','support'].flatMap(k=>p[k].exercises.map(x=>map.get(x.exerciseId)?.displayName||map.get(x.exerciseId)?.name||'未知动作'))};}));}
  function migrateRearDeltToPushB(state){
    if(state.rearDeltMovedToPushB===true)return false;
    const matches=(ex,id,min,max,rir)=>ex?.exerciseId===id&&ex.repMin===min&&ex.repMax===max&&ex.rir===rir&&ex.perSide===false&&!ex.cue;
    function move(plan){
      const push=plan?.days?.push?.B?.support,pull=plan?.days?.pull?.B?.support;
      if(push?.rounds!==2||pull?.rounds!==2||!Array.isArray(push.exercises)||!Array.isArray(pull.exercises))return false;
      if(push.exercises.length!==2||pull.exercises.length!==3||
        !matches(push.exercises[0],'press',8,12,2)||!matches(push.exercises[1],'overhead',10,15,2)||
        !matches(pull.exercises[0],'pulldown',10,15,2)||!matches(pull.exercises[1],'fly',12,18,3)||!matches(pull.exercises[2],'hammer',10,15,2))return false;
      push.exercises[0]=pull.exercises.splice(1,1)[0];
      return true;
    }
    const activeChanged=move(state.active);
    move(state.draft);
    if(activeChanged)state.revision=(Number(state.revision)||1)+1;
    state.rearDeltMovedToPushB=true;
    return true;
  }
  function read(raw,items){try{
    const s=JSON.parse(raw);if(s?.schema!==1||!Array.isArray(s.custom)||s.custom.length>100)return null;
    const seen=new Set();
    for(const c of s.custom){
      if(!/^custom-[a-f\d-]{36}$/i.test(c.id)||c.name!==c.id||c.custom!==true||seen.has(c.id)||c.gif)return null;
      seen.add(c.id);
      for(const [key,max] of [['displayName',80],['equipment',30],['focus',40],['cue',600]])if(typeof c[key]!=='string'||!c[key].trim()||c[key].length>max)return null;
    }
    const all=catalog(items,s.custom);if(validate(s.active,all).length)return null;
    const draftShape=p=>p&&dayKeys(p).every(d=>['A','B'].every(v=>{const x=p.days?.[d]?.[v];return Array.isArray(x?.groups)?x.groups.every(g=>g&&typeof g.id==='string'&&Array.isArray(g.exercises)):['main','support'].every(k=>Array.isArray(x?.[k]?.exercises))&&x.tabata?.actions?.length===2;}));
    if(s.draft&&!draftShape(s.draft))s.draft=null;
    for(const key of ['programs','drafts'])if(s[key]){
      if(typeof s[key]!=='object'||Array.isArray(s[key]))delete s[key];
      else for(const [mode,p] of Object.entries(s[key]))if(!Object.hasOwn(SCHEDULES,mode)||schedule(p)!==mode||(key==='programs'?validate(p,all).length:!draftShape(p)))delete s[key][mode];
    }
    return s;
  }catch{return null;}}
  function migrateLegLateralToPushOnly(state){
    if(state.legLateralRemoved===true)return false;
    let changed=false;
    const plans=new Set([state.active,state.draft,state.programs?.threeDay,state.drafts?.threeDay]);
    for(const plan of plans){
      if(!plan||schedule(plan)!=='threeDay')continue;
      for(const variant of ['A','B']){
        const section=plan.days?.legs?.[variant]?.support;
        if(!Array.isArray(section?.exercises)||section.exercises.length<2)continue;
        const remaining=section.exercises.filter(ex=>!(ex.exerciseId==='lateral'&&ex.repMin===12&&ex.repMax===18&&ex.perSide===true&&ex.rir===3&&!ex.cue));
        if(!remaining.length||remaining.length===section.exercises.length||remaining.every(ex=>ex.sets!=null&&ex.sets<section.rounds))continue;
        section.exercises=remaining;changed=true;
      }
    }
    if(changed)state.revision=(Number(state.revision)||1)+1;
    state.legLateralRemoved=true;
    return true;
  }
  return {KEY,clone,escape,HOME_CATALOG,TIMED_CATALOG,SCHEDULES,TABATA:Tabata,schedule,dayKeys,weeklySlot,exercisesForRound,setCount,defaults,groupDefaults,toGroups,groupName,newExercise,migrateGroups,catalog,validate,compile,summary,migrateRearDeltToPushB,migrateLegLateralToPushOnly,read};
});
