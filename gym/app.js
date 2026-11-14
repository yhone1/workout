import { api, jsonBody, token } from './api.js';
import { renderAdmin } from './admin.js';
import { renderCoach } from './coach.js';
import { renderFeed, renderStudent } from './student.js';

const TOKEN_KEY='thinMuscleAuthToken';
const STUDENT_TABS=[['plan','我的计划'],['sessions','训练记录'],['measurements','身体数据'],['photos','我的照片']];
const VIEW_TITLES={plan:'计划',mine:'我的',feed:'展示圈',coach:'教练工作台',admin:'管理工作台'};
const state={user:null,relation:null,mode:'login',tab:'plan',studentSection:'plan',coachSection:'students',adminSection:'coaches',coachStudentId:null,selectedPlanId:null,toastTimer:null,objectUrls:new Set(),feedItems:[],feedBefore:null};
const $=(id)=>document.getElementById(id);

function notify(message){
  const toast=$('toast');toast.textContent=message;toast.classList.add('visible');clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>toast.classList.remove('visible'),3000);
}

function roleLabel(roles){return (roles||[]).map((role)=>({superadmin:'总管理员',admin:'管理员',coach:'教练',student:'学员'}[role]||role)).join(' / ')||'普通账号';}

function redirectToPortal(){
  const invite=new URLSearchParams(location.hash.slice(1)).get('invite');
  const url=new URL('/',location.origin);url.searchParams.set('returnTo','/gym/');
  if(invite)url.hash=`invite=${encodeURIComponent(invite)}`;
  location.replace(`${url.pathname}${url.search}${url.hash}`);
}

function setLoggedOut(){
  state.user=null;state.relation=null;state.objectUrls.forEach((url)=>URL.revokeObjectURL(url));state.objectUrls.clear();
  $('authPanel').hidden=false;$('workspace').hidden=true;$('accountPill').hidden=true;
  $('railAccount').textContent='未登录';$('railRole').textContent='';
  $('pageTitle').textContent='登录';$('gymSectionNav').innerHTML='';
}

async function refresh(){
  if(!token()||new URLSearchParams(location.hash.slice(1)).has('invite'))return redirectToPortal();
  try{
    const data=await api('/api/gym/me');state.user=data.user;state.relation=data.relationship;
    $('authPanel').hidden=true;$('workspace').hidden=false;
    if(!VIEW_TITLES[state.tab])state.tab='plan';
    syncShell();renderSectionNav();await renderPanel();
  }catch(error){
    if(error.status===401){localStorage.removeItem(TOKEN_KEY);redirectToPortal();}
    else{
      $('authPanel').hidden=true;$('workspace').hidden=false;$('gymSectionNav').innerHTML='';
      $('workspaceContent').innerHTML='<div class="empty-state">工作台暂时无法连接，请稍后重试。</div>';
      notify('读取工作台失败，请稍后重试。');
    }
  }
}

function syncShell(){
  const navKey=state.tab==='plan'?'plan':'mine';
  document.querySelectorAll('[data-gym-tab]').forEach((button)=>button.classList.toggle('active',button.dataset.gymTab===navKey));
  $('pageTitle').textContent=VIEW_TITLES[state.tab]||'计划';
  $('railAccount').textContent=state.user?.username||'未登录';
  $('railRole').textContent=state.user?roleLabel(state.user.roles):'';
  $('accountPill').textContent=state.user?`${state.user.username} · ${roleLabel(state.user.roles)}`:'';
  $('accountPill').hidden=!state.user;
  $('gymCalendar').hidden=state.tab!=='plan';
}

function renderSectionNav(){
  const host=$('gymSectionNav');
  if(state.tab!=='plan'){host.innerHTML='';return;}
  host.innerHTML=`<nav class="subnav" aria-label="计划菜单">${STUDENT_TABS.map(([id,label])=>`<button class="subtab${state.studentSection===id?' active':''}" type="button" data-student-section="${id}">${label}</button>`).join('')}</nav>`;
  host.querySelectorAll('[data-student-section]').forEach((button)=>button.addEventListener('click',()=>{
    state.studentSection=button.dataset.studentSection;renderSectionNav();renderPanel();
  }));
}

async function renderPanel(){
  const root=$('workspaceContent');
  syncShell();
  if(state.tab==='plan')return renderStudent({state,root,notify});
  if(state.tab==='mine')return renderMine(root);
  root.innerHTML='';
  const back=document.createElement('div');back.className='back-row';
  back.innerHTML='<button class="button small" type="button" data-back-mine>← 我的</button>';
  const host=document.createElement('div');host.id='subView';
  root.append(back,host);
  back.querySelector('[data-back-mine]').addEventListener('click',()=>{state.tab='mine';renderPanel();});
  if(state.tab==='feed')return renderFeed({state,root:host,notify});
  if(state.tab==='coach')return renderCoach({state,root:host,notify,rerender:renderPanel});
  return renderAdmin({state,root:host,notify});
}

