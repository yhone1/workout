import { api, attachPrivateImages, escapeHtml, formatDate, jsonBody, revokeRenderedImages } from './api.js';

const STUDENT_SECTIONS=[['plan','我的计划'],['sessions','训练记录'],['measurements','身体数据'],['photos','我的照片']];

export async function renderStudent({state,root,notify}){
  const section=state.studentSection||'plan';
  root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">MY GYM TRAINING</p><h2>学员空间</h2></div></div><nav class="subnav" aria-label="学员空间菜单">${STUDENT_SECTIONS.map(([id,label])=>`<button type="button" class="subtab${section===id?' active':''}" data-student-section="${id}">${label}</button>`).join('')}</nav><div id="studentSectionContent"></div>`;
  root.querySelectorAll('[data-student-section]').forEach((button)=>button.addEventListener('click',()=>{state.studentSection=button.dataset.studentSection;renderStudent({state,root,notify});}));
  const content=root.querySelector('#studentSectionContent');
  if(section==='sessions')return renderStudentSessions({state,content});
  if(section==='measurements')return renderStudentMeasurements({state,content,notify});
  if(section==='photos')return renderMyPhotos({state,content,notify});
  return renderStudentPlan({state,content,notify});
}

async function renderStudentPlan({state,content,notify}){
  content.innerHTML=`<div id="studentPlan"><div class="empty-state">正在读取教练计划…</div></div>${!state.relation||state.relation.student?.id===state.user.id?`<form class="toolbar" id="acceptInviteForm"><label class="field-label">教练邀请链接<input class="field-input" id="inviteToken" autocomplete="off" placeholder="粘贴本站完整链接（兼容旧邀请码）"></label><button class="button" type="submit">接受邀请</button></form>`:''}`;
  const inviteFromLink=window.PortalRoutes?.extractInviteToken(location.href,location.origin);
  if(content.querySelector('#inviteToken')&&inviteFromLink)content.querySelector('#inviteToken').value=location.href;
  content.querySelector('#acceptInviteForm')?.addEventListener('submit',async(event)=>{
    event.preventDefault();const pasted=content.querySelector('#inviteToken').value.trim();
    const token=window.PortalRoutes?.extractInviteToken(pasted,location.origin);
    if(!token){notify('请粘贴本站教练邀请链接或有效的一次性邀请码。');return;}
    try{await api('/api/coach/invitations/accept',{method:'POST',body:jsonBody({token})});history.replaceState(null,'','/gym/');notify('已加入教练计划。');state.relation=undefined;location.reload();}
    catch(error){notify(error.message==='already_has_active_coach'?'你已有一位有效教练。':error.message==='invitation_not_found_or_expired'?'邀请码无效、过期或已使用。':'接受邀请失败。');}
  });
  try{
    const [planData]=await Promise.all([api('/api/gym/plan')]);
    const plan=planData.plan;
    const host=content.querySelector('#studentPlan');
    if(!plan?.version?.content){host.innerHTML=`<div class="empty-state">${state.relation?.coach?`教练 ${escapeHtml(state.relation.coach.username)} 已与你关联，计划发布后会显示在这里。`:'你还没有已发布的教练计划。接受邀请后，教练可以为你创建。'}</div>`;return;}
    host.innerHTML=`<div class="split-heading"><div><p class="eyebrow">COACH-PUBLISHED PLAN</p><h3>${escapeHtml(plan.name)}</h3><p class="inline-message">${escapeHtml({ppl:'推 / 拉 / 腿',upper_lower:'上下肢',five_day:'五分化'}[plan.splitType]||plan.splitType)} · 版本 ${plan.version.versionNo} · 当前只读</p></div>${state.relation?.coach?`<span class="badge">教练 ${escapeHtml(state.relation.coach.username)}</span>`:''}</div><div class="plan-days">${plan.version.content.days.map((day)=>`<article class="plan-day-card"><h4>第 ${day.dayNo} 天 · ${escapeHtml(day.name)}</h4><p>${escapeHtml(day.focus||'')}</p>${day.exercises.map((exercise)=>`<div class="plan-summary-exercise"><div><strong>${escapeHtml(exercise.exerciseNameZh||exercise.exerciseSlug)}</strong><small>${escapeHtml(exercise.primaryMuscleZh||'')}</small></div><span>${exercise.sets} 组 · ${exercise.repMin}-${exercise.repMax} 次 · RIR ${exercise.rir}${exercise.targetWeight==null?'':` · ${exercise.targetWeight} kg`}</span>${exercise.mediaPath?`<img class="catalog-thumb" src="${escapeHtml(exercise.mediaPath)}" alt="${escapeHtml(exercise.exerciseNameZh)}" loading="lazy">`:''}<small>${escapeHtml(exercise.cueZh||exercise.note||'')}</small></div>`).join('')}</article>`).join('')}</div>`;
  }catch{content.querySelector('#studentPlan').innerHTML='<div class="empty-state">暂时无法读取计划。</div>';}
}

