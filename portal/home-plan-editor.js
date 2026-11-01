(function(root){
  'use strict';
  const M=root.HomePlan,E=M.escape,T=M.TABATA;
  root.HomePlanEditor={mount(options){
    const dialog=document.createElement('dialog');dialog.className='home-plan-dialog';dialog.setAttribute('aria-labelledby','hp-title');document.body.append(dialog);
    let draft,custom,day='push',variant='A',view='edit',picker=null,query='',equipment='',message='',savedTimer;
    const names=()=>M.SCHEDULES[M.schedule(draft)].names;
    const items=()=>M.catalog(root.HOME_EXTRA_EXERCISES||[],custom);
    const display=c=>c.displayName||c.name;
    const field=(label,path,value,min,max)=>`<label>${label}<input data-path="${path}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${E(value)}"></label>`;
    function persist(){clearTimeout(savedTimer);try{options.saveDraft(M.clone(draft),M.clone(custom));return true;}catch{message="本机存储失败，草稿仍在编辑器中，请勿关闭页面。";const node=dialog.querySelector(".hp-message");if(node)node.textContent=message;return false;}}
    function open(){const s=options.getState();draft=M.toGroups(s.draft||s.active);custom=M.clone(s.custom||[]);day=M.dayKeys(draft).includes(day)?day:'push';view='edit';picker=null;message='';render();dialog.showModal();}
    function close(){if(!persist())return;dialog.close();document.getElementById('openHomeEditor')?.focus();}
    function heading(){return `<header class="hp-header"><div><span class="hp-eyebrow">HOME WORKOUT · A / B</span><h2 id="hp-title">${picker?'选择动作':view==='preview'?'预览整套计划':'编辑居家计划'}</h2></div><button type="button" class="hp-icon" data-action="close" aria-label="关闭计划编辑">×</button></header>`;}
    function render(){
      dialog.innerHTML=heading()+`<div class="hp-content">${picker?pickerHtml():view==='preview'?previewHtml():editorHtml()}</div><footer class="hp-footer"><p role="status" class="hp-message">${E(message|| (options.isTraining()?'当前训练保留原计划；应用后下次生效。':'草稿自动保存；预览后应用到训练页。'))}</p>${picker?'<button type="button" data-action="back">返回编辑</button>':view==='preview'?'<button type="button" data-action="edit">返回修改</button><button type="button" class="hp-primary" data-action="apply">应用计划</button>':'<button type="button" data-action="restore">恢复默认模板</button><button type="button" class="hp-primary" data-action="preview">预览计划</button>'}</footer>`;
    }
    function editorHtml(){
      const p=draft.days[day][variant];
      return `<div class="hp-intro"><strong>肩背优先，按你的器械调整</strong><p>当前生效：${E(options.getState().active.label)} · 以下编辑为草稿</p><p>默认使用TRX、弹力带、引体杆和健腹轮。动作库也提供哑铃等选项；替换动作后，原动作的历史记录仍保留。</p></div><nav class="hp-schedules" aria-label="训练安排">${Object.entries(M.SCHEDULES).map(([mode,config])=>`<button type="button" data-schedule="${mode}" aria-pressed="${M.schedule(draft)===mode}">${config.label}</button>`).join('')}</nav><p class="hp-hint">两套安排分别保存；预览并应用后才切换生效，历史记录共用训练日历。</p><label class="hp-plan-name">计划名称<input data-path="label" value="${E(draft.label)}" maxlength="80"></label><nav class="hp-days" aria-label="训练日">${Object.entries(names()).map(([k,n])=>`<button type="button" data-day="${k}" aria-pressed="${k===day}">${n}</button>`).join('')}</nav><div class="hp-variants" aria-label="计划版本">${['A','B'].map(v=>`<button type="button" data-variant="${v}" aria-pressed="${variant===v}">${v}版</button>`).join('')}<span>${M.SCHEDULES[M.schedule(draft)].sequence}</span></div>${p.groups.map((g,i)=>phaseHtml(i)).join('')}<button type="button" class="hp-add" data-action="add-group" ${p.groups.length>=50?'disabled':''}>＋ 添加动作组</button>`;
    }
    function phaseHtml(index){
      const s=draft.days[day][variant].groups[index],key=`groups.${index}`,map=new Map(items().map(c=>[c.id,c]));
      return `<section class="hp-phase" data-group-index="${index}"><div class="hp-phase-head"><h3>${M.groupName(index)}</h3><div class="hp-row-actions"><button type="button" data-action="group-up" data-phase="${index}" ${index===0?'disabled':''} aria-label="上移动作组">↑</button><button type="button" data-action="group-down" data-phase="${index}" ${index===draft.days[day][variant].groups.length-1?'disabled':''} aria-label="下移动作组">↓</button><button type="button" data-action="group-remove" data-phase="${index}" ${draft.days[day][variant].groups.length===1?'disabled':''}>删除本组</button></div></div><div class="hp-settings">${field('轮数',key+'.rounds',s.rounds,1,20)}${field('每轮后休息（秒）',key+'.restSeconds',s.restSeconds,0,600)}<label class="hp-toggle"><input type="checkbox" data-path="${key}.optional" ${s.optional?'checked':''}>本组可跳过</label></div><p class="hp-hint">每轮依次完成本组全部动作后统一休息；本组结束也按此设置休息。至少保留一个动作。</p><div class="hp-exercises">${s.exercises.map((ex,i)=>{
        const c=map.get(ex.exerciseId),path=`${key}.exercises.${i}`;
        const dose=c?.timerType==='timer'?field('计时时长（秒）',path+'.seconds',ex.seconds,5,3600):c?.timerType==='interval'?`${field('工作（秒）',path+'.interval.work',ex.interval.work,5,300)}${field('间歇休息（秒）',path+'.interval.rest',ex.interval.rest,0,300)}${field('间歇轮数',path+'.interval.rounds',ex.interval.rounds,1,60)}${intervalOptions(ex,path,index,i)}`:`${field('次数下限',path+'.repMin',ex.repMin,1,100)}${field('次数上限',path+'.repMax',ex.repMax,1,100)}${field('目标RIR（3=3+）',path+'.rir',ex.rir,0,3)}<label class="hp-toggle"><input type="checkbox" data-path="${path}.perSide" ${ex.perSide?'checked':''}>每侧</label>`;
        return `<article class="hp-exercise"><div class="hp-exercise-head"><span class="hp-index">${i+1}</span><div><strong>${E(c?display(c):'动作不存在')}</strong><span>${E(c?.equipment)} · ${E(c?.focus)}</span></div><div class="hp-row-actions"><button type="button" data-action="up" data-phase="${index}" data-index="${i}" ${i===0?'disabled':''} aria-label="上移动作">↑</button><button type="button" data-action="down" data-phase="${index}" data-index="${i}" ${i===s.exercises.length-1?'disabled':''} aria-label="下移动作">↓</button><button type="button" data-action="split" data-phase="${index}" data-index="${i}" ${s.exercises.length===1||draft.days[day][variant].groups.length>=50?'disabled':''}>单独成组</button><button type="button" data-action="replace" data-phase="${index}" data-index="${i}">替换</button><button type="button" data-action="remove" data-phase="${index}" data-index="${i}" ${s.exercises.length===1?'disabled':''}>删除</button></div></div><div class="hp-dose">${field('执行轮数',path+'.sets',ex.sets??s.rounds,1,s.rounds)}${dose}</div><label class="hp-cue">动作要领 / 阻力备注<textarea data-path="${path}.cue" maxlength="600" placeholder="${E(c?.cue)}">${E(ex.cue)}</textarea></label></article>`;
      }).join('')}</div><button type="button" class="hp-add" data-action="add" data-phase="${index}" ${s.exercises.length>=8?'disabled':''}>＋ 自选动作（含热身、Tabata）</button></section>`;
    }
    function intervalOptions(ex,path,phase,index){
      const t=ex.interval,random=t.mode==='random',tags=t.excludedTags??T.DEFAULT_EXCLUDES,ids=t.excludedIds??[];
      return `<div class="hp-tabata-options"><label>动作来源<select data-path="${path}.interval.mode"><option value="fixed" ${!random?'selected':''}>固定动作</option><option value="random" ${random?'selected':''}>随机抽取两个动作</option></select></label>${random?`<p class="hp-hint">进入本组时抽取两个不同动作，同次训练固定。当前候选池：${T.pool(t).length}项。</p><div class="hp-tabata-tags">${Object.entries(T.TAGS).map(([tag,label])=>`<label><input type="checkbox" data-tabata-tag="${tag}" data-tabata-phase="${phase}" data-tabata-index="${index}" ${tags.includes(tag)?'checked':''}>排除${label}</label>`).join('')}</div><details><summary>选择参与抽取的动作（至少保留两项）</summary><div class="hp-tabata-library">${T.LIBRARY.map(a=>`<label><input type="checkbox" data-tabata-id="${a.id}" data-tabata-phase="${phase}" data-tabata-index="${index}" ${!ids.includes(a.id)?'checked':''}><span><strong>${E(a.name)}${a.tags.length?' · '+a.tags.map(tag=>E(T.TAGS[tag])).join('/'):' · 低冲击'}</strong><small>${E(a.cue)}</small></span></label>`).join('')}</div></details>`:t.actions.map((name,n)=>`<label>间歇动作${n+1}<input data-path="${path}.interval.actions.${n}" maxlength="60" value="${E(name)}"></label>`).join('')}</div>`;
    }
    function pickerHtml(){const all=items(),filtered=all.filter(c=>(!equipment||c.equipment===equipment)&&`${display(c)} ${c.equipment} ${c.focus}`.toLowerCase().includes(query.toLowerCase()));return `<div class="hp-picker-tools"><label>搜索动作<input id="hp-search" type="search" placeholder="搜索名称、部位、器械" value="${E(query)}"></label><label>器械<select id="hp-equipment"><option value="">全部器械</option>${[...new Set(all.map(x=>x.equipment))].map(x=>`<option ${x===equipment?'selected':''}>${E(x)}</option>`).join('')}</select></label></div><div class="hp-picker-results" aria-live="polite">${resultsHtml(filtered)}</div><details class="hp-custom"><summary>＋ 创建自定义动作</summary><div class="hp-custom-form"><label>动作名称<input data-custom="displayName" maxlength="80" placeholder="例如：单臂哑铃划船"></label><div class="hp-settings"><label>器械<input data-custom="equipment" maxlength="30" placeholder="例如：哑铃"></label><label>目标部位<input data-custom="focus" maxlength="40" placeholder="例如：背部"></label></div><label>动作要领<textarea data-custom="cue" maxlength="600" placeholder="填写动作要领与阻力备注"></textarea></label><button type="button" data-action="custom" class="hp-primary">创建并选用</button><p class="hp-hint">自定义动作记录次数和RIR，阻力由你调整，不自动生成升级路线。</p></div></details>`;}
    function resultsHtml(rows){return rows.length?rows.map(c=>`<button type="button" class="hp-choice" data-select="${E(c.id)}"><div><strong>${E(display(c))}</strong><span>${E(c.equipment)} · ${E(c.focus)}</span></div><span>选择 →</span></button>`).join(''):'<p class="hp-empty">没有匹配动作。试试其他关键词，或创建自己的动作。</p>';}
    function previewHtml(){
      const errors=M.validate(draft,items()),map=new Map(items().map(c=>[c.id,c]));
      return `<div class="hp-intro"><strong>${E(draft.label)}</strong><p>按动作组顺序训练；每轮完成全部动作后统一休息。时间含每组最后一轮休息，实际取决于节奏。</p></div>${errors.length?`<div class="hp-errors" role="alert">${errors.map(E).join('<br>')}</div>`:''}<div class="hp-preview-grid">${M.summary(draft,items()).map(row=>`<article class="hp-preview"><div class="hp-phase-head"><h3>${names()[row.day]} · ${row.variant}</h3><strong>${row.sets}个力量工作组</strong></div><p class="hp-preview-time">必做约${row.minutes}分钟${row.tabataMinutes?` · 可选组+${row.tabataMinutes}分钟`:''}</p>${draft.days[row.day][row.variant].groups.map((g,i)=>`<div class="hp-preview-phase"><strong>${M.groupName(i)} · ${g.rounds}轮 / 休${g.restSeconds}秒${g.optional?' · 可跳过':''}</strong><ul>${g.exercises.map(ex=>{const c=map.get(ex.exerciseId);return `<li>${E(c?display(c):'未知动作')}<span>${ex.sets??g.rounds}轮 · ${c?.timerType==='timer'?ex.seconds+'秒':c?.timerType==='interval'?`${ex.interval.work}秒练/${ex.interval.rest}秒休 × ${ex.interval.rounds}轮 · ${ex.interval.mode==='random'?'随机抽2项（候选'+T.pool(ex.interval).length+'项）':ex.interval.actions.map(E).join('＋')}`:`${ex.perSide?'每侧':''}${ex.repMin}–${ex.repMax}次 · RIR ${ex.rir}`}</span></li>`;}).join('')}</ul></div>`).join('')}</article>`).join('')}</div>`;
    }
    function select(id){
      const c=items().find(x=>x.id===id);if(!c||!picker)return;
      const groups=draft.days[day][variant].groups;
      if(picker.newGroup)groups.push({id:'group-'+crypto.randomUUID(),rounds:1,restSeconds:90,exercises:[M.newExercise(id,items())]});
      else {const g=groups[picker.phase];if(g.exercises.some((x,i)=>x.exerciseId===id&&i!==picker.index)){message='本组已有该动作，可增加轮数或放到另一组。';dialog.querySelector('.hp-message').textContent=message;return;}
        const ex=M.newExercise(id,items());
        if(picker.index!=null){const previous=g.exercises[picker.index],old=items().find(x=>x.id===previous.exerciseId);g.exercises[picker.index]=old?.timerType===c.timerType?{...previous,exerciseId:id,cue:''}:{...ex,...(previous.sets!=null?{sets:previous.sets}:{})};}
        else g.exercises.push(ex);
      }
      picker=null;message='动作已加入草稿，请检查轮数、次数或计时设置。';persist();render();
    }
    dialog.addEventListener('input',event=>{
      const el=event.target;
      if(el.id==='hp-search'){query=el.value;dialog.querySelector('.hp-picker-results').innerHTML=resultsHtml(items().filter(c=>(!equipment||c.equipment===equipment)&&`${display(c)} ${c.equipment} ${c.focus}`.toLowerCase().includes(query.toLowerCase())));return;}
      if(!el.dataset.path)return;const path=el.dataset.path.split('.'),obj=path[0]==='label'?draft:draft.days[day][variant];let target=obj;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;clearTimeout(savedTimer);savedTimer=setTimeout(persist,250);
    });
    dialog.addEventListener('change',event=>{
      if(event.target.id==='hp-equipment'){equipment=event.target.value;render();}
      else if(event.target.dataset.tabataTag||event.target.dataset.tabataId){
        const el=event.target,t=draft.days[day][variant].groups[Number(el.dataset.tabataPhase)].exercises[Number(el.dataset.tabataIndex)].interval;
        if(el.dataset.tabataTag){const tags=new Set(t.excludedTags??T.DEFAULT_EXCLUDES);if(el.checked)tags.add(el.dataset.tabataTag);else tags.delete(el.dataset.tabataTag);t.excludedTags=[...tags];}
        else {const ids=new Set(t.excludedIds??[]);if(el.checked)ids.delete(el.dataset.tabataId);else ids.add(el.dataset.tabataId);t.excludedIds=[...ids];}
        message=T.validate(t)||'候选池已更新，进入本组时抽取两项。';persist();render();
      }
      else if(event.target.dataset.path){
        const match=event.target.dataset.path.match(/^groups\.(\d+)\.rounds$/);
        if(match){const index=Number(match[1]),g=draft.days[day][variant].groups[index];
          g.exercises.forEach((ex,i)=>{if(ex.sets!=null&&ex.sets>g.rounds)ex.sets=g.rounds;const input=dialog.querySelector(`[data-path="groups.${index}.exercises.${i}.sets"]`);if(input){input.max=g.rounds;input.value=ex.sets??g.rounds;}});
        }
        persist();if(event.target.dataset.path.endsWith('.interval.mode')){message='';render();}
      }
    });
    dialog.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.dataset.day){day=b.dataset.day;render();return;}if(b.dataset.variant){variant=b.dataset.variant;render();return;}if(b.dataset.select){select(b.dataset.select);return;}
      if(b.dataset.schedule){
        if(!persist())return;
        const state=options.getState(),mode=b.dataset.schedule;
        draft=M.toGroups(state.drafts?.[mode]||state.programs?.[mode]||(M.schedule(state.active)===mode?state.active:M.groupDefaults(mode)));
        day='push';variant='A';view='edit';picker=null;message='已切换编辑安排；预览应用后生效。';persist();render();return;
      }
      const action=b.dataset.action,groups=draft.days[day][variant].groups,groupIndex=Number(b.dataset.phase),s=groups[groupIndex],index=Number(b.dataset.index);
      if(action==='close'){close();return;}
      if(action==='add-group'){picker={newGroup:true};query='';equipment='';render();dialog.querySelector('#hp-search')?.focus();return;}
      if(action==='group-remove'){if(groups.length<2)return;groups.splice(groupIndex,1);persist();render();return;}
      if(action==='group-up'||action==='group-down'){const to=groupIndex+(action==='group-up'?-1:1);if(to<0||to>=groups.length)return;[groups[groupIndex],groups[to]]=[groups[to],groups[groupIndex]];persist();render();return;}
      if(action==='split'){
        if(s.exercises.length<2||groups.length>=50)return;const ex=s.exercises.splice(index,1)[0],rounds=ex.sets??s.rounds;delete ex.sets;
        groups.splice(groupIndex+1,0,{id:'group-'+crypto.randomUUID(),rounds,restSeconds:s.restSeconds,exercises:[ex]});
        s.rounds=Math.min(s.rounds,Math.max(...s.exercises.map(x=>x.sets??s.rounds)));persist();render();return;
      }
      if(action==='add'||action==='replace'){picker={phase:b.dataset.phase,index:action==='replace'?index:null};query='';equipment='';render();dialog.querySelector('#hp-search')?.focus();return;}
      if(action==='remove'){if(s.exercises.length<2)return;s.exercises.splice(index,1);s.rounds=Math.min(s.rounds,Math.max(...s.exercises.map(x=>x.sets??s.rounds)));persist();render();return;}
      if(action==='up'||action==='down'){const to=index+(action==='up'?-1:1);[s.exercises[index],s.exercises[to]]=[s.exercises[to],s.exercises[index]];persist();render();return;}
      if(action==='back'){picker=null;render();return;}
      if(action==='edit'){view='edit';render();return;}
      if(action==='restore'){if(!confirm('将草稿恢复为居家默认模板？当前生效计划和历史记录不变，预览应用后才生效。'))return;draft=M.groupDefaults(M.schedule(draft));message='默认模板已放入草稿。';persist();render();return;}
      if(action==='preview'){if(!persist())return;const errors=M.validate(draft,items());if(errors.length){message=errors[0];render();return;}view='preview';message='确认每个训练日和A/B版本，再应用。';render();return;}
      if(action==='apply'){const errors=M.validate(draft,items());if(errors.length){message=errors[0];render();return;}try{options.apply(M.clone(draft),M.clone(custom));}catch{message="保存失败，请检查本机存储后重试。";render();return;}message=options.isTraining()?'已应用，下次训练生效。':'计划已应用。';render();return;}
      if(action==='custom'){
        const values=Object.fromEntries([...dialog.querySelectorAll('[data-custom]')].map(el=>[el.dataset.custom,el.value.trim()]));if(!values.displayName||!values.equipment||!values.focus||!values.cue){message='请填写自定义动作的名称、器械、部位与要领。';dialog.querySelector('.hp-message').textContent=message;return;}
        if(custom.length>=100){dialog.querySelector('.hp-message').textContent='最多保存100个自定义动作。';return;}
        const id='custom-'+crypto.randomUUID();custom.push({...values,id,name:id,custom:true,gif:''});select(id);
      }
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});document.getElementById('openHomeEditor').addEventListener('click',open);
    return {open};
  }};
})(globalThis);
