import { api, attachPrivateImages, escapeHtml, formatDate, jsonBody, revokeRenderedImages } from './api.js';

const SPLIT_TAGS = [
  ['ppl_push', '推'], ['ppl_pull', '拉'], ['ppl_legs', '腿'],
  ['upper_lower_upper', '上下肢·上肢'], ['upper_lower_lower', '上下肢·下肢'],
  ['five_chest', '五分化·胸'], ['five_back', '五分化·背'], ['five_legs', '五分化·腿'],
  ['five_shoulders', '五分化·肩'], ['five_arms', '五分化·手臂'],
];

const muscleName = (item) => item.primaryMuscleZh || item.primaryMuscle || '';

export async function renderAdmin({ state, root, notify }) {
  const canManageCapacity = window.GymCapacityView?.canManageCapacity(state.user?.roles) === true;
  const sections = [['coaches','教练资格'], ...(canManageCapacity ? [['capacity','教练名额']] : []), ['memberships','会员授权'],['catalog','动作库管理'],['photos','照片审核']];
  let section = state.adminSection || 'coaches';
  if (!sections.some(([id]) => id === section)) section = 'coaches';
  state.adminSection = section;
  const roleLabel = canManageCapacity ? '总管理员' : '管理员';
  root.innerHTML = `<div class="section-heading"><div><p class="eyebrow">ADMINISTRATION</p><h2>管理工作台</h2></div><span class="account-pill">${roleLabel}</span></div>
    <nav class="subnav" aria-label="管理员菜单">${sections.map(([id,label]) => `<button class="subtab${section===id?' active':''}" type="button" data-admin-section="${id}">${label}</button>`).join('')}</nav>
    <div id="adminSectionContent"></div>`;
  root.querySelectorAll('[data-admin-section]').forEach((button) => button.addEventListener('click', () => {
    state.adminSection = button.dataset.adminSection;
    renderAdmin({ state, root, notify });
  }));
  const content = root.querySelector('#adminSectionContent');
  if (section === 'capacity') return renderCoachCapacity({ state, content, notify });
  if (section === 'memberships') return renderMembershipAuthorization({ state, content, notify });
  if (section === 'catalog') return renderCatalog({ state, content, notify });
  if (section === 'photos') return renderPhotoQueue({ state, content, notify });
  return renderCoachAuthorization({ state, content, notify });
}

