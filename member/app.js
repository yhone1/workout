import { createSetSaveQueue } from '/portal/shared/set-save-queue.js';

const TOKEN_KEY = 'thinMuscleAuthToken';
const SPLITS = {
  ppl: { label: '推 / 拉 / 腿', days: ['推', '拉', '腿'] },
  upper_lower: { label: '上肢 / 下肢', days: ['上肢 A', '下肢 A', '上肢 B', '下肢 B'] },
  five_day: { label: '五分化', days: ['胸', '背', '腿', '肩', '手臂与核心'] },
  custom: { label: '自定义', days: ['训练日 1'] },
};
const state = { viewer: null, exercises: [], plans: [], coachPlan: null, selectedPlan: null, isNew: false, splitType: 'ppl', name: '', draft: null, search: '', sessions: [], openSession: null, sessionMessage: '', elapsedTimer: null, startingSession: false, finishingSession: false, view: null };
const $ = (id) => document.getElementById(id);
const sessionSaveQueues = new WeakMap();
const sessionLocalValues = new WeakMap();

function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function emptySplit(splitType) {
  return { days: SPLITS[splitType].days.map((name) => ({ name, focus: '', exercises: [] })) };
}

function customDaysValid(days) {
  return Array.isArray(days) && days.length >= 1 && days.length <= 7;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const error = new Error('server_response_not_json');
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showNotice(message, stateName = 'info', withPortal = false) {
  const notice = $('notice');
  notice.dataset.state = stateName;
  notice.innerHTML = `${escapeHtml(message)}${withPortal ? ' <a href="/?returnTo=%2Fmember%2F">返回训练中心登录</a>' : ''}`;
  notice.hidden = false;
  $('memberApp').hidden = true;
}

function localizedError(error) {
  if (error.message === 'membership_required') return '会员授权当前未生效。居家训练和自助计划仅向有效会员开放。';
  if (error.message === 'invalid_plan' || error.message === 'invalid_plan_target') return '分化或训练目标格式不正确，请检查训练日、组数、次数和 RIR。';
  if (error.message === 'exercise_not_available') return '所选动作暂不可用，请从动作库重新选择。';
  if (error.message === 'duplicate_exercise_in_day') return '同一训练日不能重复添加同一个动作。';
  if (error.message === 'empty_training_day') return '确认计划前，每个训练日都至少需要一个动作。';
  if (error.message === 'too_many_exercises') return '每个训练日最多添加 20 个动作。';
  if (error.message === 'plan_not_found') return '找不到这份计划，或它不属于当前账号。';
  if (error.message === 'open_session_exists') return '已有一场未完成训练，请先继续或放弃该训练。';
  if (error.message === 'finish_or_skip_each_set') return '每组都要填写完成数据或明确跳过后，才能结束训练。';
  if (error.message === 'session_not_editable') return '这场训练已结束或不可编辑。';
  if (error.status === 401 || error.message === 'unauthorized') return '登录状态已失效，请重新登录。';
  if (error.message === 'server_response_not_json') return '当前服务尚未更新到会员计划版本；训练记录与计划未被改写。';
  return '暂时无法完成请求，请稍后重试。';
}

async function request(path, options) {
  try { return await api(path, options); }
  catch (error) {
    if (error.status === 401 || error.message === 'unauthorized') {
      location.replace('/?returnTo=%2Fmember%2F');
      throw error;
    }
    throw error;
  }
}

function planStatusLabel(plan) {
  if (!plan) return '新建草稿';
  if (plan.status === 'active') return `当前计划 · 已确认版本 v${plan.currentVersionNo || 1}`;
  if (plan.status === 'archived') return '已归档';
  return '未确认草稿';
}

function selectedPlanName() { return $('planName').value.trim() || '我的训练计划'; }

function renderPlanList() {
  const list = $('planList');
  if (!state.plans.length) {
    list.innerHTML = '<p class="empty-state">还没有会员自助计划。教练发放的计划会在下方以只读方式显示。</p>';
    return;
  }
  list.innerHTML = state.plans.map((plan) => `<button class="plan-item" type="button" data-plan-id="${Number(plan.id)}" aria-current="${state.selectedPlan?.id === plan.id ? 'true' : 'false'}">
    <strong>${escapeHtml(plan.name)}</strong><span>${escapeHtml(SPLITS[plan.splitType]?.label || plan.splitType)} · ${escapeHtml(planStatusLabel(plan))}</span>
  </button>`).join('');
}

function splitDays(plan) {
  return plan?.currentVersion?.content?.days || [];
}

function nextWorkout(plan) {
  const days = splitDays(plan);
  if (!days.length) return null;
  const latest = state.sessions
    .filter((session) => Number(session.planId) === Number(plan.id) && session.status === 'completed')
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
  const nextNo = latest ? (Number(latest.dayNo) % days.length) + 1 : 1;
  const day = days.find((item) => Number(item.dayNo) === nextNo) || days[nextNo - 1];
  return { dayNo: nextNo, day };
}

function statusLabel(status) {
  return ({ draft: '未完成', completed: '已完成', abandoned: '已放弃' })[status] || status;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function renderSessionList() {
  const list = $('sessionList');
  if (!state.sessions.length) {
    list.innerHTML = '<p class="empty-state">完成第一场会员计划训练后，这里会保留你的逐组历史。</p>';
    return;
  }
  list.innerHTML = state.sessions.map((session) => {
    const plan = state.plans.find((item) => Number(item.id) === Number(session.planId));
    const when = session.startedAt ? new Date(session.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<article class="session-history-item"><div><strong>${escapeHtml(plan?.name || '会员计划')} · 第 ${session.dayNo} 天 · ${escapeHtml(session.dayName)}</strong><span>${escapeHtml(when)}${session.durationSeconds !== null && session.durationSeconds !== undefined ? ` · ${formatDuration(session.durationSeconds)}` : ''}</span></div><span class="session-state">${escapeHtml(statusLabel(session.status))}</span><button class="button button-quiet" type="button" data-open-session="${Number(session.id)}">${session.status === 'draft' ? '继续训练' : '查看记录'}</button></article>`;
  }).join('');
}

function renderOverview() {
  const root = $('planOverview');
  const plan = state.selectedPlan;
  const visible = state.view === 'overview' && plan && ['active', 'archived'].includes(plan.status);
  root.hidden = !visible;
  if (!visible) return;

  const days = splitDays(plan);
  const next = plan.status === 'active' ? nextWorkout(plan) : null;
  const openDraft = state.sessions.find((session) => session.status === 'draft');
  const totalExercises = days.reduce((total, day) => total + (day.exercises || []).length, 0);
  $('overviewTitle').textContent = plan.name;
  $('overviewSummary').textContent = `${SPLITS[plan.splitType]?.label || plan.splitType} · 已确认版本 v${plan.currentVersionNo || 1} · ${days.length} 个训练日 · ${totalExercises} 个动作`;
  $('overviewEditButton').hidden = plan.status === 'archived';
  const start = $('overviewStartButton');
  start.hidden = plan.status === 'archived';
  start.disabled = state.startingSession;
  start.textContent = openDraft ? '继续未完成训练' : `开始训练${next ? ` · 第 ${next.dayNo} 天` : ''}`;

  const message = $('overviewMessage');
  if (openDraft) {
    const draftPlan = state.plans.find((item) => Number(item.id) === Number(openDraft.planId));
    message.textContent = `有一场未完成训练：${draftPlan?.name || '会员计划'} · 第 ${openDraft.dayNo} 天 ${openDraft.dayName || ''}。继续后会回到已保存的逐组记录。`;
    message.hidden = false;
  } else {
    message.textContent = state.sessionMessage || (plan.status === 'archived' ? '这份计划已归档，可查看当时的训练安排与记录。' : '训练记录会按已确认版本保存；后续编辑需再次确认才会影响新训练。');
    message.hidden = !message.textContent;
  }
  $('overviewDays').innerHTML = days.map((day, index) => {
    const dayName = day.name || `训练日 ${index + 1}`;
    const exercises = day.exercises || [];
    return `<article class="overview-day">
      <div class="overview-day-heading"><div><span>DAY ${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(dayName)}</h3></div><strong>${exercises.length} 个动作</strong></div>
      ${day.focus ? `<p class="overview-focus">${escapeHtml(day.focus)}</p>` : ''}
      <ol>${exercises.map((exercise) => `<li><span><strong>${escapeHtml(exercise.exerciseNameZh || exercise.nameZh || '未命名动作')}</strong><small>${escapeHtml(exercise.primaryMuscleZh || exercise.primaryMuscle || '')}</small></span><span class="overview-target">${Number(exercise.sets) || 0} 组 × ${Number(exercise.repMin) || 0}–${Number(exercise.repMax) || 0} 次 <small>RIR ${Number(exercise.rir) || 0}</small></span></li>`).join('')}</ol>
    </article>`;
  }).join('');
  renderSessionList();
}

function renderTraining() {
  const visible = state.view === 'workout';
  $('trainingPanel').hidden = !visible;
  $('workspace').hidden = visible;
  $('pageHeading').hidden = visible;
  $('globalFooter').hidden = visible;
  if (visible) {
    const session = state.openSession;
    $('trainingTitle').textContent = session ? `${session.dayName} · 第 ${session.dayNo} 天` : '正在准备训练';
    $('trainingSubtitle').textContent = session ? `版本 v${session.snapshot?.versionNo || session.planVersionId || ''} · 每组重量、次数与 RIR 单独保存` : '正在建立本次训练的动作快照。';
    $('trainingMessage').textContent = session
      ? (session.status === 'draft' ? '训练中 · 修改每组数据后会自动保存；你可以随时返回计划。' : `本次训练${statusLabel(session.status)}。${state.sessionMessage || ''}`)
      : (state.sessionMessage || '正在建立训练快照…');
    $('trainingMessage').dataset.state = state.sessionMessage && !session ? 'error' : 'info';
  }
  renderActiveSession();
}

function renderActiveSession() {
  const root = $('activeSession');
  const session = state.openSession;
  if (!session) {
    root.hidden = true;
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
    return;
  }
  root.hidden = false;
  const editable = session.status === 'draft';
  const exercises = session.snapshot?.exercises || [];
  const sets = session.sets || [];
  const elapsed = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
  const setHtml = (row) => {
    const local = sessionLocalValues.get(session)?.get(`${row.exerciseIndex}:${row.setNo}`);
    const display = local || row;
    const skipped = display.status === 'skipped';
    const completed = row.status === 'completed';
    return `<div class="session-set${completed ? ' is-completed' : ''}${skipped ? ' is-skipped' : ''}" data-session-set="${row.exerciseIndex}:${row.setNo}" data-status="${display.status}">
      <div class="set-target"><strong>第 ${row.setNo} 组 · 目标 ${row.targetRepMin}–${row.targetRepMax} 次</strong><span>${row.targetWeight !== null && row.targetWeight !== undefined ? `目标 ${row.targetWeight} kg · ` : ''}目标 RIR ${row.targetRir}</span></div>
      <label>实际重量 kg<input type="number" data-session-field="actualWeight" min="0" max="1000" step="0.25" value="${display.actualWeight ?? ''}" ${!editable || skipped ? 'disabled' : ''}></label>
      <label>实际次数<input type="number" data-session-field="actualReps" min="0" max="300" step="1" value="${display.actualReps ?? ''}" ${!editable || skipped ? 'disabled' : ''}></label>
      <label>实际 RIR<input type="number" data-session-field="actualRir" min="0" max="10" step="1" value="${display.actualRir ?? ''}" ${!editable || skipped ? 'disabled' : ''}></label>
      <span class="set-status" data-set-status>${local ? '尚未保存' : skipped ? '已跳过' : completed ? '已保存' : '待填写'}</span>
      ${editable ? `<button class="skip-set-button" type="button" data-skip-set="${row.exerciseIndex}:${row.setNo}">${skipped ? '恢复本组' : '跳过本组'}</button>` : ''}
    </div>`;
  };
  const workoutHtml = exercises.map((exercise, exerciseIndex) => {
    const rows = sets.filter((row) => Number(row.exerciseIndex) === exerciseIndex);
    const rest = exercise.restSeconds != null ? ` · ${Number(exercise.restSeconds) === 0 ? '无需组间休息' : `组间休息 ${Number(exercise.restSeconds)} 秒`}` : '';
    return `<article class="session-exercise"><h4>${escapeHtml(exercise.exerciseNameZh)}</h4><p>${escapeHtml(exercise.primaryMuscleZh || '')} · ${rows.length} 组${rest}${exercise.cueZh ? ` · ${escapeHtml(exercise.cueZh)}` : ''}</p><div class="session-set-list">${rows.map(setHtml).join('')}</div></article>`;
  }).join('');
  root.innerHTML = `<div class="active-session-heading"><div><h3>${escapeHtml(session.dayName)} · 第 ${session.dayNo} 天</h3><p>${escapeHtml(session.status === 'draft' ? '训练进行中 · 每组修改自动保存' : statusLabel(session.status))} · 版本快照 v${session.snapshot?.versionNo || session.planVersionId || ''}</p></div>${editable ? `<span class="session-elapsed" data-elapsed>${formatDuration(elapsed)}</span>` : ''}</div>
    ${workoutHtml || '<p class="empty-state">此训练快照没有动作数据。</p>'}
    ${editable ? '<div class="session-controls"><button class="button button-primary" type="button" data-complete-session>完成训练</button><button class="button button-quiet" type="button" data-abandon-session>放弃本次训练</button></div>' : `<p class="empty-state">${session.durationSeconds !== null && session.durationSeconds !== undefined ? `训练用时 ${formatDuration(session.durationSeconds)}` : '这场训练未形成正式完成记录。'}</p>`}`;
  if (editable) {
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = setInterval(() => {
      const label = root.querySelector('[data-elapsed]');
      if (label && state.openSession?.status === 'draft') label.textContent = formatDuration((Date.now() - new Date(state.openSession.startedAt).getTime()) / 1000);
    }, 1000);
  } else if (state.elapsedTimer) {
    clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
  }
}

function exerciseLabel(exercise) {
  const equipment = exercise.equipmentZh || exercise.equipment || '器械未标注';
  const muscle = exercise.primaryMuscleZh || exercise.primaryMuscle || '肌群未标注';
  return `${exercise.nameZh} · ${muscle} · ${equipment}`;
}

function filteredExercises(day) {
  const search = state.search.trim().toLocaleLowerCase();
  const selected = new Set(day.exercises.map((exercise) => exercise.exerciseSlug));
  return state.exercises.filter((exercise) => {
    const text = [exercise.nameZh, exercise.primaryMuscleZh, exercise.secondaryMusclesZh?.join(' '), exercise.equipmentZh, exercise.cueZh]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return !selected.has(exercise.slug) && (!search || text.includes(search));
  });
}

function numberField(dayNo, exerciseNo, field, label, value, min, max, step = 1) {
  const shown = value === null || value === undefined ? '' : value;
  return `<label>${label}<input type="number" data-day="${dayNo}" data-exercise="${exerciseNo}" data-field="${field}" value="${escapeHtml(shown)}" min="${min}" max="${max}" step="${step}" ${field === 'targetWeight' ? 'placeholder="选填"' : ''}></label>`;
}

function renderExercise(exercise, dayNo, exerciseNo) {
  const libraryItem = state.exercises.find((item) => item.slug === exercise.exerciseSlug);
  const equipment = exercise.equipmentZh || exercise.equipment || libraryItem?.equipmentZh || libraryItem?.equipment || '';
  const muscle = exercise.primaryMuscleZh || exercise.primaryMuscle || libraryItem?.primaryMuscleZh || libraryItem?.primaryMuscle || '';
  return `<article class="exercise-row">
    <div class="exercise-name"><strong>${escapeHtml(exercise.exerciseNameZh || exercise.nameZh || '未命名动作')}</strong><span>${escapeHtml(muscle)}${equipment ? ` · ${escapeHtml(equipment)}` : ''}</span></div>
    ${numberField(dayNo, exerciseNo, 'sets', '组数', exercise.sets, 1, 10)}
    ${numberField(dayNo, exerciseNo, 'repMin', '次数下限', exercise.repMin, 1, 100)}
    ${numberField(dayNo, exerciseNo, 'repMax', '次数上限', exercise.repMax, 1, 100)}
    ${numberField(dayNo, exerciseNo, 'rir', '目标 RIR', exercise.rir, 0, 5)}
    ${numberField(dayNo, exerciseNo, 'restSeconds', '休息秒数', exercise.restSeconds, 0, 600)}
    <button class="remove-button" type="button" data-remove-day="${dayNo}" data-remove-exercise="${exerciseNo}" aria-label="移除${escapeHtml(exercise.exerciseNameZh || exercise.nameZh)}">×</button>
    <div class="exercise-name weight-field"><span>可选目标重量（kg）</span>${numberField(dayNo, exerciseNo, 'targetWeight', 'kg', exercise.targetWeight, 0, 1000, 0.25).replace(/^<label>|<\/label>$/g, '')}</div>
  </article>`;
}

function renderDays() {
  if (!state.draft) return;
  const canEditDays = state.splitType === 'custom' && state.selectedPlan?.status !== 'archived';
  const dayControls = $('customDayControls');
  dayControls.hidden = !canEditDays;
  $('addTrainingDayButton').disabled = !canEditDays || state.draft.days.length >= 7;
  $('addTrainingDayButton').textContent = state.draft.days.length >= 7 ? '已达 7 天上限' : '＋ 新增训练日';
  $('dayList').innerHTML = state.draft.days.map((day, dayIndex) => {
    const options = filteredExercises(day);
    return `<section class="day-card" data-day-card="${dayIndex}">
      <div class="day-heading">
        <label>训练日名称<input type="text" data-day-name="${dayIndex}" maxlength="50" value="${escapeHtml(day.name)}"></label>
        <label>训练重点<input type="text" data-day-focus="${dayIndex}" maxlength="120" value="${escapeHtml(day.focus || '')}" placeholder="例如：胸、肩、三头"></label>
        <div class="day-meta"><span class="day-count">第 ${dayIndex + 1} 天 · ${day.exercises.length}/20 动作</span>${canEditDays ? `<button class="remove-training-day" type="button" data-remove-training-day="${dayIndex}" aria-label="移除第 ${dayIndex + 1} 个训练日" ${state.draft.days.length <= 1 ? 'disabled title="至少保留一个训练日"' : ''}>移除此日</button>` : ''}</div>
      </div>
      <div class="exercise-list">${day.exercises.map((exercise, exerciseIndex) => renderExercise(exercise, dayIndex, exerciseIndex)).join('') || '<p class="empty-state">还没有动作。使用下方动作库添加。</p>'}</div>
      <div class="add-exercise"><select class="add-exercise-select" data-add-select="${dayIndex}" aria-label="为${escapeHtml(day.name)}选择动作"><option value="">${options.length ? '从动作库选择动作…' : (state.search ? '没有匹配的动作' : '动作库为空')}</option>${options.map((exercise) => `<option value="${escapeHtml(exercise.slug)}">${escapeHtml(exerciseLabel(exercise))}</option>`).join('')}</select><button class="button button-secondary" type="button" data-add-day="${dayIndex}">添加动作</button></div>
    </section>`;
  }).join('');
}

function updateActionOptions() {
  document.querySelectorAll('[data-add-select]').forEach((select) => {
    const day = state.draft?.days[Number(select.dataset.addSelect)];
    if (!day) return;
    const selectedValue = select.value;
    const options = filteredExercises(day);
    select.innerHTML = `<option value="">${options.length ? '从动作库选择动作…' : (state.search ? '没有匹配的动作' : '动作库为空')}</option>${options.map((exercise) => `<option value="${escapeHtml(exercise.slug)}">${escapeHtml(exerciseLabel(exercise))}</option>`).join('')}`;
    if (options.some((exercise) => exercise.slug === selectedValue)) select.value = selectedValue;
  });
}

function renderEditor() {
  const hasEditor = Boolean(state.isNew || state.selectedPlan);
  $('pageLede').textContent = state.view === 'editor'
    ? '从动作库编排训练日，保存草稿后预览并确认新版本。'
    : '查看已确认计划，开始训练；需要调整时再进入编辑。';
  $('emptyEditor').hidden = hasEditor || state.view === 'workout' || (state.view === 'overview' && Boolean(state.selectedPlan));
  $('editor').hidden = !hasEditor || state.view !== 'editor';
  $('backToOverviewButton').hidden = !(state.selectedPlan && ['active', 'archived'].includes(state.selectedPlan.status));
  if (!hasEditor || state.view !== 'editor') {
    renderOverview();
    renderTraining();
    return;
  }
  const plan = state.selectedPlan;
  $('editorTitle').textContent = plan?.name || '创建个人计划';
  $('planStatus').textContent = planStatusLabel(plan);
  $('planName').value = state.name;
  $('splitType').value = state.splitType;
  $('splitField').hidden = Boolean(plan);
  $('planName').disabled = plan?.status === 'archived';
  $('splitType').disabled = Boolean(plan) || plan?.status === 'archived';
  $('editorTitle').setAttribute('aria-label', plan?.name || '新建个人计划');
  const canEdit = plan?.status !== 'archived';
  $('saveDraftButton').disabled = !canEdit;
  $('saveBottomButton').disabled = !canEdit;
  $('previewButton').disabled = !canEdit;
  $('saveMessage').textContent = plan?.currentVersionNo
    ? `当前正式版本 v${plan.currentVersionNo} 保持不变；草稿确认后才会生成下一版。`
    : '';
  renderDays();
  const history = $('versionHistory');
  const versions = plan?.versions || [];
  history.hidden = versions.length === 0;
  history.innerHTML = versions.length
    ? `<h3>版本历史</h3><ol>${versions.map((version) => `<li class="${version.versionNo === plan.currentVersionNo ? 'current' : ''}">v${version.versionNo}${version.versionNo === plan.currentVersionNo ? ' · 当前' : ''}${version.confirmedAt ? ` · ${escapeHtml(String(version.confirmedAt).slice(0, 10))}` : ''}</li>`).join('')}</ol>`
    : '';
  renderOverview();
  renderTraining();
}

function renderCoachPlan() {
  const card = $('coachPlanCard');
  const plan = state.coachPlan;
  if (!plan) { card.hidden = true; return; }
  const days = plan.version?.content?.days || [];
  const splitLabel = { ppl: '推拉腿', upper_lower: '上下肢', five_day: '五分化', custom: '自定义计划' }[plan.splitType] || plan.splitType || '';
  card.hidden = false;
  card.innerHTML = `<h3>教练计划 · 只读</h3><p>${escapeHtml(plan.name || '当前教练计划')} · ${escapeHtml(splitLabel)}</p><p>修改会员自助计划不会覆盖这份教练计划。</p><ul>${days.map((day) => `<li>${escapeHtml(day.name)}：${(day.exercises || []).map((exercise) => escapeHtml(exercise.exerciseNameZh)).join('、')}</li>`).join('')}</ul><a class="button button-quiet" href="/gym/" style="margin-top:10px">打开健身房训练</a>`;
}

async function refreshPlans(selectId = null) {
  const data = await request('/api/member/plans');
  state.plans = Array.isArray(data.plans) ? data.plans : [];
  if (selectId !== null) state.selectedPlan = state.plans.find((plan) => Number(plan.id) === Number(selectId)) || null;
  else if (!state.selectedPlan && !state.isNew) state.selectedPlan = state.plans.find((plan) => plan.status === 'active') || state.plans[0] || null;
  renderPlanList();
  if (state.selectedPlan) {
    state.isNew = false;
    state.name = state.selectedPlan.name;
    state.splitType = state.selectedPlan.splitType;
    state.draft = copy(state.selectedPlan.draftContent);
  } else if (!state.isNew) {
    state.draft = null;
    state.name = '';
  }
  if (!state.view) state.view = state.selectedPlan && ['active', 'archived'].includes(state.selectedPlan.status) ? 'overview' : (state.selectedPlan || state.isNew ? 'editor' : 'empty');
  renderEditor();
}

async function refreshSessions(restoreDraft = false) {
  const data = await request('/api/member/sessions');
  state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  window.dispatchEvent(new Event('training-records-changed'));
  state.sessionMessage = '';
  renderEditor();
  if (restoreDraft) {
    const draft = state.sessions.find((session) => session.status === 'draft');
    if (draft) await openSession(draft.id, false);
  }
}

async function startNewPlan() {
  state.selectedPlan = null;
  state.isNew = true;
  state.splitType = 'ppl';
  state.name = '';
  state.draft = emptySplit(state.splitType);
  state.view = 'editor';
  $('saveMessage').textContent = '';
  renderPlanList();
  renderEditor();
  $('planName').focus();
}

function selectedContentIsValid() {
  if (!state.draft || !SPLITS[state.splitType]) return false;
  if (state.splitType === 'custom' ? !customDaysValid(state.draft.days) : state.draft.days.length !== SPLITS[state.splitType].days.length) return false;
  for (const day of state.draft.days) {
    if (!day.exercises.length) return false;
    for (const exercise of day.exercises) {
      const sets = Number(exercise.sets); const repMin = Number(exercise.repMin); const repMax = Number(exercise.repMax);
      const rir = Number(exercise.rir); const rest = Number(exercise.restSeconds);
      if (!exercise.exerciseSlug || !Number.isInteger(sets) || sets < 1 || sets > 10
        || !Number.isInteger(repMin) || repMin < 1 || repMin > 100
        || !Number.isInteger(repMax) || repMax < repMin || repMax > 100
        || !Number.isInteger(rir) || rir < 0 || rir > 5
        || !Number.isInteger(rest) || rest < 0 || rest > 600) return false;
      const weight = exercise.targetWeight;
      if (weight !== null && weight !== '' && (!Number.isFinite(Number(weight)) || Number(weight) < 0 || Number(weight) > 1000)) return false;
    }
  }
  return true;
}

async function saveDraft() {
  if (!state.draft) throw new Error('invalid_plan');
  const body = { name: selectedPlanName(), splitType: state.splitType, content: state.draft };
  const created = !state.selectedPlan;
  const result = await request(created ? '/api/member/plans/drafts' : `/api/member/plans/${state.selectedPlan.id}/draft`, {
    method: created ? 'POST' : 'PUT', body: JSON.stringify(body),
  });
  const savedId = result.plan.id;
  state.isNew = false;
  await refreshPlans(savedId);
  $('saveMessage').textContent = '草稿已保存。正式计划版本尚未改变。';
  return state.selectedPlan;
}

function previewHtml() {
  const split = SPLITS[state.splitType];
  return `<p class="lede">${escapeHtml(selectedPlanName())} · ${escapeHtml(split.label)} · ${state.draft.days.length} 个训练日</p>
    ${state.draft.days.map((day, index) => `<article class="preview-day"><h3>第 ${index + 1} 天 · ${escapeHtml(day.name || split.days[index] || `训练日 ${index + 1}`)}</h3>${day.focus ? `<p>训练重点：${escapeHtml(day.focus)}</p>` : ''}${day.exercises.map((exercise) => {
      const action = state.exercises.find((item) => item.slug === exercise.exerciseSlug);
      return `<p>${escapeHtml(exercise.exerciseNameZh || action?.nameZh || '')} · ${exercise.sets} 组 × ${exercise.repMin}–${exercise.repMax} 次 · 目标 RIR ${exercise.rir}${exercise.targetWeight ? ` · ${exercise.targetWeight} kg` : ''}</p>`;
    }).join('')}</article>`).join('')}`;
}

async function openPreview() {
  if (!selectedContentIsValid()) {
    $('saveMessage').textContent = '请为每个训练日添加动作，并检查组数、次数和 RIR。';
    return;
  }
  try {
    await saveDraft();
    $('previewContent').innerHTML = previewHtml();
    $('previewDialog').showModal();
  } catch (error) { $('saveMessage').textContent = localizedError(error); }
}

async function confirmVersion() {
  if (!state.selectedPlan) return;
  const button = $('confirmVersionButton');
  button.disabled = true;
  try {
    await request(`/api/member/plans/${state.selectedPlan.id}/confirm`, { method: 'POST' });
    $('previewDialog').close();
    await refreshPlans(state.selectedPlan.id);
    state.view = 'overview';
    state.sessionMessage = `已确认并生成版本 v${state.selectedPlan.currentVersionNo}。旧版训练快照保持不变。`;
    renderEditor();
  } catch (error) { $('saveMessage').textContent = localizedError(error); }
  finally { button.disabled = false; }
}

async function startNextWorkout() {
  const existingDraft = state.sessions.find((session) => session.status === 'draft');
  if (existingDraft) {
    await openSession(existingDraft.id);
    return;
  }
  const next = state.selectedPlan?.status === 'active' ? nextWorkout(state.selectedPlan) : null;
  if (!next) { state.sessionMessage = '请先确认一份有效计划，再开始训练。'; renderEditor(); return; }
  state.startingSession = true;
  state.sessionMessage = '正在建立训练快照…';
  state.view = 'workout';
  renderEditor();
  try {
    const result = await request(`/api/member/plans/${state.selectedPlan.id}/sessions`, {
      method: 'POST', body: JSON.stringify({ dayNo: next.dayNo }),
    });
    state.openSession = result.session;
    state.sessionMessage = '';
    await refreshSessions(false);
    $('activeSession').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    state.sessionMessage = localizedError(error);
    renderEditor();
  } finally { state.startingSession = false; renderEditor(); }
}

async function openSession(sessionId, scroll = true) {
  if (state.finishingSession) return;
  state.view = 'workout';
  state.openSession = null;
  renderEditor();
  try {
    const result = await request(`/api/member/sessions/${Number(sessionId)}`);
    state.openSession = result.session;
    state.sessionMessage = '';
    renderEditor();
    if (scroll) $('activeSession').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    state.sessionMessage = localizedError(error);
    renderEditor();
  }
}

function readSetRow(rowElement, overrideStatus = null) {
  const value = (name) => rowElement.querySelector(`[data-session-field="${name}"]`)?.value ?? '';
  const actualWeight = value('actualWeight');
  const actualReps = value('actualReps');
  const actualRir = value('actualRir');
  const status = overrideStatus || (rowElement.dataset.status === 'skipped' ? 'skipped' : (actualReps !== '' && actualRir !== '' ? 'completed' : 'pending'));
  const normalize = (input) => status === 'skipped' || status === 'replaced' || input === '' ? null : Number(input);
  return { actualWeight: normalize(actualWeight), actualReps: normalize(actualReps), actualRir: normalize(actualRir), status };
}

function rememberSetRow(session, rowElement, value = readSetRow(rowElement)) {
  if (!sessionLocalValues.has(session)) sessionLocalValues.set(session, new Map());
  sessionLocalValues.get(session).set(rowElement.dataset.sessionSet, value);
}

function savesForSession(session) {
  if (!sessionSaveQueues.has(session)) {
    sessionSaveQueues.set(session, createSetSaveQueue((key, value) => {
      const [exerciseIndex, setNo] = key.split(':');
      return request(`/api/member/sessions/${session.id}/sets/${exerciseIndex}/${setNo}`, { method: 'PATCH', body: JSON.stringify(value) });
    }));
  }
  return sessionSaveQueues.get(session);
}

function showTrainingError(error) {
  state.sessionMessage = localizedError(error);
  $('trainingMessage').textContent = `${localizedError(error)} 当前输入仍保留，请重试。`;
  $('trainingMessage').dataset.state = 'error';
}

async function saveSetRow(rowElement, overrideStatus = null) {
  const session = state.openSession;
  if (!session || session.status !== 'draft') return false;
  const key = rowElement.dataset.sessionSet;
  const [exerciseIndex, setNo] = key.split(':').map(Number);
  const value = readSetRow(rowElement, overrideStatus);
  rememberSetRow(session, rowElement, value);
  if (overrideStatus) {
    rowElement.dataset.status = value.status;
    rowElement.querySelectorAll('[data-session-field]').forEach((input) => {
      input.disabled = value.status === 'skipped';
      if (value.status === 'skipped') input.value = '';
    });
  }
  const statusLabel = rowElement.querySelector('[data-set-status]');
  if (statusLabel) statusLabel.textContent = '正在保存…';
  const saves = savesForSession(session);
  try {
    const result = await saves.save(key, value);
    if (!saves.isLatest(key, value)) return true;
    const existing = session.sets.find((item) => Number(item.exerciseIndex) === exerciseIndex && Number(item.setNo) === setNo);
    if (existing) Object.assign(existing, result.set);
    const local = sessionLocalValues.get(session);
    const unchanged = JSON.stringify(local?.get(key)) === JSON.stringify(value);
    if (unchanged) local.delete(key);
    if (state.openSession === session && rowElement.isConnected && unchanged) {
      rowElement.dataset.status = result.set.status;
      rowElement.classList.toggle('is-completed', result.set.status === 'completed');
      rowElement.classList.toggle('is-skipped', result.set.status === 'skipped');
      if (statusLabel) statusLabel.textContent = result.set.status === 'skipped' ? '已跳过' : result.set.status === 'completed' ? '已保存' : '部分数据已保存';
      const skip = rowElement.querySelector('[data-skip-set]');
      if (skip) skip.textContent = result.set.status === 'skipped' ? '恢复本组' : '跳过本组';
    }
    return true;
  } catch (error) {
    if (state.openSession === session && saves.isLatest(key, value)) {
      if (statusLabel && rowElement.isConnected) statusLabel.textContent = '保存失败，请重试';
      showTrainingError(error);
    }
    return false;
  }
}

async function toggleSkippedSet(button) {
  const [exerciseIndex, setNo] = button.dataset.skipSet.split(':').map(Number);
  const row = button.closest('[data-session-set]');
  const set = state.openSession.sets.find((item) => Number(item.exerciseIndex) === exerciseIndex && Number(item.setNo) === setNo);
  if (!set) return;
  const status = row.dataset.status === 'skipped' ? 'pending' : 'skipped';
  if (status === 'skipped' && !window.confirm('确认跳过这一组？完成训练前仍可恢复。')) return;
  await saveSetRow(row, status);
}

async function completeSession() {
  if (!state.openSession || state.openSession.status !== 'draft' || state.finishingSession) return;
  const session = state.openSession;
  const root = $('activeSession');
  state.finishingSession = true;
  $('backFromTrainingButton').disabled = true;
  root.querySelectorAll('input,button').forEach((input) => { input.disabled = true; });
  const completeButton = root.querySelector('[data-complete-session]');
  if (completeButton) completeButton.textContent = '正在保存…';
  try {
    const saved = await Promise.all([...root.querySelectorAll('[data-session-set]')].map((row) => saveSetRow(row)));
    await savesForSession(session).flush();
    if (saved.some((success) => !success)) throw new Error('set_save_failed');
    const result = await request(`/api/member/sessions/${session.id}/complete`, { method: 'POST', body: JSON.stringify({}) });
    state.openSession = result.session;
    state.sessionMessage = '训练已完成，逐组记录和当时计划版本已保存。';
    await refreshSessions(false);
  } catch (error) {
    showTrainingError(error);
  } finally {
    state.finishingSession = false;
    $('backFromTrainingButton').disabled = false;
    if (state.openSession === session) {
      root.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      root.querySelectorAll('[data-session-set]').forEach((row) => row.querySelectorAll('input').forEach((input) => { input.disabled = row.dataset.status === 'skipped'; }));
      if (completeButton?.isConnected) completeButton.textContent = '完成训练';
    }
  }
}

async function abandonSession() {
  if (!state.openSession || state.openSession.status !== 'draft' || state.finishingSession) return;
  if (!window.confirm('放弃这场训练？已完成的其他训练记录不会受影响。')) return;
  try {
    await request(`/api/member/sessions/${state.openSession.id}/abandon`, { method: 'POST', body: JSON.stringify({}) });
    state.openSession = null;
    state.sessionMessage = '本次未完成训练已标记为放弃，既有训练记录保留。';
    state.view = state.selectedPlan && ['active', 'archived'].includes(state.selectedPlan.status) ? 'overview' : (state.selectedPlan || state.isNew ? 'editor' : 'empty');
    await refreshSessions(false);
    state.sessionMessage = '本次未完成训练已标记为放弃，既有训练记录保留。';
    renderEditor();
  } catch (error) {
    state.sessionMessage = localizedError(error);
    renderTraining();
  }
}

function newExercise(exercise) {
  return {
    exerciseId: exercise.id,
    exerciseSlug: exercise.slug,
    exerciseNameZh: exercise.nameZh,
    primaryMuscleZh: exercise.primaryMuscleZh || exercise.primaryMuscle,
    secondaryMusclesZh: exercise.secondaryMusclesZh || [],
    equipment: exercise.equipment,
    equipmentZh: exercise.equipmentZh || exercise.equipment,
    mediaPath: exercise.mediaPath,
    cueZh: exercise.cueZh,
    sets: 3, repMin: 8, repMax: 12, rir: 2, restSeconds: 90, targetWeight: null, note: '',
  };
}

async function load() {
  if (!token()) {
    showNotice('登录后，具备有效会员授权的账号可以管理自己的计划。', 'info', true);
    return;
  }
  try {
    state.viewer = await request('/api/auth/me');
    const superAdmin = state.viewer.isSuperAdmin === true || state.viewer.roles?.includes('superadmin');
    if (!superAdmin && state.viewer.entitlements?.memberPlans !== true) {
      showNotice('当前账号没有有效会员授权。教练关系不会替代会员自助计划权限。', 'error', true);
      return;
    }
    $('accountBadge').textContent = state.viewer.username || '已登录';
    $('accountBadge').hidden = false;
    $('logoutButton').hidden = false;
    const data = await request('/api/gym/exercises');
    state.exercises = Array.isArray(data.exercises) ? data.exercises : [];
    await refreshPlans();
    try {
      const coach = await request('/api/gym/plan');
      state.coachPlan = coach.plan || null;
      renderCoachPlan();
    } catch { /* 教练计划为只读补充信息，不阻断会员计划编辑。 */ }
    $('notice').hidden = true;
    $('memberApp').hidden = false;
    await refreshSessions(true);
  } catch (error) {
    if (error.status === 403 || error.message === 'membership_required') showNotice(localizedError(error), 'error', true);
    else if (error.status === 401) showNotice('登录状态已失效，请重新登录。', 'error', true);
    else showNotice(localizedError(error), 'error', true);
  }
}

$('newPlanButton').addEventListener('click', startNewPlan);
document.querySelector('[data-action="new-plan"]').addEventListener('click', startNewPlan);
$('planList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-plan-id]');
  if (!button) return;
  refreshPlans(button.dataset.planId).then(() => {
    state.view = state.selectedPlan && ['active', 'archived'].includes(state.selectedPlan.status) ? 'overview' : 'editor';
    renderEditor();
  }).catch((error) => showNotice(localizedError(error), 'error'));
});
$('overviewEditButton').addEventListener('click', () => {
  if (!state.selectedPlan || state.selectedPlan.status === 'archived') return;
  state.view = 'editor';
  renderEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('overviewStartButton').addEventListener('click', startNextWorkout);
$('backToOverviewButton').addEventListener('click', () => {
  if (!state.selectedPlan || !['active', 'archived'].includes(state.selectedPlan.status)) return;
  state.view = 'overview';
  state.sessionMessage = '';
  renderEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('backFromTrainingButton').addEventListener('click', () => {
  if (state.finishingSession) return;
  state.view = state.selectedPlan && ['active', 'archived'].includes(state.selectedPlan.status) ? 'overview' : (state.selectedPlan || state.isNew ? 'editor' : 'empty');
  state.sessionMessage = '';
  renderEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('planName').addEventListener('input', () => { state.name = $('planName').value; });
$('splitType').addEventListener('change', () => {
  if (!state.isNew) return;
  state.splitType = $('splitType').value;
  state.draft = emptySplit(state.splitType);
  renderDays();
});
$('addTrainingDayButton').addEventListener('click', () => {
  if (state.splitType !== 'custom' || !state.draft) return;
  if (state.draft.days.length >= 7) {
    $('saveMessage').textContent = '自定义计划最多安排 7 个训练日。';
    return;
  }
  state.draft.days.push({ name: `训练日 ${state.draft.days.length + 1}`, focus: '', exercises: [] });
  renderDays();
});
$('exerciseSearch').addEventListener('input', () => { state.search = $('exerciseSearch').value; updateActionOptions(); });
$('dayList').addEventListener('input', (event) => {
  const target = event.target;
  if (target.hasAttribute('data-day-name')) state.draft.days[Number(target.dataset.dayName)].name = target.value;
  if (target.hasAttribute('data-day-focus')) state.draft.days[Number(target.dataset.dayFocus)].focus = target.value;
  if (target.dataset.field) {
    const value = target.value === '' && target.dataset.field === 'targetWeight' ? null : Number(target.value);
    state.draft.days[Number(target.dataset.day)].exercises[Number(target.dataset.exercise)][target.dataset.field] = value;
  }
});
$('dayList').addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.replaceExercise !== undefined) {
    const picked = state.exercises.find((item) => item.slug === target.value);
    if (picked) Object.assign(state.draft.days[Number(target.dataset.day)].exercises[Number(target.dataset.replaceExercise)], newExercise(picked));
  }
});
$('dayList').addEventListener('click', (event) => {
  const removeTrainingDay = event.target.closest('[data-remove-training-day]');
  const add = event.target.closest('[data-add-day]');
  const remove = event.target.closest('[data-remove-day]');
  if (removeTrainingDay) {
    if (state.splitType !== 'custom') return;
    if (state.draft.days.length <= 1) {
      $('saveMessage').textContent = '自定义计划至少保留 1 个训练日。';
      return;
    }
    state.draft.days.splice(Number(removeTrainingDay.dataset.removeTrainingDay), 1);
    renderDays();
  } else if (add) {
    const dayIndex = Number(add.dataset.addDay);
    const select = document.querySelector(`[data-add-select="${dayIndex}"]`);
    const exercise = state.exercises.find((item) => item.slug === select?.value);
    if (!exercise) { $('saveMessage').textContent = '先从动作库选择一个动作。'; return; }
    if (state.draft.days[dayIndex].exercises.length >= 20) { $('saveMessage').textContent = '每个训练日最多添加 20 个动作。'; return; }
    state.draft.days[dayIndex].exercises.push(newExercise(exercise));
    renderDays();
  } else if (remove) {
    state.draft.days[Number(remove.dataset.removeDay)].exercises.splice(Number(remove.dataset.removeExercise), 1);
    renderDays();
  }
});
$('saveDraftButton').addEventListener('click', async () => {
  $('saveDraftButton').disabled = true;
  $('saveMessage').textContent = '正在保存…';
  try { await saveDraft(); } catch (error) { $('saveMessage').textContent = localizedError(error); }
  finally { $('saveDraftButton').disabled = false; }
});
$('saveBottomButton').addEventListener('click', async () => {
  $('saveBottomButton').disabled = true;
  $('saveMessage').textContent = '正在保存…';
  try { await saveDraft(); } catch (error) { $('saveMessage').textContent = localizedError(error); }
  finally { $('saveBottomButton').disabled = false; }
});
$('previewButton').addEventListener('click', openPreview);
$('confirmVersionButton').addEventListener('click', confirmVersion);
$('sessionList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-session]');
  if (button) openSession(button.dataset.openSession);
});
$('activeSession').addEventListener('input', (event) => {
  if (event.target.matches('[data-session-field]') && state.openSession?.status === 'draft') {
    const row = event.target.closest('[data-session-set]');
    rememberSetRow(state.openSession, row);
    row.querySelector('[data-set-status]').textContent = '尚未保存';
  }
});
$('activeSession').addEventListener('change', (event) => {
  if (event.target.matches('[data-session-field]') && state.openSession?.status === 'draft') saveSetRow(event.target.closest('[data-session-set]'));
});
$('activeSession').addEventListener('click', (event) => {
  const skip = event.target.closest('[data-skip-set]');
  if (skip) toggleSkippedSet(skip);
  else if (event.target.closest('[data-complete-session]')) completeSession();
  else if (event.target.closest('[data-abandon-session]')) abandonSession();
});
$('logoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* 本地令牌仍须失效。 */ }
  localStorage.removeItem(TOKEN_KEY);
  location.replace('/');
});

load();