async function renderStudentSessions({state,content}){
  content.innerHTML='<div class="section-heading section-heading-tight"><div><h3>训练记录</h3><p class="panel-intro">教练代记的逐组数据在这里查看；已完成记录为只读。</p></div></div><div id="studentSessionList" class="data-list"><div class="empty-state">正在读取训练记录…</div></div><div id="studentSessionDetail"></div>';
  try{
    const {sessions}=await api('/api/gym/sessions');const list=content.querySelector('#studentSessionList');
    list.innerHTML=sessions.length?sessions.map((session)=>`<article class="data-row"><div class="data-main"><strong>${escapeHtml(session.day_name)} · ${escapeHtml({completed:'已完成',draft:'进行中',abandoned:'已放弃'}[session.status]||session.status)}</strong><small>${formatDate(session.started_at,true)}${session.duration_seconds==null?'':` · ${Math.round(session.duration_seconds/60)} 分钟`}</small></div><button class="button small" type="button" data-student-session="${session.id}">查看</button></article>`).join(''):'<div class="empty-state">还没有训练记录。</div>';
    list.querySelectorAll('[data-student-session]').forEach((button)=>button.addEventListener('click',async()=>{
      try{const {session}=await api(`/api/gym/sessions/${button.dataset.studentSession}`);content.querySelector('#studentSessionDetail').innerHTML=`<article class="session-editor"><h3>${escapeHtml(session.dayName)} · ${escapeHtml({completed:'已完成',draft:'进行中',abandoned:'已放弃'}[session.status])}</h3><p class="inline-message">${formatDate(session.startedAt,true)}${session.durationSeconds==null?'':` · ${Math.round(session.durationSeconds/60)} 分钟`}</p>${session.sets.map((set)=>`<div class="plan-summary-exercise"><div><strong>${escapeHtml(set.exerciseNameZh)} · 第 ${set.setNo} 组</strong><small>目标 ${set.targetRepMin}-${set.targetRepMax} 次 · RIR ${set.targetRir}</small></div><span>${set.status==='completed'?`${set.actualWeight==null?'自重':`${set.actualWeight} kg`} × ${set.actualReps} · RIR ${set.actualRir}`:escapeHtml({pending:'待记录',skipped:'已跳过',replaced:`替换：${set.replacementName||''}`}[set.status])}</span>${set.note?`<small>${escapeHtml(set.note)}</small>`:''}</div>`).join('')}</article>`;}
      catch{content.querySelector('#studentSessionDetail').innerHTML='<div class="empty-state">训练记录暂不可见。</div>';}
    }));
  }catch{content.querySelector('#studentSessionList').innerHTML='<div class="empty-state">训练记录读取失败。</div>';}
}

