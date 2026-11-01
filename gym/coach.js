import { api, attachPrivateImages, escapeHtml, formatDate, jsonBody, revokeRenderedImages } from './api.js';
import { createSetSaveQueue } from '/portal/shared/set-save-queue.js';

const SECTIONS = [['students','学员与邀请'],['plans','训练计划'],['sessions','训练记录'],['measurements','身体数据'],['photos','学员照片'],['suggestions','进阶建议']];
const RIR_OPTIONS = [0,1,2,3,4,5];
const EXERCISE_SPLITS = [['ppl_push','推'],['ppl_pull','拉'],['ppl_legs','腿'],['upper_lower_upper','上下肢·上肢'],['upper_lower_lower','上下肢·下肢'],['five_chest','五分化·胸'],['five_back','五分化·背'],['five_legs','五分化·腿'],['five_shoulders','五分化·肩'],['five_arms','五分化·手臂']];
const PLAN_SPLIT_LABELS = { ppl: '推拉腿', upper_lower: '上下肢', five_day: '五分化', custom: '自定义计划' };

export async function renderCoach({ state, root, notify, rerender }) {
  const section = state.coachSection || 'students';
  root.innerHTML = `<div class="section-heading"><div><p class="eyebrow">COACH DESK</p><h2>教练工作台</h2></div></div>
    <nav class="subnav" aria-label="教练工作台菜单">${SECTIONS.map(([id,label])=>`<button class="subtab${section===id?' active':''}" type="button" data-coach-section="${id}">${label}</button>`).join('')}</nav>
    <div id="coachSectionContent"></div>`;
  root.querySelectorAll('[data-coach-section]').forEach((button)=>button.addEventListener('click',()=>{state.coachSection=button.dataset.coachSection; renderCoach({state,root,notify,rerender});}));
  const content = root.querySelector('#coachSectionContent');
  if (section === 'students') return renderStudents({state,content,notify,rerender});
  if (!state.coachStudentId && section !== 'suggestions') {
    content.innerHTML = '<div class="empty-state">先在“学员与邀请”中选择一位学员。</div>';
    return;
  }
  if (section === 'plans') return renderPlans({state,content,notify});
  if (section === 'sessions') return renderSessions({state,content,notify});
  if (section === 'measurements') return renderMeasurements({state,content,notify});
  if (section === 'photos') return renderStudentPhotos({state,content,notify});
  return renderSuggestions({state,content,notify});
}

async function loadStudents() {
  const data = await api('/api/coach/students');
  return data.students;
}