async function renderCoachCapacity({ state, content, notify }) {
  content.innerHTML = `<div class="section-heading section-heading-tight"><div><p class="eyebrow">COACH CAPACITY</p><h3>教练等级与学员上限</h3></div></div>
    <p class="panel-intro">等级上限可统一管理；单个教练的个人覆盖值优先于等级。未分级且未设置个人上限时禁止新增绑定，降低上限不会解除已有关系。</p>
    <div class="capacity-admin-grid">
      <section class="capacity-admin-panel"><h4>教练等级</h4>
        <form class="capacity-create-tier" id="createTierForm"><label class="field-label">等级名称<input class="field-input" name="name" maxlength="80" required placeholder="例如：初级教练"></label><label class="field-label">最多学员<input class="field-input" name="maxStudents" type="number" min="0" step="1" required value="5"></label><label class="field-label">排序<input class="field-input" name="sortOrder" type="number" step="1" value="0"></label><button class="button primary" type="submit">新增等级</button></form>
        <div class="capacity-tier-list" id="capacityTierList"><div class="empty-state">正在读取等级…</div></div>
      </section>
      <section class="capacity-admin-panel"><h4>教练名额</h4>
        <form class="toolbar capacity-search" id="coachCapacitySearch"><label class="field-label">搜索教练<input class="field-input" id="coachCapacityQuery" maxlength="64" placeholder="输入用户名"></label><button class="button" type="submit">搜索</button></form>
        <div class="capacity-coach-list" id="capacityCoachList"><div class="empty-state">正在读取教练…</div></div>
      </section>
    </div>
    <section class="capacity-admin-panel capacity-audit-panel"><h4>最近名额变更 <small>最多显示 100 条</small></h4><div class="capacity-event-list" id="capacityEventList"><div class="empty-state">正在读取变更记录…</div></div></section>`;
  const createForm = content.querySelector('#createTierForm');
  const searchForm = content.querySelector('#coachCapacitySearch');
  content.querySelector('#coachCapacityQuery').value = state.adminCapacityQuery || '';
  searchForm.addEventListener('submit', (event) => { event.preventDefault(); state.adminCapacityQuery=content.querySelector('#coachCapacityQuery').value.trim(); loadCapacity(); });
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form=event.currentTarget;
    const payload={name:form.elements.name.value.trim(),maxStudents:Number(form.elements.maxStudents.value),sortOrder:Number(form.elements.sortOrder.value||0)};
    if(!Number.isSafeInteger(payload.maxStudents)||payload.maxStudents<0||!Number.isSafeInteger(payload.sortOrder))return notify('名额与排序必须填写非负整数 / 整数。');
    try{await api('/api/admin/coach-capacity/tiers',{method:'POST',body:jsonBody(payload)});notify('教练等级已新增。');form.reset();form.elements.maxStudents.value='5';form.elements.sortOrder.value='0';await loadCapacity();}
    catch(error){notify(capacityAdminError(error.message));}
  });
  await loadCapacity();

  async function loadCapacity() {
    try {
      const result=await api(`/api/admin/coach-capacity?q=${encodeURIComponent(state.adminCapacityQuery||'')}`);
      state.adminCoachCapacity=result;
      drawTiers(result.tiers);
      drawCoaches(result.coaches,result.tiers);
      drawCapacityEvents(result.events);
    } catch {
      for(const id of ['capacityTierList','capacityCoachList','capacityEventList'])content.querySelector(`#${id}`).innerHTML='<div class="empty-state">名额数据读取失败。</div>';
    }
  }

  function drawTiers(tiers) {
    const list=content.querySelector('#capacityTierList');
    list.innerHTML=tiers.length?tiers.map((tier)=>`<form class="capacity-tier-row" data-tier-form="${tier.id}"><div class="capacity-tier-fields"><label class="field-label">等级名称<input class="field-input" name="name" maxlength="80" required value="${escapeHtml(tier.name)}"></label><label class="field-label">最多学员<input class="field-input" name="maxStudents" type="number" min="0" step="1" required value="${tier.maxStudents}"></label><label class="field-label">排序<input class="field-input" name="sortOrder" type="number" step="1" value="${tier.sortOrder}"></label></div><div class="actions"><button class="button primary small" type="submit">保存</button><button class="button danger small" type="button" data-delete-tier="${tier.id}">删除</button></div></form>`).join(''):'<div class="empty-state">尚无等级，先新增一个等级。</div>';
    list.querySelectorAll('[data-tier-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const payload={name:form.elements.name.value.trim(),maxStudents:Number(form.elements.maxStudents.value),sortOrder:Number(form.elements.sortOrder.value||0)};
      if(!Number.isSafeInteger(payload.maxStudents)||payload.maxStudents<0||!Number.isSafeInteger(payload.sortOrder))return notify('名额与排序必须填写非负整数 / 整数。');
      try{await api(`/api/admin/coach-capacity/tiers/${form.dataset.tierForm}`,{method:'PATCH',body:jsonBody(payload)});notify('教练等级已更新。');await loadCapacity();}
      catch(error){notify(capacityAdminError(error.message));}
    }));
    list.querySelectorAll('[data-delete-tier]').forEach((button)=>button.addEventListener('click',async()=>{
      if(!confirm('删除后不能恢复该等级配置。确认删除？'))return;
      try{await api(`/api/admin/coach-capacity/tiers/${button.dataset.deleteTier}`,{method:'DELETE'});notify('教练等级已删除。');await loadCapacity();}
      catch(error){notify(capacityAdminError(error.message));}
    }));
  }

  function drawCoaches(coaches,tiers) {
    const list=content.querySelector('#capacityCoachList');
    list.innerHTML=coaches.length?coaches.map((coach)=>`<form class="capacity-coach-row" data-coach-form="${coach.id}"><div class="capacity-coach-heading"><strong>${escapeHtml(coach.username)}</strong><span>${coach.activeStudents} / ${coach.maxStudents==null?'未配置':coach.maxStudents} 人 · 剩余 ${coach.remaining}</span></div><div class="capacity-coach-fields"><label class="field-label">教练等级<select class="field-input" name="tierId"><option value="">未分级</option>${tiers.map((tier)=>`<option value="${tier.id}" ${coach.tierId===tier.id?'selected':''}>${escapeHtml(tier.name)} · ${tier.maxStudents} 人</option>`).join('')}</select></label><label class="field-label">个人上限覆盖<input class="field-input" name="maxStudentsOverride" type="number" min="0" step="1" value="${coach.maxStudentsOverride??''}" placeholder="留空则继承等级"></label><button class="button primary small" type="submit">保存名额</button></div><small class="capacity-effective">有效上限：${coach.maxStudents==null?'未配置（禁止新增学员）':`${coach.maxStudents} 人${coach.maxStudentsOverride==null?'（继承等级）':'（个人覆盖）'}`}</small></form>`).join(''):'<div class="empty-state">没有匹配的教练账号。</div>';
    list.querySelectorAll('[data-coach-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const rawOverride=form.elements.maxStudentsOverride.value.trim();
      const override=rawOverride===''?null:Number(rawOverride);
      if(override!==null&&(!Number.isSafeInteger(override)||override<0))return notify('个人上限必须是非负整数，留空表示继承等级。');
      const tierValue=form.elements.tierId.value;
      try{await api(`/api/admin/coach-capacity/coaches/${form.dataset.coachForm}`,{method:'PUT',body:jsonBody({tierId:tierValue===''?null:Number(tierValue),maxStudentsOverride:override})});notify('教练名额已保存。');await loadCapacity();}
      catch(error){notify(capacityAdminError(error.message));}
    }));
  }

  function drawCapacityEvents(events) {
    const labels={tier_created:'新增等级',tier_updated:'修改等级',tier_deleted:'删除等级',coach_capacity_updated:'调整教练名额'};
    const list=content.querySelector('#capacityEventList');
    list.innerHTML=events.length?events.map((item)=>`<article class="capacity-event"><div><strong>${escapeHtml(labels[item.eventType]||item.eventType)}</strong><small>${escapeHtml(item.actorUsername||'未知操作人')} · ${escapeHtml(item.coachUsername||'全局等级')} · ${escapeHtml(formatDate(item.createdAt,true))}</small></div><details><summary>查看变更</summary><small>变更前：${escapeHtml(JSON.stringify(item.beforeState??'—'))}</small><small>变更后：${escapeHtml(JSON.stringify(item.afterState??'—'))}</small></details></article>`).join(''):'<div class="empty-state">还没有名额变更。</div>';
  }
}

