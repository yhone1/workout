import { api, jsonBody, token } from './api.js';
import { renderAdmin } from './admin.js';
import { renderCoach } from './coach.js';
import { renderFeed, renderStudent } from './student.js';

const TOKEN_KEY='thinMuscleAuthToken';
const state={user:null,relation:null,mode:'login',tab:'student',studentSection:'plan',coachSection:'students',adminSection:'coaches',coachStudentId:null,selectedPlanId:null,toastTimer:null,objectUrls:new Set(),feedItems:[],feedBefore:null};
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
  $('workspace').hidden=true;$('authPanel').hidden=false;$('accountPill').hidden=true;
}

async function refresh(){
  if(!token()||new URLSearchParams(location.hash.slice(1)).has('invite'))return redirectToPortal();
  try{
    const data=await api('/api/gym/me');state.user=data.user;state.relation=data.relationship;
    $('authPanel').hidden=true;$('workspace').hidden=false;$('accountPill').textContent=`${state.user.username} · ${roleLabel(state.user.roles)}`;$('accountPill').hidden=false;
    renderTabs();await renderPanel();
  }catch(error){
    if(error.status===401){localStorage.removeItem(TOKEN_KEY);redirectToPortal();}
    else{
      $('authPanel').hidden=true;$('workspace').hidden=false;
      $('workspaceContent').innerHTML='<div class="empty-state">工作台暂时无法连接，请稍后重试。<br><a class="back-link" href="/">返回训练中心</a></div>';
      notify('读取工作台失败，请稍后重试。');
    }
  }
}

function renderTabs(){
  const tabs=[{id:'student',label:'我的计划'},{id:'feed',label:'展示圈'}];
  if(state.user.roles.includes('coach')||state.user.roles.includes('admin')||state.user.roles.includes('superadmin'))tabs.push({id:'coach',label:'教练工作台'});
  if(state.user.roles.includes('admin')||state.user.roles.includes('superadmin'))tabs.push({id:'admin',label:'管理工作台'});
  tabs.push({id:'logout',label:'退出登录'});
  if(!tabs.some((item)=>item.id===state.tab))state.tab='student';
  $('roleNav').innerHTML=tabs.map((item)=>`<button type="button" class="role-tab${state.tab===item.id?' active':''}" data-tab="${item.id}">${item.label}</button>`).join('');
  $('roleNav').querySelectorAll('[data-tab]').forEach((button)=>button.addEventListener('click',async()=>{
    if(button.dataset.tab==='logout')return logout();
    state.tab=button.dataset.tab;renderTabs();await renderPanel();
  }));
}

async function renderPanel(){
  const root=$('workspaceContent');
  if(state.tab==='coach')return renderCoach({state,root,notify,rerender:renderPanel});
  if(state.tab==='admin')return renderAdmin({state,root,notify});
  if(state.tab==='feed')return renderFeed({state,root,notify});
  return renderStudent({state,root,notify});
}

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
  localStorage.removeItem(TOKEN_KEY);state.tab='student';state.coachStudentId=null;state.selectedPlanId=null;state.feedItems=[];location.replace('/');
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

if(new URLSearchParams(location.hash.slice(1)).has('invite')){
  state.mode='register';$('authHeading').textContent='创建学员账号并接受邀请';$('authSubmit').textContent='注册并加入教练';$('password').autocomplete='new-password';
}
refresh();