async function renderStudents({ state, content, notify, rerender }) {
  content.innerHTML = `<div class="split-heading"><div><h3>我的学员</h3><p class="panel-intro">当前账号只能查看自己名下的有效学员。先建立邀请关系，再为学员创建计划。</p></div></div>
    <section class="coach-capacity-card" id="coachCapacitySummary"><div class="empty-state">正在读取学员名额…</div></section>
    <div class="coach-invite-tools"><button class="button primary" id="createInvite" type="button" disabled>查看 / 复制当前邀请链接</button><div id="newInvite"></div></div>
    <div class="data-list" id="studentList"><div class="empty-state">正在读取学员…</div></div>
    <h3 class="section-title">邀请记录</h3><div class="data-list" id="invitationList"><div class="empty-state">正在读取…</div></div>`;
  try {
    const [students, invitationData] = await Promise.all([loadStudents(), api('/api/coach/invitations')]);
    state.coachStudents = students;
    const capacityView = window.GymCapacityView.getCoachCapacityView({
      activeStudents: invitationData.coachCapacity?.activeStudents,
      maxStudents: invitationData.coachCapacity?.maxStudents,
      encryptionConfigured: invitationData.encryptionConfigured,
    });
    const capacityLabels = {
      key_missing: ['邀请链接暂不可用', '系统尚未配置邀请加密密钥，请联系总管理员。'],
      unconfigured: ['尚未设置学员上限', '请联系总管理员为你的账号分配教练等级或单独设置上限。'],
      full: ['学员名额已满', '当前关系会保留；结束一段学员关系后即可释放名额。'],
      ready: ['可以邀请新学员', '可复制当前链接；每位新学员注册或绑定后，邀请码会自动轮换。'],
    }[capacityView.status];
    content.querySelector('#coachCapacitySummary').innerHTML = `<div><strong>${capacityLabels[0]}</strong><span>当前 ${capacityView.activeStudents} / ${capacityView.maxStudents ?? '未配置'} 人 · 剩余 ${capacityView.remaining} 个名额</span></div><small>${capacityLabels[1]}</small>`;
    const createButton = content.querySelector('#createInvite');
    createButton.disabled = !capacityView.canInvite;
    createButton.addEventListener('click', showCurrentInvitation);
    content.querySelector('#studentList').innerHTML = students.length ? students.map((student)=>`<article class="data-row"><div class="data-main"><strong>${escapeHtml(student.username)}</strong><small>关联于 ${formatDate(student.createdAt)}</small></div><div class="actions"><button class="button primary small" type="button" data-open-student="${student.id}">打开学员</button><button class="button danger small" type="button" data-end-student="${student.id}">结束关系</button></div></article>`).join('') : '<div class="empty-state">暂无学员。生成邀请链接后发给对方即可。</div>';
    content.querySelectorAll('[data-open-student]').forEach((button)=>button.addEventListener('click',()=>{
      state.coachStudentId=Number(button.dataset.openStudent); state.coachSection='plans'; rerender();
    }));
    content.querySelectorAll('[data-end-student]').forEach((button)=>button.addEventListener('click',async()=>{
      if(!confirm('结束后你将不能查看该学员的后续信息；未完成的训练草稿会自动放弃，已完成历史仍保留在学员账号中。继续？'))return;
      try{await api(`/api/coach/students/${button.dataset.endStudent}/end`,{method:'POST'});notify('教练关系已结束。');await renderStudents({state,content,notify,rerender});}
      catch{notify('结束关系失败。');}
    }));
    drawInvitationHistory(invitationData.invitations);
  } catch {
    content.querySelector('#studentList').innerHTML='<div class="empty-state">学员与邀请读取失败。</div>';
    content.querySelector('#coachCapacitySummary').innerHTML='<div class="empty-state">名额信息暂不可用，请稍后刷新。</div>';
  }

  async function showCurrentInvitation() {
    try {
      const result=await api('/api/coach/invitations/current',{method:'POST',body:jsonBody({validDays:7})});
      displayInvitation(result.invitation);
      notify('当前邀请链接已准备好。');
    } catch (error) { notify(invitationErrorMessage(error.message)); }
  }

  function displayInvitation(invitation) {
    const url=`${location.origin}${window.PortalRoutes.buildPortalUrl('/gym/',invitation.token)}`;
    content.querySelector('#newInvite').innerHTML=`<div class="code-box invite-code-box"><div><small>当前一次性邀请 · 到期 ${escapeHtml(formatDate(invitation.expiresAt,true))}</small><code>${escapeHtml(url)}</code></div></div><div class="actions invite-actions"><button class="button small" id="copyInvite" type="button">复制链接</button><button class="button small" id="replaceInvite" type="button">更换链接</button><button class="button danger small" id="revokeCurrentInvite" type="button">撤销链接</button></div>`;
    content.querySelector('#copyInvite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);notify('邀请链接已复制。');}catch{notify('复制失败，请手动复制。');}});
    content.querySelector('#replaceInvite').addEventListener('click',async()=>{
      if(!confirm('更换后，之前发出的链接会立即失效。确定更换？'))return;
      try{const result=await api('/api/coach/invitations/current/replace',{method:'POST',body:jsonBody({validDays:7})});displayInvitation(result.invitation);notify('邀请链接已更换。');await loadInvitationHistory();}
      catch(error){notify(invitationErrorMessage(error.message));}
    });
    content.querySelector('#revokeCurrentInvite').addEventListener('click',async()=>{
      if(!confirm('撤销后，之前发出的链接会立即失效。确定撤销？'))return;
      try{await api(`/api/coach/invitations/${invitation.id}`,{method:'DELETE'});content.querySelector('#newInvite').innerHTML='';notify('邀请链接已撤销。');await loadInvitationHistory();}
      catch(error){notify(invitationErrorMessage(error.message));}
    });
  }

  async function loadInvitationHistory() {
    try {
      const result=await api('/api/coach/invitations');
      drawInvitationHistory(result.invitations);
    } catch { notify('邀请记录刷新失败。'); }
  }

  function drawInvitationHistory(invitations) {
    const list=content.querySelector('#invitationList');
    list.innerHTML=invitations.length?invitations.map((invite)=>{
      const expired=invite.expiresAt&&new Date(invite.expiresAt)<new Date();
      const status=invite.revokedAt?'已撤销':invite.acceptedAt?`已接受 · ${escapeHtml(invite.acceptedUsername||'')}`:expired?'已过期':invite.isCurrent?'当前邀请':'等待接受';
      return `<article class="data-row"><div class="data-main"><strong>${status}</strong><small>创建 ${formatDate(invite.createdAt,true)} · 到期 ${formatDate(invite.expiresAt,true)}</small></div>${!invite.acceptedAt&&!invite.revokedAt?`<div class="actions"><button class="button danger small" type="button" data-revoke-invite="${invite.id}">撤销</button></div>`:''}</article>`;
    }).join(''):'<div class="empty-state">还没有发出的邀请。</div>';
    list.querySelectorAll('[data-revoke-invite]').forEach((button)=>button.addEventListener('click',async()=>{
      if(!confirm('撤销后邀请链接立即失效。继续？'))return;
      try{await api(`/api/coach/invitations/${button.dataset.revokeInvite}`,{method:'DELETE'});notify('邀请已撤销。');await renderStudents({state,content,notify,rerender});}
      catch{notify('撤销邀请失败。');}
    }));
  }
}

function invitationErrorMessage(code) {
  return ({
    invite_encryption_not_configured:'邀请功能尚未配置加密密钥。',
    coach_capacity_unconfigured:'请联系总管理员设置你的学员名额。',
    coach_capacity_full:'学员名额已满，结束一段关系后可再次邀请。',
    coach_role_inactive:'教练资格当前不可用。',
  })[code] || '邀请操作失败，请稍后重试。';
}

async function renderPlans({state,content,notify}) {
  const studentId=state.coachStudentId;
  content.innerHTML=`<div class="split-heading"><div><h3>学员训练计划</h3><p class="panel-intro">可从推拉腿、上下肢或五分化模板新建，也可自由安排 1–7 个训练日；发布后形成只读版本快照。</p></div><button class="button small" id="backStudents" type="button">选择其他学员</button></div>
    <div class="toolbar"><label class="field-label">训练计划<select id="templateSelect" class="field-input"><option value="">读取模板…</option></select></label><button class="button primary" id="createPlan" type="button">新建草稿</button></div>
    <div class="plan-workspace"><aside class="plan-list" id="planList"><div class="empty-state">正在读取计划…</div></aside><section id="planEditorPane" class="plan-editor-pane"><div class="empty-state">选择现有计划或从模板创建草稿。</div></section></div>`;
  content.querySelector('#backStudents').addEventListener('click',()=>{state.coachSection='students';state.coachStudentId=null;notify('已返回学员列表。');document.querySelector('[data-coach-section="students"]')?.click();});
  const [templates, planData, catalog] = await Promise.all([
    api('/api/gym/templates'), api(`/api/coach/students/${studentId}/plans`), api('/api/gym/exercises'),
  ]).catch(()=>[null,null,null]);
  if(!templates||!planData||!catalog){content.querySelector('#planList').innerHTML='<div class="empty-state">计划或动作库读取失败。</div>';return;}
  state.coachTemplates=templates.templates;
  state.coachCatalog=catalog.exercises;
  state.coachPlanItems=planData.plans;
  content.querySelector('#templateSelect').innerHTML='<option value="">请选择模板或计划类型</option>'+templates.templates.map((t)=>`<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)}</option>`).join('')+'<option value="__custom__">自定义计划（自由安排训练日）</option>';
  content.querySelector('#createPlan').addEventListener('click',async()=>{
    const templateCode=content.querySelector('#templateSelect').value;
    if(!templateCode)return notify('先选择一种分化模板或自定义计划。');
    const body=templateCode==='__custom__'
      ?{splitType:'custom',name:'自定义计划',content:{days:[{name:'训练日 1',focus:'',exerciseFilterTag:'all',exercises:[]}]}}
      :{templateCode};
    try{const result=await api(`/api/coach/students/${studentId}/plans`,{method:'POST',body:jsonBody(body)});notify('已创建计划草稿。');await reload();selectPlan(result.plan.id);}
    catch(error){notify(error.message==='draft_plan_exists'?'该学员已有一个未发布草稿，请先完成或放弃它。':error.message==='exercise_not_available'?'模板中有动作尚未启用，暂不能创建。':'创建草稿失败。');}
  });
  await reload();
  if(state.selectedPlanId && state.coachPlanItems.some((p)=>p.id===state.selectedPlanId)) selectPlan(state.selectedPlanId);
  else if(state.coachPlanItems.length) selectPlan(state.coachPlanItems.find((p)=>p.status==='active')?.id||state.coachPlanItems[0].id);

  async function reload(){
    const result=await api(`/api/coach/students/${studentId}/plans`);
    state.coachPlanItems=result.plans;
    const list=content.querySelector('#planList');
    list.innerHTML=result.plans.length?result.plans.map((plan)=>`<button type="button" class="plan-select${plan.id===state.selectedPlanId?' active':''}" data-plan-id="${plan.id}"><strong>${escapeHtml(plan.name)}</strong><span>${escapeHtml(PLAN_SPLIT_LABELS[plan.splitType]||plan.splitType)} · ${escapeHtml({active:'已发布',draft:'草稿',archived:'历史版本'}[plan.status])}</span><small>版本 ${plan.version?.versionNo||'—'}${plan.version?.status==='draft'?' · 有待发布修改':''}</small></button>`).join(''):'<div class="empty-state">还没有计划，先从上方选择模板或新建自定义计划。</div>';
    list.querySelectorAll('[data-plan-id]').forEach((button)=>button.addEventListener('click',()=>selectPlan(button.dataset.planId)));
  }

  function selectPlan(id){
    const plan=state.coachPlanItems.find((item)=>String(item.id)===String(id));
    if(!plan)return;
    state.selectedPlanId=String(id);
    content.querySelectorAll('[data-plan-id]').forEach((button)=>button.classList.toggle('active',button.dataset.planId===String(id)));
    const pane=content.querySelector('#planEditorPane');
    if(!plan.version?.content){pane.innerHTML='<div class="empty-state">该计划还没有内容。</div>';return;}
    if(plan.status==='archived'){pane.innerHTML=`<div class="callout">${escapeHtml(plan.name)} 是历史计划，只读查看。</div>${renderPlanSummary(plan.version.content)}`;return;}
    pane.innerHTML=renderPlanEditor(plan,state.coachCatalog);
    const form=pane.querySelector('#planForm');
    const search=pane.querySelector('#exerciseSearch');
    search.querySelector('[data-run-exercise-search]').addEventListener('click',drawExerciseSearch);
    search.querySelectorAll('input,select').forEach((input)=>{
      input.addEventListener('input',drawExerciseSearch);
      input.addEventListener('change',drawExerciseSearch);
    });
    drawExerciseSearch();
    form.addEventListener('click',(event)=>{
      const addDayButton=event.target.closest('[data-add-training-day]');
      if(addDayButton){
        const days=[...form.querySelectorAll('[data-day-index]')];
        if(days.length>=7){notify('自定义计划最多安排 7 个训练日。');return;}
        const index=days.length;
        form.querySelector('[data-custom-days]').insertAdjacentHTML('beforeend',renderPlanDayEditor({name:`训练日 ${index+1}`,focus:'',exerciseFilterTag:'all',exercises:[]},index,plan,state.coachCatalog));
        syncCustomDayControls(form);
        drawExerciseSearch();
        return;
      }
      const removeDayButton=event.target.closest('[data-remove-training-day]');
      if(removeDayButton){
        const days=[...form.querySelectorAll('[data-day-index]')];
        if(days.length<=1){notify('自定义计划至少保留 1 个训练日。');return;}
        removeDayButton.closest('[data-day-index]').remove();
        [...form.querySelectorAll('[data-day-index]')].forEach((day,index)=>{day.dataset.dayIndex=String(index);});
        syncCustomDayControls(form);
        drawExerciseSearch();
        return;
      }
      const addExerciseButton=event.target.closest('[data-add-exercise]');
      if(addExerciseButton){
        const day=addExerciseButton.closest('[data-day-index]');
        const list=day.querySelector('[data-exercise-list]');
        if(form.querySelectorAll('[data-exercise-card]').length>=60){notify('整份计划最多添加 60 个动作。');return;}
        if(list.querySelectorAll('[data-exercise-card]').length>=20){notify('每个训练日最多添加 20 个动作。');return;}
        list.insertAdjacentHTML('beforeend',exerciseEditorRow({sets:3,repMin:8,repMax:12,rir:2,restSeconds:90},state.coachCatalog,day.querySelector('[data-exercise-filter]').value));
        bindEditorRows(pane);
        return;
      }
      const button=event.target.closest('[data-add-found-exercise]');
      if(!button)return;
      const slug=button.dataset.addFoundExercise;
      const dayIndex=Number(button.closest('.exercise-search-result').querySelector('[data-result-day]').value);
      const day=[...form.querySelectorAll('[data-day-index]')].find((item)=>Number(item.dataset.dayIndex)===dayIndex);
      const exercise=state.coachCatalog.find((item)=>item.slug===slug);
      if(!day||!exercise)return;
      if([...day.querySelectorAll('[data-exercise-slug]')].some((select)=>select.value===slug)){
        notify('这个训练日已添加该动作。');
        return;
      }
      const list=day.querySelector('[data-exercise-list]');
      if(form.querySelectorAll('[data-exercise-card]').length>=60){notify('整份计划最多添加 60 个动作。');return;}
      if(list.querySelectorAll('[data-exercise-card]').length>=20){notify('每个训练日最多添加 20 个动作。');return;}
      list.insertAdjacentHTML('beforeend',exerciseEditorRow({exerciseSlug:slug,sets:3,repMin:8,repMax:12,rir:2,restSeconds:90},state.coachCatalog,day.querySelector('[data-exercise-filter]').value));
      bindEditorRows(pane);
      notify(`已将“${exercise.nameZh}”加入第 ${dayIndex+1} 天。`);
    });
    form.addEventListener('change',(event)=>{
      const select=event.target.closest('[data-exercise-filter]');
      if(!select)return;
      const day=select.closest('[data-day-index]');
      day.querySelectorAll('[data-exercise-slug]').forEach((exerciseSelect)=>{
        const selectedSlug=exerciseSelect.value;
        exerciseSelect.innerHTML=exerciseOptionsMarkup(state.coachCatalog,select.value,selectedSlug);
        exerciseSelect.value=selectedSlug;
      });
    });
    form.addEventListener('input',(event)=>{
      if(event.target.matches('[data-day-name]'))drawExerciseSearch();
    });
    bindEditorRows(pane);
    syncCustomDayControls(form);
    function drawExerciseSearch(){
      const query=search.querySelector('[name="q"]').value.trim().toLowerCase();
      const muscle=search.querySelector('[name="muscle"]').value.trim().toLowerCase();
      const split=search.querySelector('[name="split"]').value;
      const splitResults=split?window.PlanExerciseFilter.filterExercises(state.coachCatalog,split):state.coachCatalog;
      const results=splitResults.filter((item)=>(!query||`${item.nameZh} ${item.nameEn||''} ${item.slug}`.toLowerCase().includes(query))&&(!muscle||`${item.primaryMuscle} ${item.primaryMuscleZh}`.toLowerCase().includes(muscle))).slice(0,50);
      const host=pane.querySelector('#exerciseSearchResults');
      host.innerHTML=results.length?results.map((exercise)=>`<article class="exercise-search-result"><div><strong>${escapeHtml(exercise.nameZh)}</strong><small>${escapeHtml(exercise.primaryMuscleZh)} · ${escapeHtml(exercise.equipmentZh)}</small><small>${escapeHtml(exercise.cueZh)}</small></div><div class="actions"><select class="field-input" data-result-day>${[...form.querySelectorAll('[data-day-index]')].map((day,index)=>`<option value="${index}">第 ${index+1} 天 · ${escapeHtml(day.querySelector('[data-day-name]').value||`训练日 ${index+1}`)}</option>`).join('')}</select><button class="button small" type="button" data-add-found-exercise="${escapeHtml(exercise.slug)}">添加</button></div></article>`).join(''):'<div class="empty-state">没有匹配动作。</div>';
    }
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      try{
        const planContent=readPlanForm(form);
        const saved=await api(`/api/coach/plans/${id}/draft`,{method:'PUT',body:jsonBody({name:form.elements.planName.value.trim(),content:planContent})});
        notify('草稿已保存。');
        await reload();
        const item=state.coachPlanItems.find((p)=>p.id===id);
        if(item)item.version=saved.plan.version;
        selectPlan(id);
      }catch(error){notify(error.message==='exercise_not_available'?'有动作已停用，请替换后再保存。':error.message==='too_many_exercises'?'整份计划最多 60 个动作。':error.message==='duplicate_exercise_in_day'?'每个训练日不能重复添加同一动作。':'计划未保存，请检查动作、组数、次数和 RIR。');}
    });
    pane.querySelector('#publishPlan').addEventListener('click',async()=>{
      if(!confirm('发布后学员的后续训练将使用新版本；已完成或已开始的训练不会改变。继续？'))return;
      try{
        const planContent=readPlanForm(form);
        await api(`/api/coach/plans/${id}/draft`,{method:'PUT',body:jsonBody({name:form.elements.planName.value.trim(),content:planContent})});
        await api(`/api/coach/plans/${id}/publish`,{method:'POST',body:'{}'});
        notify('计划版本已发布。');
        await reload();
        selectPlan(id);
      }catch(error){notify(error.message==='empty_training_day'?'每个训练日都需要至少一个动作。':error.message==='finish_plan_draft_first'?'请先完成其他未发布草稿。':error.message==='too_many_exercises'?'整份计划最多 60 个动作。':error.message==='duplicate_exercise_in_day'?'每个训练日不能重复添加同一动作。':'发布失败；请检查计划内容。');}
    });
  }

  function bindEditorRows(pane){
    pane.querySelectorAll('[data-remove-exercise]').forEach((button)=>{if(button.dataset.bound)return;button.dataset.bound='1';button.addEventListener('click',()=>button.closest('[data-exercise-card]').remove());});
    pane.querySelectorAll('[data-move]').forEach((button)=>{if(button.dataset.bound)return;button.dataset.bound='1';button.addEventListener('click',()=>{const card=button.closest('[data-exercise-card]');if(button.dataset.move==='up'&&card.previousElementSibling)card.parentElement.insertBefore(card,card.previousElementSibling);if(button.dataset.move==='down'&&card.nextElementSibling)card.parentElement.insertBefore(card.nextElementSibling,card);});});
  }
}