function capacityAdminError(code) {
  return ({
    invalid_tier:'请检查等级名称、名额和排序。',
    invalid_capacity:'个人名额必须为非负整数。',
    duplicate_tier:'这个等级名称已存在。',
    tier_not_found:'这个等级不存在或已被删除。',
    tier_in_use:'该等级仍有教练使用，不能删除。',
    coach_not_found:'教练账号不存在。',
    coach_qualification_required:'该账号尚未获教练资格。',
    forbidden:'当前账号无权管理教练名额。',
  })[code]||'保存失败，请稍后重试。';
}

async function renderCoachAuthorization({ state, content, notify }) {
  content.innerHTML = `<p class="panel-intro">只有管理员能授予或撤销教练资格；撤销前需先结束该教练的有效学员关系。</p>
    <form class="toolbar" id="userSearchForm"><label class="field-label">搜索账号<input class="field-input" id="userQuery" placeholder="输入用户名"></label><button class="button" type="submit">搜索</button></form>
    <div class="data-list" id="userList"><div class="empty-state">正在读取账号…</div></div>`;
  content.querySelector('#userSearchForm').addEventListener('submit', (event) => { event.preventDefault(); loadUsers(); });
  await loadUsers();

  async function loadUsers() {
    const list = content.querySelector('#userList');
    if (!list) return;
    try {
      const data = await api(`/api/admin/users?q=${encodeURIComponent(content.querySelector('#userQuery').value.trim())}`);
      list.innerHTML = data.users.length ? data.users.map((user) => `<article class="data-row"><div class="data-main"><strong>${escapeHtml(user.username)}${user.id===state.user.id?'（当前账号）':''}</strong><div class="badge-row">${user.roles.map((role) => `<span class="badge">${escapeHtml({admin:'管理员',coach:'教练',student:'学员'}[role]||role)}</span>`).join('')}</div></div><div class="actions">${!user.roles.includes('admin')&&!user.roles.includes('coach')?`<button class="button primary small" type="button" data-grant="${user.id}">授予教练资格</button>`:''}${user.roles.includes('coach')?`<button class="button danger small" type="button" data-revoke="${user.id}">撤销教练资格</button>`:''}</div></article>`).join('') : '<div class="empty-state">没有匹配的账号。</div>';
      list.querySelectorAll('[data-grant]').forEach((button) => button.addEventListener('click', async () => {
        try { await api(`/api/admin/users/${button.dataset.grant}/coach`, { method: 'POST', body: '{}' }); notify('教练资格已授予。'); await loadUsers(); }
        catch { notify('授权失败。'); }
      }));
      list.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', async () => {
        if (!confirm('该账号有有效学员关系时不能撤销。确认尝试撤销？')) return;
        try { await api(`/api/admin/users/${button.dataset.revoke}/coach`, { method: 'DELETE' }); notify('教练资格已撤销。'); await loadUsers(); }
        catch (error) { notify(error.message==='coach_has_active_students'?'请先结束该教练的有效学员关系。':'撤销失败。'); }
      }));
    } catch { list.innerHTML = '<div class="empty-state">账号读取失败。</div>'; }
  }
}