function renderMine(root){
  const roles=state.user?.roles||[];
  const isCoach=roles.includes('coach')||roles.includes('admin')||roles.includes('superadmin');
  const isAdmin=roles.includes('admin')||roles.includes('superadmin');
  const relation=state.relation?.coach?`已绑定教练 ${state.relation.coach.username}`:state.relation?.student?`已绑定学员 ${state.relation.student.username}`:'尚未绑定教练';
  root.innerHTML=`<div class="data-list mine-list">
    <article class="data-row"><div class="data-main"><strong>${escape(state.user?.username||'')}</strong><small>${escape(roleLabel(roles))} · ${escape(relation)}</small></div></article>
    <button class="data-row mine-entry" type="button" data-mine-view="feed"><span class="data-main"><strong>展示圈</strong><small>查看管理员审核通过的公开训练照片</small></span><span class="mine-chevron" aria-hidden="true">›</span></button>
    ${isCoach?`<button class="data-row mine-entry" type="button" data-mine-view="coach"><span class="data-main"><strong>教练工作台</strong><small>学员、邀请与教练计划</small></span><span class="mine-chevron" aria-hidden="true">›</span></button>`:''}
    ${isAdmin?`<button class="data-row mine-entry" type="button" data-mine-view="admin"><span class="data-main"><strong>管理工作台</strong><small>教练资格、名额、会员授权与内容审核</small></span><span class="mine-chevron" aria-hidden="true">›</span></button>`:''}
    <button class="data-row mine-entry" type="button" data-mine-logout><span class="data-main"><strong>退出登录</strong><small>退出当前账号，训练记录保留</small></span><span class="mine-chevron" aria-hidden="true">›</span></button>
  </div>`;
  root.querySelectorAll('[data-mine-view]').forEach((button)=>button.addEventListener('click',()=>{state.tab=button.dataset.mineView;renderPanel();}));
  root.querySelector('[data-mine-logout]').addEventListener('click',logout);
}

function escape(value){return String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}

function authError(error){
  const messages={bad_credentials:'用户名或密码不正确。',exists:'这个用户名已被使用。',invalid:'用户名或密码格式不正确。',unauthorized:'登录已失效，请重新登录。'};
  $('authMessage').textContent=messages[error.message]||'暂时无法完成请求，请稍后重试。';
}

async function submitAuth(event){
  event.preventDefault();const username=$('username').value.trim();const password=$('password').value;
  const route=state.mode==='register'?'/api/auth/register':'/api/auth/login';
  $('authSubmit').disabled=true;
  try{
    const data=await api(route,{method:'POST',body:jsonBody({username,password})});
    localStorage.setItem(TOKEN_KEY,data.token);$('authMessage').textContent='';await refresh();
    const invite=new URLSearchParams(location.hash.slice(1)).get('invite');
    if(invite){
      try{
        await api('/api/coach/invitations/accept',{method:'POST',body:jsonBody({token:invite})});
        history.replaceState(null,'','/gym/');notify('教练邀请已接受。');await refresh();
      }catch(error){notify(error.message==='already_has_active_coach'?'账号已有一位有效教练。':'登录成功，但邀请无效、过期或已被使用。');}
    }
  }catch(error){authError(error);}
  finally{$('authSubmit').disabled=false;}
}

async function logout(){
  try{await api('/api/auth/logout',{method:'POST'});}catch{}
  localStorage.removeItem(TOKEN_KEY);state.tab='plan';state.studentSection='plan';state.coachStudentId=null;state.selectedPlanId=null;state.feedItems=[];location.replace('/');
}

$('authForm').addEventListener('submit',submitAuth);
$('toggleRegister').addEventListener('click',()=>{
  state.mode=state.mode==='register'?'login':'register';
  $('authHeading').textContent=state.mode==='register'?'创建学员账号':'登录后继续';
  $('authSubmit').textContent=state.mode==='register'?'创建账号并登录':'登录';
  $('password').autocomplete=state.mode==='register'?'new-password':'current-password';
  $('toggleRegister').textContent=state.mode==='register'?'已有账号？返回登录':'没有账号？注册学员账号';
  $('authMessage').textContent='';
});
document.querySelectorAll('[data-gym-tab]').forEach((button)=>button.addEventListener('click',()=>{
  state.tab=button.dataset.gymTab;renderSectionNav();renderPanel();
}));

const requestedView=new URLSearchParams(location.search).get('view');
if(requestedView==='mine')state.tab='mine';
if(new URLSearchParams(location.hash.slice(1)).has('invite')){
  state.mode='register';$('authHeading').textContent='创建学员账号并接受邀请';$('authSubmit').textContent='注册并加入教练';$('password').autocomplete='new-password';
}
refresh();
