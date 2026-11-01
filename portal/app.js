const TOKEN_KEY = 'thinMuscleAuthToken';
const { sanitizeReturnTo, extractInviteToken } = window.PortalRoutes || { sanitizeReturnTo: () => '/', extractInviteToken: () => null };
const params = new URLSearchParams(location.search);
const returnTo = sanitizeReturnTo(params.get('returnTo'));
const inviteToken = extractInviteToken(location.href, location.origin) || '';
const state = { mode: inviteToken ? 'register' : 'login', viewer: null, relationship: null };
const $ = (id) => document.getElementById(id);

function savedToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(savedToken() ? { Authorization: `Bearer ${savedToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showError(message) {
  $('authMessage').textContent = message;
}

function setAuthMode(mode) {
  state.mode = mode;
  const registering = mode === 'register';
  $('authTitle').textContent = registering ? '创建学员账号' : '登录你的账号';
  $('authSubmit').textContent = registering ? '创建账号并登录' : '登录';
  $('modeToggle').textContent = registering ? '已有账号？返回登录' : '没有账号？注册学员账号';
  $('password').autocomplete = registering ? 'new-password' : 'current-password';
  showError('');
}

function setLoggedOut(message = '') {
  state.viewer = null;
  state.relationship = null;
  $('dashboard').hidden = true;
  $('authPanel').hidden = false;
  $('accountName').hidden = true;
  $('logoutButton').hidden = true;
  $('pageTitle').textContent = '训练安排，从这里开始';
  $('pageDescription').textContent = '登录后进入你的居家训练、健身房计划与训练记录。';
  $('inviteBadge').hidden = !inviteToken;
  if (inviteToken) $('inviteBadge').textContent = '教练邀请';
  if (message) showError(message);
}

async function loadViewer() {
  const viewer = await api('/api/auth/me');
  let gym = null;
  try { gym = await api('/api/gym/me'); } catch (error) {
    if (error.status === 401) throw error;
  }
  state.viewer = viewer;
  state.relationship = gym?.relationship || null;
  renderDashboard();
  return viewer;
}

function renderDashboard() {
  const viewer = state.viewer;
  if (!viewer) return;
  const roles = Array.isArray(viewer.roles) ? viewer.roles : [];
  const superAdmin = viewer.isSuperAdmin === true || roles.includes('superadmin');
  const homeAccess = superAdmin || viewer.entitlements?.homeTraining === true;
  const planAccess = superAdmin || viewer.entitlements?.memberPlans === true;
  const membership = viewer.membership || { active: false };
  $('authPanel').hidden = true;
  $('dashboard').hidden = false;
  $('accountName').textContent = viewer.username;
  $('accountName').hidden = false;
  $('logoutButton').hidden = false;
  $('pageTitle').textContent = `你好，${viewer.username}`;
  $('pageDescription').textContent = superAdmin ? '总管理员账号已开放全部训练与管理权限。' : '这里会根据你的会员期限与教练关系显示可用功能。';
  $('roleSummary').textContent = superAdmin ? '总管理员' : roles.map((role) => ({ admin: '管理员', coach: '教练', student: '学员' }[role] || role)).join(' · ') || '普通账号';

  const chips = [];
  if (superAdmin) chips.push('<span class="access-chip active">总管理员 · 全权限</span>');
  else if (membership.active) chips.push(`<span class="access-chip active">会员有效 · ${escapeHtml(membership.startsOn)} 至 ${escapeHtml(membership.expiresOn)}</span>`);
  else chips.push('<span class="access-chip">当前无有效会员</span>');
  if (homeAccess) chips.push('<span class="access-chip active">居家训练已开放</span>');
  if (planAccess) chips.push('<span class="access-chip active">会员自助计划已开放</span>');
  $('accessSummary').innerHTML = chips.join('');

  const homeAction = homeAccess
    ? '<a class="module-action" href="/home/">进入居家训练 <span class="arrow" aria-hidden="true">→</span></a>'
    : '<span class="module-action">会员授权后开放 <span class="arrow" aria-hidden="true">↗</span></span>';
  const memberAction = planAccess
    ? '<a class="module-action" href="/member/">管理我的训练计划 <span class="arrow" aria-hidden="true">→</span></a>'
    : '<span class="module-action">需要有效会员期限 <span class="arrow" aria-hidden="true">↗</span></span>';
  $('moduleGrid').innerHTML = `<article class="module-card${homeAccess ? ' available' : ' locked'}"><h3>居家训练</h3><p>${homeAccess ? '进入你的薄肌训练计划、计时与历史记录。' : '居家训练仅向已获授权的会员开放。'}</p>${homeAction}</article>
    <article class="module-card available"><h3>健身房训练</h3><p>查看教练为你安排的计划，或进入健身房训练工作台。</p><a class="module-action" href="/gym/">进入健身房训练 <span class="arrow" aria-hidden="true">→</span></a></article>
    <article class="module-card${planAccess ? ' available' : ' locked'}"><h3>会员自助计划</h3><p>${planAccess ? '创建、调整和确认自己的训练计划版本。' : '会员可自定义推拉腿、上下肢或五分化计划。'}</p>${memberAction}</article>
    ${(roles.includes('admin') || superAdmin) ? '<article class="module-card available"><h3>管理工作台</h3><p>管理教练资格、会员授权、动作库与照片审核。</p><a class="module-action" href="/gym/">打开管理工作台 <span class="arrow" aria-hidden="true">→</span></a></article>' : ''}`;

  const relation = state.relationship;
  const coachNotice = $('coachNotice');
  if (relation?.coach?.username) {
    coachNotice.innerHTML = `<strong>教练计划</strong><span>已绑定教练：${escapeHtml(relation.coach.username)}。有效教练关系允许访问已发布的健身房计划。</span>`;
    coachNotice.hidden = false;
  } else {
    coachNotice.hidden = true;
  }
  $('invitePanel').hidden = !inviteToken;
  $('dashboardMessage').textContent = '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function redirectAfterAuth(path = returnTo) {
  location.replace(path === '/' ? '/' : path);
}

async function acceptInvitation() {
  if (!inviteToken) return;
  $('acceptInvite').disabled = true;
  try {
    await api('/api/coach/invitations/accept', {
      method: 'POST', body: JSON.stringify({ token: inviteToken }),
    });
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    $('dashboardMessage').textContent = '教练邀请已接受，正在打开健身房工作台…';
    location.replace('/gym/');
  } catch (error) {
    $('dashboardMessage').textContent = error.message === 'already_has_active_coach'
      ? '这个账号已有一位有效教练，无法同时接受另一条邀请。'
      : error.message === 'coach_role_inactive'
        ? '邀请教练当前资格已失效，请联系教练。'
        : '邀请无效、过期或已被使用。';
    $('acceptInvite').disabled = false;
  }
}

$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('authSubmit');
  button.disabled = true;
  showError('');
  const registering = state.mode === 'register';
  const endpoint = registering ? '/api/auth/register' : '/api/auth/login';
  const body = { username: $('username').value.trim(), password: $('password').value };
  if (registering && inviteToken) body.invitationToken = inviteToken;
  try {
    const response = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    localStorage.setItem(TOKEN_KEY, response.token);
    if (registering && inviteToken) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      location.replace('/gym/');
      return;
    }
    await loadViewer();
    if (inviteToken) await acceptInvitation();
    else if (returnTo !== '/') redirectAfterAuth();
  } catch (error) {
    const messages = {
      bad_credentials: '用户名或密码不正确。', exists: '这个用户名已被使用。',
      invalid: '用户名或密码格式不正确。', unauthorized: '登录状态已失效，请重新登录。',
      invalid_invitation: '请使用教练提供的有效邀请链接。',
      invitation_not_found_or_expired: '邀请无效、过期或已被使用。',
      coach_role_inactive: '邀请教练当前资格已失效，请联系教练。',
      coach_capacity_unconfigured: '教练尚未配置学员名额，暂时无法接受邀请。',
      coach_capacity_full: '教练的学员名额已满，暂时无法接受邀请。',
      already_has_active_coach: '这个账号已有一位有效教练，无法同时接受另一条邀请。',
      invite_encryption_not_configured: '邀请服务暂不可用，请联系教练稍后重试。',
    };
    if (error.message === 'db' || error instanceof TypeError) showError('服务暂不可用，请稍后重试。');
    else showError(messages[error.message] || '暂时无法完成请求，请检查账号信息后重试。');
  } finally {
    button.disabled = false;
  }
});

$('modeToggle').addEventListener('click', () => setAuthMode(state.mode === 'register' ? 'login' : 'register'));
$('acceptInvite').addEventListener('click', acceptInvitation);
$('logoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem(TOKEN_KEY);
  setAuthMode('login');
  setLoggedOut();
});

async function boot() {
  $('inviteBadge').hidden = !inviteToken;
  if (inviteToken) $('inviteBadge').textContent = '教练邀请';
  if (!savedToken()) {
    if (inviteToken) setAuthMode('register');
    return setLoggedOut();
  }
  try {
    await loadViewer();
    if (inviteToken) $('invitePanel').hidden = false;
    else if (returnTo !== '/') redirectAfterAuth();
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      setLoggedOut('登录已失效，请重新登录。');
    } else {
      setLoggedOut('暂时无法连接训练服务，请稍后重试。');
    }
  }
}

boot();