async function renderMembershipAuthorization({ state, content, notify }) {
  content.innerHTML = `<p class="panel-intro">仅管理员可管理会员期限。续期会新增一条授权并保留完整历史；yhone 的超级管理员权限不依赖会员期限。</p>
    <form class="toolbar" id="membershipUserSearch"><label class="field-label">搜索学员账号<input class="field-input" id="membershipUserQuery" placeholder="输入用户名"></label><button class="button" type="submit">搜索</button></form>
    <div class="membership-layout"><div class="data-list" id="membershipUserList"><div class="empty-state">正在读取账号…</div></div>
      <section class="membership-detail panel" id="membershipDetail"><div class="empty-state">选择一个账号，查看当前期限和授权历史。</div></section></div>`;
  content.querySelector('#membershipUserSearch').addEventListener('submit', (event) => {
    event.preventDefault();
    loadUsers();
  });
  await loadUsers();
  if (state.adminMembershipUserId) await loadMembership(state.adminMembershipUserId);

  async function loadUsers() {
    const list = content.querySelector('#membershipUserList');
    if (!list) return;
    try {
      const query = content.querySelector('#membershipUserQuery').value.trim();
      const { users } = await api(`/api/admin/users?q=${encodeURIComponent(query)}`);
      list.innerHTML = users.length ? users.map((user) => `<article class="data-row membership-user-row"><div class="data-main"><strong>${escapeHtml(user.username)}${user.id===state.user.id?'（当前账号）':''}</strong><div class="badge-row">${user.roles.map((role) => `<span class="badge">${escapeHtml({admin:'管理员',superadmin:'总管理员',coach:'教练',student:'学员'}[role]||role)}</span>`).join('')}</div></div><button class="button small${Number(state.adminMembershipUserId)===user.id?' primary':''}" type="button" data-membership-user="${user.id}">管理授权</button></article>`).join('') : '<div class="empty-state">没有匹配的账号。</div>';
      list.querySelectorAll('[data-membership-user]').forEach((button) => button.addEventListener('click', () => {
        state.adminMembershipUserId = Number(button.dataset.membershipUser);
        loadMembership(state.adminMembershipUserId);
      }));
    } catch {
      list.innerHTML = '<div class="empty-state">账号读取失败。</div>';
    }
  }

  async function loadMembership(userId) {
    const detail = content.querySelector('#membershipDetail');
    if (!detail) return;
    detail.innerHTML = '<div class="empty-state">正在读取会员授权…</div>';
    try {
      const { current, history } = await api(`/api/admin/users/${userId}/membership`);
      const user = (state.adminUsers || []).find((item) => item.id === userId);
      const selected = content.querySelector(`[data-membership-user="${userId}"]`);
      const username = selected?.closest('.data-row')?.querySelector('.data-main strong')?.textContent || user?.username || `账号 ${userId}`;
      detail.innerHTML = `<div class="section-heading section-heading-tight"><div><p class="eyebrow">MEMBERSHIP ACCESS</p><h3>${escapeHtml(username.replace('（当前账号）',''))}</h3></div><span class="badge ${current?'':'badge-muted'}">${current?'会员有效':'当前无有效会员'}</span></div>
        ${current?`<div class="membership-current"><strong>当前有效期限</strong><span>${escapeHtml(current.startsOn)} 至 ${escapeHtml(current.expiresOn)}（含到期日）</span>${current.reason?`<small>备注：${escapeHtml(current.reason)}</small>`:''}</div>`:''}
        <form class="membership-form" id="membershipGrantForm"><h4>${history.length?'新增授权 / 续期':'授予会员期限'}</h4><p class="panel-intro">续期会创建新的授权记录，不覆盖旧记录。开始日和到期日均按北京时间判断，且到期日当天仍有效。</p>
          <div class="form-grid"><label>开始日期<input class="field-input" type="date" name="startsOn" required value="${shanghaiToday()}"></label><label>到期日期<input class="field-input" type="date" name="expiresOn" required></label><label class="wide-field">备注（可选）<input class="field-input" name="reason" maxlength="500" placeholder="例如：首期会员、续费"></label></div>
          <button class="button primary" type="submit">${history.length?'新增期限':'保存会员授权'}</button></form>
        <div class="membership-history"><h4>授权历史 <span>${history.length}</span></h4>${history.length?history.map((grant)=>`<article class="membership-history-card"><div class="membership-history-heading"><strong>${escapeHtml(grant.startsOn)} 至 ${escapeHtml(grant.expiresOn)}</strong><span class="badge ${grant.revokedAt?'badge-muted':''}">${grant.revokedAt?'已撤销':membershipStatus(grant)?'当前有效':'未生效 / 已到期'}</span></div><small>授权人 ID ${grant.grantedBy} · 创建于 ${escapeHtml(formatDate(grant.createdAt,true))}${grant.reason?` · ${escapeHtml(grant.reason)}`:''}</small>${grant.revokedAt?`<small>撤销于 ${escapeHtml(formatDate(grant.revokedAt,true))} · 操作人 ID ${grant.revokedBy}</small>`:''}<div class="membership-events">${grant.events.map((item)=>`<small>${item.eventType==='granted'?'授权':'撤销'} · ${escapeHtml(formatDate(item.createdAt,true))} · 操作人 ID ${item.actorId}${item.reason?` · ${escapeHtml(item.reason)}`:''}</small>`).join('')}</div>${!grant.revokedAt?`<button class="button danger small" type="button" data-revoke-membership="${grant.id}">撤销此期限</button>`:''}</article>`).join(''):'<div class="empty-state">尚无会员授权记录。</div>'}</div>`;
      const grantForm = detail.querySelector('#membershipGrantForm');
      const startsField = grantForm.elements.startsOn;
      const expiresField = grantForm.elements.expiresOn;
      expiresField.min = startsField.value;
      startsField.addEventListener('change', () => { expiresField.min = startsField.value; });
      grantForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const body = Object.fromEntries(new FormData(form).entries());
        if (body.expiresOn < body.startsOn) {
          notify('到期日期不能早于开始日期。');
          expiresField.focus();
          return;
        }
        try {
          await api(`/api/admin/users/${userId}/membership`, { method: 'POST', body: jsonBody(body) });
          notify('会员期限已保存，历史记录已保留。');
          await loadMembership(userId);
        } catch (error) {
          notify(error.message==='invalid_membership_dates'?'请检查开始日期与到期日期。':'会员授权保存失败。');
        }
      });
      detail.querySelectorAll('[data-revoke-membership]').forEach((button) => button.addEventListener('click', async () => {
        const reason = prompt('请输入撤销原因：')?.trim();
        if (!reason) return;
        if (!confirm('撤销后，该期限将立即失效。确认撤销？')) return;
        try {
          await api(`/api/admin/memberships/${button.dataset.revokeMembership}/revoke`, { method: 'POST', body: jsonBody({ reason }) });
          notify('会员期限已撤销。');
          await loadMembership(userId);
        } catch (error) {
          notify(error.message==='membership_already_revoked'?'该期限已被撤销。':'撤销会员期限失败。');
        }
      }));
    } catch {
      detail.innerHTML = '<div class="empty-state">会员信息读取失败，请稍后重试。</div>';
    }
  }

  function membershipStatus(grant) {
    const today = shanghaiToday();
    return !grant.revokedAt && grant.startsOn <= today && grant.expiresOn >= today;
  }
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function renderCatalog({ state, content, notify }) {
  content.innerHTML = `<div class="section-heading section-heading-tight"><div><p class="eyebrow">EXERCISE LIBRARY</p><h3>全站动作库</h3></div><button class="button primary" id="newExercise" type="button">新增动作</button></div>
    <p class="panel-intro">教练端只能搜索和引用动作；此处的停用仅从新计划中隐藏，不会改动已发布计划的动作快照。</p>
    <form class="toolbar catalog-filters" id="catalogFilter"><label class="field-label">动作名称<input class="field-input" name="q" placeholder="搜索中英文名称"></label><label class="field-label">肌群<input class="field-input" name="muscle" placeholder="如 pectorals"></label><label class="field-label">分化<select class="field-input" name="split"><option value="">全部</option>${SPLIT_TAGS.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><button class="button" type="submit">筛选</button></form>
    <form id="exerciseEditor" class="editor-form" hidden></form>
    <div class="catalog-summary" id="catalogSummary"></div><div class="exercise-admin-list" id="exerciseList"><div class="empty-state">正在读取动作库…</div></div>`;
  const filter = content.querySelector('#catalogFilter');
  filter.addEventListener('submit', (event) => { event.preventDefault(); drawList(); });
  content.querySelector('#newExercise').addEventListener('click', () => openEditor(null));
  try {
    const result = await api('/api/admin/exercises');
    state.adminExercises = result.exercises;
    drawList();
  } catch { content.querySelector('#exerciseList').innerHTML = '<div class="empty-state">动作库读取失败。</div>'; }

  function drawList() {
    const q = filter.elements.q.value.trim().toLowerCase();
    const muscle = filter.elements.muscle.value.trim().toLowerCase();
    const split = filter.elements.split.value;
    const rows = (state.adminExercises || []).filter((exercise) => (!q || `${exercise.nameZh} ${exercise.nameEn} ${exercise.slug}`.toLowerCase().includes(q)) && (!muscle || `${exercise.primaryMuscle} ${exercise.primaryMuscleZh}`.toLowerCase().includes(muscle)) && (!split || exercise.splitTags.includes(split)));
    content.querySelector('#catalogSummary').textContent = `当前 ${rows.length} 项 / 总计 ${state.adminExercises?.length || 0} 项`;
    const list = content.querySelector('#exerciseList');
    list.innerHTML = rows.length ? rows.map((exercise) => `<article class="exercise-admin-card"><img src="${escapeHtml(exercise.mediaPath || '')}" alt="${escapeHtml(exercise.nameZh)}" loading="lazy"><div class="exercise-admin-main"><div class="badge-row"><span class="badge">${escapeHtml(muscleName(exercise))}</span><span class="badge">${escapeHtml(exercise.equipmentZh)}</span>${!exercise.isActive?'<span class="badge badge-muted">已停用</span>':''}</div><strong>${escapeHtml(exercise.nameZh)}</strong><small>${escapeHtml(exercise.nameEn || exercise.slug)}</small><small>${escapeHtml(exercise.cueZh)}</small><small>${exercise.splitTags.map((tag)=>escapeHtml(SPLIT_TAGS.find(([key])=>key===tag)?.[1]||tag)).join(' · ')||'未标记分化'}</small></div><button class="button small" type="button" data-edit-exercise="${exercise.id}">编辑</button></article>`).join('') : '<div class="empty-state">没有匹配的动作。</div>';
    list.querySelectorAll('[data-edit-exercise]').forEach((button) => button.addEventListener('click', () => openEditor(Number(button.dataset.editExercise))));
  }

  function openEditor(id) {
    const form = content.querySelector('#exerciseEditor');
    const item = id ? state.adminExercises.find((exercise) => exercise.id === id) : {
      slug: '', nameZh: '', nameEn: '', primaryMuscle: '', primaryMuscleZh: '', secondaryMuscles: [], secondaryMusclesZh: [],
      equipment: '', equipmentZh: '', bodyPart: 'strength', category: 'strength', splitTags: [], cueZh: '', mediaPath: '', isActive: true,
    };
    if (!item) return;
    form.hidden = false;
    form.innerHTML = `<div class="editor-heading"><strong>${id?'编辑动作':'新增动作'}</strong><button class="text-button" type="button" id="closeEditor">关闭</button></div>
      <div class="form-grid"><label>稳定 ID / slug<input class="field-input" name="slug" required maxlength="180" value="${escapeHtml(item.slug)}"></label><label>中文名<input class="field-input" name="nameZh" required maxlength="100" value="${escapeHtml(item.nameZh)}"></label><label>英文名<input class="field-input" name="nameEn" maxlength="120" value="${escapeHtml(item.nameEn||'')}"></label><label>主要肌群 ID<input class="field-input" name="primaryMuscle" required value="${escapeHtml(item.primaryMuscle)}"></label><label>主要肌群中文<input class="field-input" name="primaryMuscleZh" value="${escapeHtml(item.primaryMuscleZh)}"></label><label>器械 ID<input class="field-input" name="equipment" required value="${escapeHtml(item.equipment)}"></label><label>器械中文<input class="field-input" name="equipmentZh" value="${escapeHtml(item.equipmentZh)}"></label><label>身体部位<input class="field-input" name="bodyPart" value="${escapeHtml(item.bodyPart)}"></label><label>动作类别<input class="field-input" name="category" value="${escapeHtml(item.category)}"></label><label class="wide-field">次要肌群 ID（逗号分隔）<input class="field-input" name="secondaryMuscles" value="${escapeHtml(item.secondaryMuscles.join(', '))}"></label><label class="wide-field">次要肌群中文（逗号分隔）<input class="field-input" name="secondaryMusclesZh" value="${escapeHtml(item.secondaryMusclesZh.join(', '))}"></label><label class="wide-field">训练要点<textarea class="field-input" name="cueZh" rows="2" maxlength="500">${escapeHtml(item.cueZh)}</textarea></label><label class="wide-field">演示图路径<input class="field-input" name="mediaPath" placeholder="/gym/media/exercises/...gif" value="${escapeHtml(item.mediaPath||'')}"></label><label>状态<select class="field-input" name="isActive"><option value="true" ${item.isActive?'selected':''}>启用</option><option value="false" ${!item.isActive?'selected':''}>停用</option></select></label></div>
      <fieldset class="tag-field"><legend>适用分化</legend>${SPLIT_TAGS.map(([tag,label])=>`<label class="check-label"><input type="checkbox" name="splitTags" value="${tag}" ${item.splitTags.includes(tag)?'checked':''}>${label}</label>`).join('')}</fieldset>
      <div class="actions"><button class="button primary" type="submit">保存动作</button>${id?`<button class="button danger" type="button" id="toggleExercise">${item.isActive?'停用':'重新启用'}</button>`:''}</div>`;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.querySelector('#closeEditor').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', saveExercise);
    form.querySelector('#toggleExercise')?.addEventListener('click', async () => {
      try {
        const payload = exercisePayload(form);
        payload.isActive = !item.isActive;
        await api(`/api/admin/exercises/${id}`, { method: 'PUT', body: jsonBody(payload) });
        await reloadCatalog(); notify(payload.isActive?'动作已重新启用。':'动作已停用。');
      } catch (error) { notify(error.message==='invalid_media_path'?'演示图路径无效或文件不存在。':'动作状态更新失败。'); }
    });

    async function saveExercise(event) {
      event.preventDefault();
      const payload = exercisePayload(form);
      try {
        await api(id?`/api/admin/exercises/${id}`:'/api/admin/exercises', { method: id?'PUT':'POST', body: jsonBody(payload) });
        await reloadCatalog();
        form.hidden = true;
        notify('动作已保存。');
      } catch (error) { notify(error.message==='exercise_exists'?'这个动作 ID 已存在。':error.message==='invalid_media_path'?'演示图路径无效或文件不存在。':'保存动作失败。'); }
    }
  }

  function exercisePayload(form) {
    const value = (name) => form.elements[name].value.trim();
    return {
      slug: value('slug'), nameZh: value('nameZh'), nameEn: value('nameEn'), primaryMuscle: value('primaryMuscle'), primaryMuscleZh: value('primaryMuscleZh'),
      secondaryMuscles: value('secondaryMuscles').split(',').map((v)=>v.trim()).filter(Boolean), secondaryMusclesZh: value('secondaryMusclesZh').split(',').map((v)=>v.trim()).filter(Boolean),
      equipment: value('equipment'), equipmentZh: value('equipmentZh'), bodyPart: value('bodyPart'), category: value('category'), cueZh: value('cueZh'), mediaPath: value('mediaPath'),
      isActive: form.elements.isActive.value==='true', splitTags: [...form.querySelectorAll('input[name="splitTags"]:checked')].map((input)=>input.value),
    };
  }

  async function reloadCatalog() {
    const result = await api('/api/admin/exercises');
    state.adminExercises = result.exercises;
    drawList();
  }
}