function renderPlanSummary(content){
  return `<div class="plan-days">${content.days.map((day)=>`<article class="plan-day-card"><h4>第${day.dayNo}天 · ${escapeHtml(day.name)}</h4><p>${escapeHtml(day.focus||'')}</p>${day.exercises.map((e)=>`<div class="plan-summary-exercise"><strong>${escapeHtml(e.exerciseNameZh||e.exerciseSlug)}</strong><span>${e.sets}组 · ${e.repMin}-${e.repMax}次 · RIR ${e.rir}</span></div>`).join('')}</article>`).join('')}</div>`;
}

function renderPlanEditor(plan,catalog){
  const content=plan.version.content;
  const custom=plan.splitType==='custom';
  return `<form class="plan-form" id="planForm">
    <div class="split-heading"><div><h3>${escapeHtml(plan.name)}</h3><p class="inline-message">${plan.status==='active'?'当前学员使用版本':'尚未发布'} · ${plan.version.status==='draft'?'当前编辑草稿':'从模板/已发布版本建立'}</p></div><div class="actions"><button class="button" type="submit">保存草稿</button><button class="button primary" type="button" id="publishPlan">发布版本</button></div></div>
    <label class="field-label">计划名称<input name="planName" class="field-input" maxlength="100" value="${escapeHtml(plan.name)}" required></label>
    <details class="exercise-browser"><summary>动作库查找：按名称、肌群与训练分化筛选</summary>
      <div class="toolbar" id="exerciseSearch"><label class="field-label">动作名称<input class="field-input" name="q" placeholder="例如卧推、划船"></label><label class="field-label">肌群<input class="field-input" name="muscle" placeholder="中文或 muscle ID"></label><label class="field-label">分化<select class="field-input" name="split"><option value="">全部动作（含核心）</option>${EXERCISE_SPLITS.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><button class="button small" type="button" data-run-exercise-search>查找</button></div>
      <div id="exerciseSearchResults" class="exercise-search-results"></div></details>
    <div class="custom-plan-days" data-custom-days>${content.days.map((day,index)=>renderPlanDayEditor(day,index,plan,catalog)).join('')}</div>
    ${custom?'<button class="button" type="button" data-add-training-day>＋ 新增训练日</button>':''}
  </form>`;
}