async function renderStudentMeasurements({state,content,notify}){
  content.innerHTML=`<div class="split-heading"><div><h3>身体数据</h3><p class="panel-intro">体重、腰围用于查看个人趋势；体脂可选填写，不会从 BMI 推算。初始数据确认后不可修改。</p></div></div><div id="initialConfirm"></div><div id="studentMeasurementForm"></div><div id="studentMeasurements" class="data-list"><div class="empty-state">正在读取身体记录…</div></div>`;
  try{const {measurements}=await api('/api/gym/measurements');draw(measurements);}
  catch{content.querySelector('#studentMeasurements').innerHTML='<div class="empty-state">身体记录读取失败。</div>';}
  function draw(rows){
    const initial=rows.find((row)=>row.entryType==='initial');
    content.querySelector('#initialConfirm').innerHTML=initial?.status==='pending_student_confirmation'?`<div class="callout confirm-callout"><div><strong>请确认你的初始数据</strong><p>${initial.weightKg} kg · 腰围 ${initial.waistCm} cm${initial.bodyFatPct==null?'':` · 体脂 ${initial.bodyFatPct}%`}。确认后会锁定，之后请通过新增记录修正。</p></div><button class="button primary small" type="button" id="confirmInitial">确认并锁定</button></div>`:'';
    content.querySelector('#studentMeasurementForm').innerHTML=`<form class="toolbar measurement-form" id="measurementForm"><strong>${initial?'追加记录':'填写初始身体数据'}</strong><label class="field-label">体重 kg<input class="field-input" type="number" name="weightKg" min="15" max="500" step="0.1" ${!initial?'required':''}></label><label class="field-label">腰围 cm<input class="field-input" type="number" name="waistCm" min="30" max="300" step="0.1" ${!initial?'required':''}></label><label class="field-label">体脂 %（可选）<input class="field-input" type="number" name="bodyFatPct" min="2" max="70" step="0.1"></label><button class="button primary" type="submit">${initial?'保存新记录':'提交待确认'}</button></form>`;
    content.querySelector('#studentMeasurements').innerHTML=rows.length?rows.map((row)=>`<article class="data-row"><div class="data-main"><strong>${row.entryType==='initial'?'初始记录':'后续记录'} · ${formatDate(row.recordedAt,true)}</strong><small>${row.weightKg==null?'':`${row.weightKg} kg`}${row.waistCm==null?'':` · 腰围 ${row.waistCm} cm`}${row.bodyFatPct==null?'':` · 体脂 ${row.bodyFatPct}%`}</small><small>${row.status==='confirmed'?'已确认并锁定':`待你确认 · 由 ${row.enteredBy===state.user.id?'你本人':'教练'} 录入`}${row.note?` · ${escapeHtml(row.note)}`:''}</small></div></article>`).join(''):'<div class="empty-state">尚无数据。</div>';
    content.querySelector('#confirmInitial')?.addEventListener('click',async()=>{if(!confirm('确认初始数据准确？确认后不可修改。'))return;try{await api(`/api/gym/measurements/${initial.id}/confirm`,{method:'POST',body:'{}'});notify('初始记录已确认并锁定。');const latest=await api('/api/gym/measurements');draw(latest.measurements);}catch{notify('确认失败。');}});
    content.querySelector('#measurementForm').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const body={weightKg:form.elements.weightKg.value||null,waistCm:form.elements.waistCm.value||null,bodyFatPct:form.elements.bodyFatPct.value||null};try{await api(`/api/gym/measurements${initial?'':'/initial'}`,{method:'POST',body:jsonBody(body)});notify(initial?'身体记录已追加。':'初始记录已提交，等待你确认。');const latest=await api('/api/gym/measurements');draw(latest.measurements);}catch(error){notify(error.message==='initial_already_exists'?'初始数据已存在，请刷新页面。':'保存失败，请检查填写的数值。');}});
  }
}