async function renderPhotoQueue({ state, content, notify }) {
  content.innerHTML = `<div class="section-heading section-heading-tight"><div><p class="eyebrow">PHOTO MODERATION</p><h3>照片审核</h3></div><select id="photoStatus" class="field-input compact-select"><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="removed">已下架</option><option value="all">全部</option></select></div>
    <p class="panel-intro">所有照片先经管理员审核。只有已审核且选择“公开”的照片会进入展示圈；私密图片使用鉴权接口读取。</p><div class="photo-review-list" id="photoQueue"><div class="empty-state">正在读取待审核照片…</div></div>`;
  content.querySelector('#photoStatus').addEventListener('change', loadQueue);
  await loadQueue();

  async function loadQueue() {
    const list = content.querySelector('#photoQueue');
    revokeRenderedImages(list, state);
    try {
      const { photos } = await api(`/api/admin/photos?status=${encodeURIComponent(content.querySelector('#photoStatus').value)}`);
      list.innerHTML = photos.length ? photos.map((photo) => `<article class="photo-review-card"><img class="private-image" data-private-src="${photo.imageUrl}" alt="待审核学员训练照片"><div class="photo-review-info"><div class="badge-row"><span class="badge">${escapeHtml(photo.username)}</span><span class="badge">${escapeHtml({self:'仅自己',coach:'自己和教练',public:'公开'}[photo.privacy])}</span><span class="badge">${escapeHtml({pending:'待审核',approved:'已通过',rejected:'已拒绝',removed:'已下架',withdrawn:'已撤回'}[photo.moderationStatus])}</span></div><p>${escapeHtml(photo.caption||'（无说明）')}</p><small>提交于 ${formatDate(photo.createdAt,true)}${photo.showMetrics?' · 用户主动选择展示身体数据':''}</small>${photo.moderationNote?`<small>审核备注：${escapeHtml(photo.moderationNote)}</small>`:''}<label class="field-label">审核说明<textarea class="field-input" rows="2" data-review-note="${photo.id}" placeholder="拒绝或下架时请说明原因"></textarea></label><div class="actions">${photo.moderationStatus==='pending'?`<button class="button primary small" type="button" data-review="approve" data-photo-id="${photo.id}">通过</button><button class="button danger small" type="button" data-review="reject" data-photo-id="${photo.id}">拒绝</button>`:''}${['pending','approved','rejected'].includes(photo.moderationStatus)?`<button class="button danger small" type="button" data-remove-photo="${photo.id}">下架</button>`:''}</div></div></article>`).join('') : '<div class="empty-state">当前筛选下没有照片。</div>';
      await attachPrivateImages(list, state);
      list.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', () => review(button.dataset.photoId, button.dataset.review)));
      list.querySelectorAll('[data-remove-photo]').forEach((button) => button.addEventListener('click', async () => {
        const note = list.querySelector(`[data-review-note="${button.dataset.removePhoto}"]`)?.value.trim();
        if (!note) return notify('请先填写下架原因。');
        if (!confirm('下架后该照片立即不再对任何普通用户展示。继续？')) return;
        try { await api(`/api/admin/photos/${button.dataset.removePhoto}/remove`, { method: 'POST', body: jsonBody({ note }) }); notify('照片已下架。'); await loadQueue(); }
        catch { notify('下架失败。'); }
      }));
    } catch { list.innerHTML = '<div class="empty-state">照片列表读取失败。</div>'; }
  }

  async function review(id, decision) {
    const note = content.querySelector(`[data-review-note="${id}"]`)?.value.trim() || '';
    if (decision === 'reject' && !note) return notify('拒绝时请填写原因。');
    try { await api(`/api/admin/photos/${id}/review`, { method: 'POST', body: jsonBody({ decision, note }) }); notify(decision==='approve'?'照片审核通过。':'照片已拒绝。'); await loadQueue(); }
    catch { notify('审核操作失败。'); }
  }
}