function renderPlanDayEditor(day,index,plan,catalog){
  const filterTag=day.exerciseFilterTag||window.PlanExerciseFilter.defaultFilterTag(plan.splitType,index);
  return `<article class="plan-day-editor" data-day-index="${index}"><div class="form-grid"><label>训练日名称<input class="field-input" data-day-name value="${escapeHtml(day.name)}" maxlength="50"></label><label>训练重点<input class="field-input" data-day-focus value="${escapeHtml(day.focus||'')}" maxlength="120"></label><label>动作筛选范围<select class="field-input" data-exercise-filter>${exerciseFilterOptions(filterTag)}</select></label></div><div class="exercise-editor-list" data-exercise-list>${day.exercises.map((item)=>exerciseEditorRow(item,catalog,filterTag)).join('')}</div><div class="actions"><button class="button small" data-add-exercise type="button">＋ 添加动作</button>${plan.splitType==='custom'?'<button class="button danger small" data-remove-training-day type="button">移除训练日</button>':''}</div></article>`;
}

function exerciseFilterOptions(selected){
  return `<option value="all" ${selected==='all'?'selected':''}>全部动作（含腹部）</option>${EXERCISE_SPLITS.map(([key,label])=>`<option value="${key}" ${selected===key?'selected':''}>${label}</option>`).join('')}`;
}