async function renderMyPhotos({state,content,notify}){
  content.innerHTML=`<div class="split-heading"><div><h3>我的照片</h3><p class="panel-intro">照片默认需管理员审核。你可以随时撤回；“公开”只对本网站登录用户开放。</p></div></div><form id="profileForm" class="toolbar"><label class="field-label">展示昵称<input class="field-input" name="displayName" maxlength="40" placeholder="设置展示圈昵称"></label><button class="button small" type="submit">保存昵称</button></form><form class="upload-form" id="photoUpload"><label class="field-label">选择照片<input class="field-input" name="photoFile" type="file" accept="image/jpeg,image/png,image/webp" required></label><label class="field-label">可见范围<select class="field-input" name="privacy"><option value="self">仅自己</option><option value="coach">自己和教练</option><option value="public">公开（需审核）</option></select></label><label class="field-label">说明<input class="field-input" name="caption" maxlength="240" placeholder="可选"></label><label class="check-label"><input type="checkbox" name="showMetrics">如果选择公开，允许同时展示最新体重/腰围/体脂</label><button class="button primary" type="submit">上传并提交审核</button><p class="inline-message">支持 JPEG、PNG、WebP，最大 5 MB；私密照片不会出现在展示圈。</p></form><div class="photo-grid" id="myPhotoGrid"><div class="empty-state">正在读取照片…</div></div>`;
  const list=content.querySelector('#myPhotoGrid');
  try{const profile=await api('/api/gym/profile');content.querySelector('#profileForm').elements.displayName.value=profile.displayName;}
  catch{}
  content.querySelector('#profileForm').addEventListener('submit',async(event)=>{event.preventDefault();try{await api('/api/gym/profile',{method:'PUT',body:jsonBody({displayName:event.currentTarget.elements.displayName.value.trim()})});notify('展示昵称已保存。');}catch{notify('昵称需为 1–40 个字符。');}});
  content.querySelector('#photoUpload').addEventListener('submit',async(event)=>{
    event.preventDefault();const form=event.currentTarget;const file=form.elements.photoFile.files[0];if(!file)return;
    if(file.size>5*1024*1024)return notify('照片不能超过 5 MB。');
    const imageData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    try{await api('/api/gym/photos',{method:'POST',body:jsonBody({imageData,privacy:form.elements.privacy.value,caption:form.elements.caption.value,showMetrics:form.elements.showMetrics.checked})});notify('照片已上传，等待管理员审核。');form.reset();await loadPhotos();}
    catch(error){notify(error.message==='photo_too_large'?'照片不能超过 5 MB。':error.message==='unsupported_photo_type'?'仅支持 JPEG、PNG 或 WebP 图片。':'照片上传失败。');}
  });
  await loadPhotos();
  async function loadPhotos(){
    revokeRenderedImages(list,state);
    try{
      const {photos}=await api('/api/gym/photos');
      list.innerHTML=photos.length?photos.map((photo)=>`<article class="photo-card"><img class="private-image" data-private-src="${photo.imageUrl}" alt="我的照片"><div class="badge-row"><span class="badge">${escapeHtml({pending:'待审核',approved:'已通过',rejected:'未通过',withdrawn:'已撤回',removed:'已下架'}[photo.moderationStatus])}</span><span class="badge">${escapeHtml({self:'仅自己',coach:'自己和教练',public:'公开'}[photo.privacy])}</span></div><small>${formatDate(photo.createdAt,true)}</small>${photo.moderationNote?`<small class="moderation-note">审核意见：${escapeHtml(photo.moderationNote)}</small>`:''}<label class="field-label">说明<input class="field-input" data-caption="${photo.id}" maxlength="240" value="${escapeHtml(photo.caption)}"></label><label class="field-label">可见范围<select class="field-input" data-privacy="${photo.id}">${[['self','仅自己'],['coach','自己和教练'],['public','公开']].map(([v,l])=>`<option value="${v}" ${photo.privacy===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="check-label"><input type="checkbox" data-show-metrics="${photo.id}" ${photo.showMetrics?'checked':''}>公开时展示身体数据</label><div class="actions"><button class="button small" type="button" data-save-photo="${photo.id}">保存设置</button>${photo.moderationStatus!=='withdrawn'&&photo.moderationStatus!=='removed'?`<button class="button danger small" type="button" data-withdraw-photo="${photo.id}">撤回</button>`:''}</div></article>`).join(''):'<div class="empty-state">还没有上传照片。</div>';
      await attachPrivateImages(list,state);
      list.querySelectorAll('[data-save-photo]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.savePhoto;try{const result=await api(`/api/gym/photos/${id}`,{method:'PATCH',body:jsonBody({caption:list.querySelector(`[data-caption="${id}"]`).value,privacy:list.querySelector(`[data-privacy="${id}"]`).value,showMetrics:list.querySelector(`[data-show-metrics="${id}"]`).checked})});notify(result.photo.moderationStatus==='pending'?'已提交公开范围变更，等待重新审核。':'照片设置已保存。');await loadPhotos();}catch{notify('照片设置保存失败。');}}));
      list.querySelectorAll('[data-withdraw-photo]').forEach((button)=>button.addEventListener('click',async()=>{if(!confirm('撤回后照片会立即从所有浏览入口消失。继续？'))return;try{await api(`/api/gym/photos/${button.dataset.withdrawPhoto}/withdraw`,{method:'POST',body:'{}'});notify('照片已撤回。');await loadPhotos();}catch{notify('撤回失败。');}}));
    }catch{list.innerHTML='<div class="empty-state">照片列表读取失败。</div>';}
  }
}

export async function renderFeed({state,root,notify}){
  root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">GYM COMMUNITY</p><h2>展示圈</h2></div><button class="button small" id="refreshFeed" type="button">刷新</button></div><p class="panel-intro">这里只展示管理员已审核且用户主动设为公开的照片。点赞可随时取消，不展示真实姓名或未授权身体数据。</p><div class="photo-grid feed-grid" id="feedList"><div class="empty-state">正在读取展示圈…</div></div><button class="button" id="loadMoreFeed" type="button" hidden>加载更多</button>`;
  const list=root.querySelector('#feedList');
  root.querySelector('#refreshFeed').addEventListener('click',()=>load(true));
  root.querySelector('#loadMoreFeed').addEventListener('click',()=>load(false));
  await load(true);
  async function load(reset){
    revokeRenderedImages(list,state);
    if(reset){state.feedItems=[];state.feedBefore=null;}
    try{
      const query=new URLSearchParams({limit:'20'});if(state.feedBefore)query.set('before',state.feedBefore);
      const result=await api(`/api/gym/feed?${query}`);
      state.feedItems=[...(state.feedItems||[]),...result.photos];state.feedBefore=result.nextBefore;
      list.innerHTML=state.feedItems.length?state.feedItems.map((photo)=>`<article class="photo-card feed-card"><img class="private-image" data-private-src="${photo.imageUrl}" alt="${escapeHtml(photo.nickname)}分享的训练照片"><div class="feed-title"><strong>${escapeHtml(photo.nickname)}</strong><small>${formatDate(photo.createdAt,true)}</small></div>${photo.caption?`<p>${escapeHtml(photo.caption)}</p>`:''}${photo.metricSnapshot?`<div class="metric-chip-row"><span>${photo.metricSnapshot.weightKg==null?'':`${photo.metricSnapshot.weightKg} kg`}</span><span>${photo.metricSnapshot.waistCm==null?'':`腰围 ${photo.metricSnapshot.waistCm} cm`}</span>${photo.metricSnapshot.bodyFatPct==null?'':`<span>体脂 ${photo.metricSnapshot.bodyFatPct}%</span>`}</div>`:''}<button class="like-button${photo.likedByMe?' liked':''}" type="button" data-like-photo="${photo.id}" aria-pressed="${photo.likedByMe}">♥ ${photo.likeCount} · ${photo.likedByMe?'已赞':'点赞'}</button></article>`).join(''):'<div class="empty-state">还没有公开照片，稍后再来看看。</div>';
      await attachPrivateImages(list,state);
      root.querySelector('#loadMoreFeed').hidden=!result.nextBefore;
      list.querySelectorAll('[data-like-photo]').forEach((button)=>button.addEventListener('click',async()=>{try{const result=await api(`/api/gym/photos/${button.dataset.likePhoto}/like`,{method:'POST',body:'{}'});const photo=state.feedItems.find((item)=>String(item.id)===button.dataset.likePhoto);if(photo){photo.likedByMe=result.liked;photo.likeCount=result.likeCount;}button.classList.toggle('liked',result.liked);button.setAttribute('aria-pressed',String(result.liked));button.textContent=`♥ ${result.likeCount} · ${result.liked?'已赞':'点赞'}`;}catch{notify('点赞状态更新失败。');}}));
    }catch{list.innerHTML='<div class="empty-state">展示圈读取失败。</div>';}
  }
}