function exerciseOptionsMarkup(catalog,filterTag,selectedSlug){
  const options=window.PlanExerciseFilter.optionsForSelection(catalog,filterTag,selectedSlug);
  return `<option value="">选择动作</option>${options.map(({exercise,outsideFilter})=>`<option value="${escapeHtml(exercise.slug)}" ${exercise.slug===selectedSlug?'selected':''}>${escapeHtml(exercise.nameZh)} · ${escapeHtml(exercise.primaryMuscleZh)}${outsideFilter?'（已选，当前筛选外）':''}</option>`).join('')}`;
}

function exerciseEditorRow(item,catalog,filterTag='all'){
  const options=exerciseOptionsMarkup(catalog,filterTag,item.exerciseSlug);
  return `<div class="exercise-plan-row" data-exercise-card><div class="exercise-plan-select"><label class="field-label">动作<select class="field-input" data-exercise-slug>${options}</select></label><div class="row-actions"><button class="icon-button" type="button" data-move="up" aria-label="上移">↑</button><button class="icon-button" type="button" data-move="down" aria-label="下移">↓</button><button class="icon-button danger-icon" type="button" data-remove-exercise aria-label="移除">×</button></div></div><div class="form-grid compact-grid"><label>组数<input class="field-input" type="number" min="1" max="10" data-sets value="${item.sets??3}"></label><label>次数下限<input class="field-input" type="number" min="1" max="100" data-rep-min value="${item.repMin??8}"></label><label>次数上限<input class="field-input" type="number" min="1" max="100" data-rep-max value="${item.repMax??12}"></label><label>目标 RIR<input class="field-input" type="number" min="0" max="5" data-rir value="${item.rir??2}"></label><label>目标重量 kg<input class="field-input" type="number" min="0" max="1000" step="0.25" data-weight value="${item.targetWeight??''}"></label><label>休息秒<input class="field-input" type="number" min="0" max="600" data-rest value="${item.restSeconds??90}"></label></div><label class="field-label">动作备注<input class="field-input" data-exercise-note maxlength="300" value="${escapeHtml(item.note||'')}"></label></div>`;
}

function syncCustomDayControls(form){
  const days=form.querySelectorAll('[data-day-index]');
  const add=form.querySelector('[data-add-training-day]');
  if(add){add.disabled=days.length>=7;add.textContent=`＋ 新增训练日（${days.length}/7）`;}
  form.querySelectorAll('[data-remove-training-day]').forEach((button)=>{button.disabled=days.length<=1;});
}

function readPlanForm(form){
  return {days:[...form.querySelectorAll('[data-day-index]')].map((day)=>({name:day.querySelector('[data-day-name]').value.trim(),focus:day.querySelector('[data-day-focus]').value.trim(),exerciseFilterTag:day.querySelector('[data-exercise-filter]')?.value||'all',exercises:[...day.querySelectorAll('[data-exercise-card]')].map((card)=>({
    exerciseSlug:card.querySelector('[data-exercise-slug]').value,sets:Number(card.querySelector('[data-sets]').value),repMin:Number(card.querySelector('[data-rep-min]').value),repMax:Number(card.querySelector('[data-rep-max]').value),rir:Number(card.querySelector('[data-rir]').value),restSeconds:Number(card.querySelector('[data-rest]').value),targetWeight:card.querySelector('[data-weight]').value===''?null:Number(card.querySelector('[data-weight]').value),note:card.querySelector('[data-exercise-note]').value,
  }))}))};
}

async function renderSessions({state,content,notify}){
  const studentId=state.coachStudentId;
  content.innerHTML=`<div class="split-heading"><div><h3>逐组训练记录</h3><p class="panel-intro">按发布计划开始训练；每组记录重量、次数和 RIR，输入后自动保存，放弃草稿不影响已完成历史。</p></div></div><div id="sessionStart" class="panel-subsection"><div class="empty-state">正在读取当前计划…</div></div><h3 class="section-title">训练历史与未完成草稿</h3><div id="sessionHistory" class="data-list"><div class="empty-state">正在读取…</div></div><div id="sessionDetail"></div>`;
  try{
    const [activePlan, history]=await Promise.all([api(`/api/coach/students/${studentId}/plan`),api(`/api/coach/students/${studentId}/sessions`)]);
    state.currentActivePlan=activePlan.plan;
    const days=activePlan.plan?.version?.content?.days||[];
    content.querySelector('#sessionStart').innerHTML=days.length?`<div class="toolbar"><label class="field-label">训练日<select class="field-input" id="sessionDay">${days.map((day)=>`<option value="${day.dayNo}">第${day.dayNo}天 · ${escapeHtml(day.name)}</option>`).join('')}</select></label><button class="button primary" type="button" id="startSession">开始记录训练</button></div><p class="inline-message">使用当前已发布计划版本；开始后动作和目标将按快照固定。</p>`:'<div class="empty-state">该学员还没有已发布计划。</div>';
    content.querySelector('#startSession')?.addEventListener('click',async()=>{
      try{const result=await api(`/api/coach/students/${studentId}/sessions/start`,{method:'POST',body:jsonBody({dayNo:Number(content.querySelector('#sessionDay').value)})});notify('训练草稿已开始。');await loadHistory();await showSession(result.session.id);}
      catch(error){notify(error.message==='open_session_exists'?'学员已有未完成训练，请从下方恢复。':'开始训练失败；请确认计划仍有效。');await loadHistory();}
    });
    await loadHistory(history.sessions);
  }catch{content.querySelector('#sessionStart').innerHTML='<div class="empty-state">训练数据读取失败。</div>';}

  async function loadHistory(prefetched){
    const sessions=prefetched||(await api(`/api/coach/students/${studentId}/sessions`)).sessions;
    const list=content.querySelector('#sessionHistory');
    list.innerHTML=sessions.length?sessions.map((session)=>`<article class="data-row"><div class="data-main"><strong>${escapeHtml(session.day_name)} · ${escapeHtml({draft:'未完成草稿',completed:'已完成',abandoned:'已放弃'}[session.status]||session.status)}</strong><small>${formatDate(session.started_at,true)}${session.duration_seconds!=null?` · ${Math.round(session.duration_seconds/60)} 分钟`:''}</small></div><div class="actions">${session.status==='draft'?`<button class="button primary small" type="button" data-resume-session="${session.id}">恢复草稿</button><button class="button danger small" type="button" data-abandon-session="${session.id}">放弃</button>`:`<button class="button small" type="button" data-view-session="${session.id}">查看</button>`}</div></article>`).join(''):'<div class="empty-state">还没有训练记录。</div>';
    list.querySelectorAll('[data-resume-session],[data-view-session]').forEach((button)=>button.addEventListener('click',()=>showSession(button.dataset.resumeSession||button.dataset.viewSession)));
    list.querySelectorAll('[data-abandon-session]').forEach((button)=>button.addEventListener('click',async()=>{
      if(!confirm('放弃后只关闭这次草稿，不会删除任何已完成训练。继续？'))return;
      try{await api(`/api/coach/sessions/${button.dataset.abandonSession}/abandon`,{method:'POST',body:'{}'});notify('训练草稿已放弃。');await loadHistory();content.querySelector('#sessionDetail').innerHTML='';}
      catch{notify('放弃训练失败。');}
    }));
  }

  async function showSession(id){
    const result=await api(`/api/coach/sessions/${id}`);
    drawSession(result.session);
  }

  function drawSession(session){
    const panel=content.querySelector('#sessionDetail');
    const saves=createSetSaveQueue((key,body)=>api(`/api/coach/sessions/${session.id}/sets/${key}`,{method:'PATCH',body:jsonBody(body)}));
    panel.innerHTML=`<article class="session-editor"><div class="split-heading"><div><p class="eyebrow">${session.status==='draft'?'DRAFT RECOVERY':'SESSION DETAIL'}</p><h3>${escapeHtml(session.dayName)}</h3></div><strong class="session-clock" data-started-at="${escapeHtml(session.startedAt)}">00:00</strong></div><div class="session-day-focus">${escapeHtml(session.snapshot.focus||'')}</div><div class="session-set-list">${session.sets.map((set)=>renderSetEditor(session,set)).join('')}</div>${session.status==='draft'?`<label class="field-label">训练备注<textarea id="sessionNotes" class="field-input" rows="2">${escapeHtml(session.notes||'')}</textarea></label><div class="actions session-actions"><button class="button danger" type="button" id="abandonCurrent">放弃本次草稿</button><button class="button primary" type="button" id="completeSession">结束并保存训练</button></div><p class="inline-message" id="sessionSaveHint">草稿会随每组输入自动保存。</p>`:`<div class="callout">本次训练已完成 · 实际时长 ${Math.round((session.durationSeconds||0)/60)} 分钟</div>`}${session.suggestions?.length?`<h4>进阶建议</h4>${session.suggestions.map((s)=>`<div class="callout">${escapeHtml(s.exerciseNameZh)}：${escapeHtml(s.suggestion.reason)} 建议目标重量 ${escapeHtml(s.suggestion.targetWeight)} kg。</div>`).join('')}`:''}</article>`;
    if(session.status==='draft'){
      const timer=panel.querySelector('[data-started-at]');
      const started=Date.parse(session.startedAt);
      const tick=()=>{if(!timer?.isConnected)return;const seconds=Math.max(0,Math.floor((Date.now()-started)/1000));timer.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};tick();const timerId=setInterval(()=>{if(!timer?.isConnected)return clearInterval(timerId);tick();},1000);
      const pending=new Map();
      let finishing=false;
      panel.querySelectorAll('[data-session-set]').forEach((form)=>{
        const schedule=()=>{if(finishing)return;const key=`${form.dataset.exerciseIndex}/${form.dataset.setNo}`;clearTimeout(pending.get(key));pending.set(key,setTimeout(()=>{pending.delete(key);saveSet(form);},350));};
        form.querySelectorAll('input,select').forEach((input)=>input.addEventListener('input',schedule));
        form.querySelectorAll('input,select').forEach((input)=>input.addEventListener('change',schedule));
      });
      panel.querySelector('#completeSession').addEventListener('click',async()=>{
        if(finishing)return;
        if(!confirm('结束并保存本次训练？完成记录会保留训练快照。'))return;
        finishing=true;
        pending.forEach((timer)=>clearTimeout(timer));pending.clear();
        const controls=[...panel.querySelectorAll('input,select,textarea,button')];
        controls.forEach((input)=>{input.disabled=true;});
        const button=panel.querySelector('#completeSession');button.textContent='正在保存…';
        try{
          const saved=await Promise.all([...panel.querySelectorAll('[data-session-set]')].map((form)=>saveSet(form)));
          await saves.flush();
          if(saved.some((success)=>!success))throw new Error('finish_or_skip_each_set');
          await api(`/api/coach/sessions/${session.id}/complete`,{method:'POST',body:jsonBody({notes:panel.querySelector('#sessionNotes').value})});
          notify('训练记录已保存。');await loadHistory();await showSession(session.id);
        }catch(error){notify(error.message==='finish_or_skip_each_set'?'请先填写或跳过每一组，且至少完成一组。':'保存未完成，训练仍为草稿；请检查连接后重试。');}
        finally{finishing=false;controls.forEach((input)=>{if(input.isConnected)input.disabled=false;});if(button.isConnected)button.textContent='结束并保存训练';}
      });
      panel.querySelector('#abandonCurrent').addEventListener('click',async()=>{
        if(!confirm('放弃这次草稿？之前已完成的训练记录不会受影响。'))return;
        try{await api(`/api/coach/sessions/${session.id}/abandon`,{method:'POST',body:'{}'});notify('训练草稿已放弃。');panel.innerHTML='';await loadHistory();}
        catch{notify('放弃失败。');}
      });
    }else if(session.status==='completed'){
      panel.querySelectorAll('[data-start-correction]').forEach((button)=>button.addEventListener('click',()=>{
        const form=button.closest('[data-session-set]');
        form.querySelectorAll('input,select').forEach((input)=>input.disabled=false);
        form.insertAdjacentHTML('beforeend','<label class="field-label correction-reason">更正原因（必填）<input class="field-input" data-correction-reason maxlength="300" required></label><button class="button primary small" type="button" data-save-correction>保存更正并留痕</button>');
        button.hidden=true;
        form.querySelector('[data-save-correction]').addEventListener('click',async()=>{
          const reason=form.querySelector('[data-correction-reason]').value.trim();
          if(reason.length<3)return notify('请填写至少 3 个字符的更正原因。');
          const body={status:form.querySelector('[data-set-status]').value,actualWeight:form.querySelector('[data-actual-weight]').value||null,actualReps:form.querySelector('[data-actual-reps]').value||null,actualRir:form.querySelector('[data-actual-rir]').value||null,replacementName:form.querySelector('[data-replacement-name]').value,note:form.querySelector('[data-set-note]').value,reason};
          try{await api(`/api/coach/sessions/${session.id}/sets/${form.dataset.exerciseIndex}/${form.dataset.setNo}/correction`,{method:'PATCH',body:jsonBody(body)});notify('更正已保存并记录审计。');await loadHistory();await showSession(session.id);}
          catch{notify('更正失败；请确认填写完整。');}
        });
      }));
    }
    panel.querySelectorAll('[data-session-set]').forEach((form)=>{
      const status=form.dataset.status;
      form.classList.toggle('set-is-done',status==='completed');
      form.classList.toggle('set-is-skipped',status==='skipped'||status==='replaced');
    });

    async function saveSet(form){
      if(!form.isConnected)return false;
      const status=form.querySelector('[data-set-status]').value;
      const weight=form.querySelector('[data-actual-weight]').value;
      const reps=form.querySelector('[data-actual-reps]').value;
      const rir=form.querySelector('[data-actual-rir]').value;
      const replacementName=form.querySelector('[data-replacement-name]').value;
      if(status==='completed'&&(!reps||rir==='')){const hint=panel.querySelector('#sessionSaveHint');if(hint)hint.textContent='已输入部分内容；补齐次数和 RIR 后会自动保存。';return false;}
      if(status==='replaced'&&!replacementName.trim()){notify('请填写替代动作名称。');return false;}
      const hint=panel.querySelector('#sessionSaveHint');if(hint)hint.textContent='正在保存本组…';
      const key=`${form.dataset.exerciseIndex}/${form.dataset.setNo}`;
      const body={status,actualWeight:weight===''?null:Number(weight),actualReps:reps===''?null:Number(reps),actualRir:rir===''?null:Number(rir),replacementName,note:form.querySelector('[data-set-note]').value};
      try{
        await saves.save(key,body);
        if(!form.isConnected||!saves.isLatest(key,body))return true;
        form.dataset.status=status;form.classList.toggle('set-is-done',status==='completed');form.classList.toggle('set-is-skipped',status==='skipped'||status==='replaced');
        if(hint)hint.textContent=`已自动保存 · ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
        return true;
      }catch{if(hint?.isConnected)hint.textContent='自动保存失败，请检查连接后重试。';return false;}
    }
  }
}

function renderSetEditor(session,set){
  const readonly=session.status!=='draft';
  return `<form class="session-set-card${set.status==='completed'?' set-is-done':''}" data-session-set data-exercise-index="${set.exerciseIndex}" data-set-no="${set.setNo}" data-status="${set.status}"><div class="set-title"><strong>${escapeHtml(set.exerciseNameZh)}</strong><span>第 ${set.setNo} 组 · 目标 ${set.targetRepMin}-${set.targetRepMax} 次 · RIR ${set.targetRir}</span></div><div class="form-grid compact-grid"><label>重量 kg<input class="field-input" type="number" min="0" max="1000" step="0.25" data-actual-weight value="${set.actualWeight??set.targetWeight??''}" ${readonly?'disabled':''}></label><label>实际次数<input class="field-input" type="number" min="0" max="300" data-actual-reps value="${set.actualReps??''}" ${readonly?'disabled':''}></label><label>实际 RIR<select class="field-input" data-actual-rir ${readonly?'disabled':''}><option value="">选择</option>${RIR_OPTIONS.map((v)=>`<option value="${v}" ${set.actualRir===v?'selected':''}>${v}${v===5?'（5+）':''}</option>`).join('')}</select></label><label>记录状态<select class="field-input" data-set-status ${readonly?'disabled':''}>${[['pending','待记录'],['completed','完成'],['skipped','跳过'],['replaced','替换动作']].filter(([value])=>!readonly||value!=='pending').map(([v,l])=>`<option value="${v}" ${set.status===v?'selected':''}>${l}</option>`).join('')}</select></label></div><label class="field-label">替代动作（选择替换时填写）<input class="field-input" data-replacement-name maxlength="100" value="${escapeHtml(set.replacementName||'')}" ${readonly?'disabled':''}></label><label class="field-label">备注<input class="field-input" data-set-note maxlength="300" value="${escapeHtml(set.note||'')}" ${readonly?'disabled':''}></label>${session.status==='completed'?'<button class="button small" type="button" data-start-correction>更正这组记录</button>':''}</form>`;
}

async function renderMeasurements({state,content,notify}){
  const id=state.coachStudentId;
  content.innerHTML=`<div class="split-heading"><div><h3>学员身体记录</h3><p class="panel-intro">初始体重和腰围由教练或学员录入，再由学员本人确认并锁定；后续记录只追加，不覆盖历史。</p></div></div><section id="measurementEntry"></section><div class="data-list" id="measurementHistory"><div class="empty-state">正在读取记录…</div></div>`;
  try{const result=await api(`/api/coach/students/${id}/measurements`);drawMeasurements(result.measurements);}catch{content.querySelector('#measurementHistory').innerHTML='<div class="empty-state">身体记录读取失败。</div>';}
  function drawMeasurements(rows){
    const initial=rows.find((row)=>row.entryType==='initial');
    content.querySelector('#measurementEntry').innerHTML=`<form class="toolbar measurement-form" id="measurementForm"><strong>${initial?'追加身体记录':'录入初始身体记录'}</strong><label class="field-label">体重 kg<input class="field-input" type="number" name="weightKg" min="15" max="500" step="0.1" ${!initial?'required':''}></label><label class="field-label">腰围 cm<input class="field-input" type="number" name="waistCm" min="30" max="300" step="0.1" ${!initial?'required':''}></label><label class="field-label">体脂 %（可选）<input class="field-input" type="number" name="bodyFatPct" min="2" max="70" step="0.1"></label><button class="button primary" type="submit">${initial?'追加记录':'提交待确认初始记录'}</button></form>`;
    content.querySelector('#measurementHistory').innerHTML=rows.length?rows.map((row)=>`<article class="data-row"><div class="data-main"><strong>${row.entryType==='initial'?'初始记录':'后续记录'} · ${formatDate(row.recordedAt,true)}</strong><small>${row.weightKg==null?'':`${row.weightKg} kg`}${row.waistCm==null?'':` · 腰围 ${row.waistCm} cm`}${row.bodyFatPct==null?'':` · 体脂 ${row.bodyFatPct}%`}</small><small>${row.status==='confirmed'?'已确认并锁定':`待学员本人确认 · 录入人 ${row.enteredBy===state.coachStudentId?'学员':'教练'}`}${row.note?` · ${escapeHtml(row.note)}`:''}</small></div></article>`).join(''):'<div class="empty-state">尚无身体数据。</div>';
    content.querySelector('#measurementForm').addEventListener('submit',async(event)=>{
      event.preventDefault();const form=event.currentTarget;const body={weightKg:form.elements.weightKg.value||null,waistCm:form.elements.waistCm.value||null,bodyFatPct:form.elements.bodyFatPct.value||null};
      try{await api(`/api/coach/students/${id}/measurements${initial?'/initial':''}`,{method:'POST',body:jsonBody(body)});notify(initial?'身体记录已提交。':'初始记录已提交，等待学员确认。');form.reset();const newer=await api(`/api/coach/students/${id}/measurements`);drawMeasurements(newer.measurements);}
      catch(error){notify(error.message==='initial_already_exists'?'初始记录已存在。':'保存身体记录失败，请检查数值。');}
    });
  }
}

async function renderStudentPhotos({state,content,notify}){
  const id=state.coachStudentId;
  content.innerHTML=`<div class="split-heading"><div><h3>学员照片</h3><p class="panel-intro">你只能查看学员已审核且主动授权“自己和教练”或“公开”的照片。</p></div></div><div id="coachPhotos" class="photo-grid"><div class="empty-state">正在读取学员照片…</div></div>`;
  const list=content.querySelector('#coachPhotos');
  revokeRenderedImages(list,state);
  try{const {photos}=await api(`/api/coach/students/${id}/photos`);list.innerHTML=photos.length?photos.map((photo)=>`<article class="photo-card"><img class="private-image" data-private-src="${photo.imageUrl}" alt="学员分享照片"><p>${escapeHtml(photo.caption||'')}</p><span class="badge">${escapeHtml({coach:'自己和教练',public:'公开'}[photo.privacy])}</span>${photo.metricSnapshot?`<small>${photo.metricSnapshot.weightKg??'—'} kg · 腰围 ${photo.metricSnapshot.waistCm??'—'} cm${photo.metricSnapshot.bodyFatPct==null?'':` · 体脂 ${photo.metricSnapshot.bodyFatPct}%`}</small>`:''}</article>`).join(''):'<div class="empty-state">学员还没有授权展示的已审核照片。</div>';await attachPrivateImages(list,state);}
  catch{list.innerHTML='<div class="empty-state">照片读取失败或教练关系已结束。</div>';}
}

async function renderSuggestions({state,content,notify}){
  content.innerHTML=`<div class="section-heading section-heading-tight"><div><h3>待确认进阶建议</h3><p class="panel-intro">系统建议仅供参考；只有教练确认后才会创建新的已发布计划版本。</p></div><button class="button small" id="reloadSuggestions" type="button">刷新</button></div><div class="data-list" id="suggestionList"><div class="empty-state">正在读取建议…</div></div>`;
  content.querySelector('#reloadSuggestions').addEventListener('click',load);
  await load();
  async function load(){
    try{const {suggestions}=await api('/api/coach/progression-suggestions');const list=content.querySelector('#suggestionList');const own=state.coachStudentId?suggestions.filter((item)=>item.studentId===state.coachStudentId):suggestions;list.innerHTML=own.length?own.map((item)=>`<article class="data-row"><div class="data-main"><strong>${escapeHtml(item.studentName)} · ${escapeHtml(item.exerciseNameZh)}</strong><small>${escapeHtml(item.suggestion.reason)}</small><small>当前 ${escapeHtml(item.suggestion.completedWeight)} kg → 建议 ${escapeHtml(item.suggestion.targetWeight)} kg · ${formatDate(item.createdAt,true)}</small></div><div class="actions"><button class="button primary small" type="button" data-decision="accept" data-suggestion-id="${item.id}">确认应用</button><button class="button small" type="button" data-decision="dismiss" data-suggestion-id="${item.id}">忽略</button></div></article>`).join(''):'<div class="empty-state">当前没有待确认建议。</div>';list.querySelectorAll('[data-decision]').forEach((button)=>button.addEventListener('click',async()=>{try{await api(`/api/coach/progression-suggestions/${button.dataset.suggestionId}/decision`,{method:'POST',body:jsonBody({decision:button.dataset.decision})});notify(button.dataset.decision==='accept'?'建议已应用并生成新计划版本。':'建议已忽略。');await load();}catch(error){notify(error.message==='finish_plan_draft_first'?'该学员有未发布草稿，请先处理草稿后再确认。':'处理建议失败。');}}));}
    catch{content.querySelector('#suggestionList').innerHTML='<div class="empty-state">进阶建议读取失败。</div>';}
  }
}
