(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomeAiCoach=api;
})(globalThis,()=>{
  'use strict';
  const STATUS_LABELS={pending:'待确认',applied:'已应用',dismissed:'已忽略'};
  const FIELD_LABELS={rounds:'轮数',restSeconds:'组间休息',sets:'执行轮数',repMin:'次数下限',repMax:'次数上限',rir:'目标 RIR'};
  const SECTION_LABELS={main:'主关卡',secondary:'副关卡',support:'补强组'};
  const DAY_LABELS={push:'推',pull:'拉',legs:'腿',fourDay:'四日'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateLabel=value=>{
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };
  function fieldValue(op){
    if(!op||typeof op!=='object')return '';
    const raw=op.current==null?'':`${op.current}`;
    const next=op.value==null?'':`${op.value}`;
    const unit=op.field==='restSeconds'?' 秒':'';
    return raw?`${raw}${unit} → ${next}${unit}`:`${next}${unit}`;
  }
  function proposalOperationLabel(op){
    if(!op||typeof op!=='object')return '未知调整';
    const day=DAY_LABELS[op.day]||op.day||'';
    const section=SECTION_LABELS[op.sectionId]||op.sectionId||'';
    const subject=op.exerciseName?` · ${op.exerciseName}`:'';
    const field=FIELD_LABELS[op.field]||op.field||'';
    return `${day} ${op.variant||''} · ${section}${subject} · ${field} ${fieldValue(op)}`;
  }
  function hasGroups(proposal){
    return Boolean(proposal&&Array.isArray(proposal.operations)&&proposal.operations.length);
  }

  function createCoach(options={}){
    const state={mounted:false,open:false,status:null,review:null,messages:[],proposals:[],busy:'',error:'',draft:'',focus:''};
    let host=null;
    const getToken=options.getToken||(()=>localStorage.getItem('thinMuscleAuthToken')||'');
    const catalogNames=()=>{
      const items=typeof options.getCatalogItems==='function'?options.getCatalogItems():[];
      const names={};
      for(const item of items||[]){
        if(!item||!item.id)continue;
        names[item.id]=item.displayName||item.name||item.id;
      }
      return names;
    };
    const offline=()=>{
      if(typeof options.isOffline==='function'&&options.isOffline())return true;
      return (typeof navigator!=='undefined'&&navigator.onLine===false)
        ||(typeof window!=='undefined'&&window.HOME_OFFLINE_ACCESS===true);
    };

    async function api(path,{method='GET',body}={}){
      const token=getToken();
      const response=await fetch(`/api/ai-coach${path}`,{
        method,
        headers:{...(token?{Authorization:`Bearer ${token}`}:{}),...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){
        const error=new Error(payload.error||`http_${response.status}`);
        error.status=response.status;
        error.payload=payload;
        throw error;
      }
      return payload;
    }

    function errorText(error){
      const code=error?.message||'';
      if(error?.status===401)return '登录已失效，请刷新页面重新登录。';
      if(error?.status===403)return '当前账号没有使用 AI 教练的会员权限。';
      if(error?.status===404)return 'AI 教练接口尚未部署：需要重建并重启 Docker 服务。';
      if(code==='ai_not_configured')return 'AI 教练尚未配置：请在 .env 填写 AI_COACH_API_KEY，并重建服务。';
      if(code==='ai_timeout')return 'AI 响应超时，请稍后重试。';
      if(code==='ai_unavailable')return '无法连接 AI 服务，请检查网络或服务地址。';
      if(code==='ai_upstream')return `AI 服务返回错误${error.payload?.upstreamStatus?`（${error.payload.upstreamStatus}）`:''}，请检查 Key、模型名或额度。`;
      if(code==='rate_limited')return `调用较频繁，请 ${error.payload?.retryAfterSeconds||60} 秒后再试。`;
      if(code==='plan_required')return '当前计划不是分组计划，无法生成结构化调整提案。';
      if(code==='invalid_model_output')return 'AI 返回的提案无法通过校验，未做任何修改，请重试。';
      if(code==='proposal_not_pending')return '该提案已处理，请刷新。';
      return '操作失败，请稍后重试。';
    }

    function toast(text){
      if(typeof options.showToast==='function')options.showToast(text);
    }

    async function ensureSynced(){
      if(typeof options.ensureSynced!=='function')return;
      try{await options.ensureSynced();}
      catch{toast('训练记录同步失败，AI 将使用最近一次云端记录。');}
    }

    function render(){
      if(!host)return;
      const busy=state.busy;
      const configured=state.status?.configured;
      const offlineNow=offline();
      const statusLine=offlineNow
        ?'离线状态：AI 教练需要联网。训练和记录不受影响。'
        :state.status==null?'正在检查 AI 服务…'
        :configured?`已连接 ${escape(state.status.model||'AI 模型')}`
        :'未配置 AI 服务';
      const disabled=offlineNow||!configured||busy!==''?' disabled':'';
      const messages=state.messages.length?state.messages.map(message=>`<div class="ai-msg ${message.role==='user'?'user':'assistant'}"><span>${message.role==='user'?'你':'AI 教练'}</span><p>${escape(message.content)}</p></div>`).join(''):'<p class="ai-empty">还没有对话。可以问：“这周训练量够不够？”“哪个动作该进阶？”</p>';
      const review=state.review?`<div class="ai-review">
        <div class="ai-review-head"><strong>${escape(state.review.headline)}</strong><span>${escape(dateLabel(state.review.createdAt))}</span></div>
        <p>${escape(state.review.summary)}</p>
        ${reviewList('亮点',state.review.wins)}${reviewList('注意',state.review.watchouts)}${reviewList('下周',state.review.nextWeek)}
      </div>`:'<p class="ai-empty">还没有周复盘。点击“生成本周复盘”，会基于最近 7 天与之前 7 天的记录总结。</p>';
      const pending=state.proposals.filter(item=>item.status==='pending');
      const history=state.proposals.filter(item=>item.status!=='pending');
      const proposalHtml=pending.length?pending.map(proposalCard).join(''):'<p class="ai-empty">没有待确认的计划调整。提案只会预览，确认后才会写入计划。</p>';
      const historyHtml=history.length?`<details class="ai-history"><summary>已处理提案（${history.length}）</summary>${history.map(proposalCard).join('')}</details>`:'';
      host.innerHTML=`<details class="ai-coach-card" id="aiCoachCard"${state.open?' open':''}>
        <summary><span><strong>AI 教练</strong><small>周复盘 · 训练问答 · 计划调整预览</small></span><span class="ai-status">${disabled&&!offlineNow?'未就绪':'数据来自当前账号'}</span></summary>
        <div class="ai-body">
          <p class="ai-status-line" role="status">${statusLine}</p>
          ${state.error?`<p class="ai-error" role="alert">${escape(state.error)}</p>`:''}
          ${!configured&&!offlineNow&&state.status!=null?`<p class="ai-config">在仓库根目录的 <code>.env</code> 中设置 <code>AI_COACH_API_KEY</code>（可选 <code>AI_COACH_BASE_URL</code>、<code>AI_COACH_MODEL</code>），然后重建 Docker 服务。Key 只保存在服务端环境变量中。</p>`:''}
          <section class="ai-section" aria-labelledby="aiReviewTitle">
            <div class="ai-section-head"><h3 id="aiReviewTitle">本周复盘</h3><button type="button" data-ai-action="review"${disabled}>${busy==='review'?'生成中…':'生成本周复盘'}</button></div>
            ${review}
          </section>
          <section class="ai-section" aria-labelledby="aiChatTitle">
            <div class="ai-section-head"><h3 id="aiChatTitle">训练问答</h3><button class="ai-clear" type="button" data-ai-action="clear"${state.messages.length&&!busy&&!offlineNow?'':' disabled'}>清空对话</button></div>
            <div class="ai-messages">${messages}</div>
            <div class="ai-chat-form">
              <input id="aiCoachInput" type="text" maxlength="2000" placeholder="例如：这周拉日背部训练量够吗？" value="${escape(state.draft)}"${disabled}>
              <button type="button" data-ai-action="chat"${disabled}>${busy==='chat'?'思考中…':'发送'}</button>
            </div>
          </section>
          <section class="ai-section" aria-labelledby="aiPlanTitle">
            <div class="ai-section-head"><h3 id="aiPlanTitle">计划调整</h3><button type="button" data-ai-action="proposal"${disabled}>${busy==='proposal'?'分析中…':'生成调整提案'}</button></div>
            <p class="ai-hint">AI 只生成待确认提案。应用前会检查当前计划是否变化；校验失败不会修改任何内容。</p>
            <div class="ai-proposals">${proposalHtml}</div>
            ${historyHtml}
          </section>
        </div>
      </details>`;
      const details=host.querySelector('#aiCoachCard');
      if(details)details.addEventListener('toggle',()=>{state.open=details.open;});
    }

    function reviewList(label,items){
      if(!Array.isArray(items)||!items.length)return '';
      return `<div class="ai-review-group"><b>${label}</b><ul>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></div>`;
    }

    function proposalCard(proposal){
      if(!hasGroups(proposal))return '';
      const pending=proposal.status==='pending';
      const ops=proposal.operations.map(op=>`<li><span>${escape(proposalOperationLabel(op))}</span>${op.reason?`<small>${escape(op.reason)}</small>`:''}</li>`).join('');
      return `<article class="ai-proposal ${escape(proposal.status)}">
        <div class="ai-proposal-head"><strong>${escape(proposal.summary)}</strong><span class="ai-badge">${STATUS_LABELS[proposal.status]||proposal.status}</span></div>
        <p>${escape(proposal.rationale)}</p>
        <ul class="ai-diff">${ops}</ul>
        ${pending?`<div class="ai-proposal-actions"><button type="button" data-ai-apply="${proposal.id}"${state.busy?' disabled':''}>应用到计划</button><button class="ai-dismiss" type="button" data-ai-dismiss="${proposal.id}"${state.busy?' disabled':''}>忽略</button></div>`:''}
      </article>`;
    }

    async function load(){
      if(offline()){
        state.status={configured:false,offline:true};
        render();
        return;
      }
      state.busy='load';state.error='';render();
      try{
        const status=await api('/status');
        state.status=status;
        if(status.configured){
          const [review,messages,proposals]=await Promise.all([
            api('/reviews/latest').catch(()=>null),
            api('/messages').catch(()=>null),
            api('/proposals').catch(()=>null)
          ]);
          state.review=review?.review||null;
          state.messages=messages?.messages||[];
          state.proposals=proposals?.proposals||[];
        }
      }catch(error){
        state.error=errorText(error);
      }finally{
        state.busy='';
        render();
      }
    }

    async function run(action,work){
      if(state.busy)return;
      state.busy=action;state.error='';state.notice='';render();
      try{await work();}
      catch(error){state.error=errorText(error);}
      finally{state.busy='';render();}
    }

    async function sendChat(){
      const message=String(state.draft||'').trim();
      if(!message)return;
      await run('chat',async()=>{
        await ensureSynced();
        const names=catalogNames();
        const result=await api('/chat',{method:'POST',body:{message,names}});
        state.draft='';
        state.messages.push({role:'user',content:message},{role:'assistant',content:result.answer});
        if(state.messages.length>40)state.messages=state.messages.slice(-40);
      });
    }

    async function refreshReview(){
      await run('review',async()=>{
        await ensureSynced();
        const result=await api('/reviews',{method:'POST',body:{names:catalogNames()}});
        state.review=result.review;
        toast('本周复盘已生成。');
      });
    }

    async function requestProposal(){
      await run('proposal',async()=>{
        await ensureSynced();
        const result=await api('/proposals',{method:'POST',body:{names:catalogNames(),focus:state.focus}});
        state.proposals=[result.proposal,...state.proposals];
        toast('调整提案已生成，请预览后确认。');
      });
    }

    async function applyProposal(id){
      const proposal=state.proposals.find(item=>String(item.id)===String(id));
      if(!proposal||proposal.status!=='pending')return;
      await run('apply',async()=>{
        if(typeof options.applyOperations!=='function')throw new Error('apply_unavailable');
        const result=options.applyOperations(proposal.operations);
        if(!result||!result.ok){
          state.error=(result&&result.error)||'计划校验失败，未做任何修改。';
          return;
        }
        proposal.status='applied';
        try{await api(`/proposals/${proposal.id}/apply`,{method:'POST',body:{}});}
        catch{state.error='计划已更新，但云端提案状态同步失败；刷新后该提案可能再次出现。';}
        toast('计划已更新；本次训练如已开始，其他调整下次生效。');
      });
    }

    async function dismissProposal(id){
      const proposal=state.proposals.find(item=>String(item.id)===String(id));
      if(!proposal||proposal.status!=='pending')return;
      await run('dismiss',async()=>{
        await api(`/proposals/${proposal.id}/dismiss`,{method:'POST',body:{}});
        proposal.status='dismissed';
      });
    }

    async function clearChat(){
      await run('clear',async()=>{
        await api('/messages',{method:'DELETE'});
        state.messages=[];
      });
    }

    function mount(){
      if(state.mounted||typeof document==='undefined')return;
      host=document.getElementById('aiCoachCardHost');
      if(!host)return;
      state.mounted=true;
      host.addEventListener('click',event=>{
        const action=event.target.closest('[data-ai-action]')?.dataset.aiAction;
        if(action==='review')return void refreshReview();
        if(action==='chat')return void sendChat();
        if(action==='proposal')return void requestProposal();
        if(action==='clear')return void clearChat();
        const apply=event.target.closest('[data-ai-apply]')?.dataset.aiApply;
        if(apply)return void applyProposal(apply);
        const dismiss=event.target.closest('[data-ai-dismiss]')?.dataset.aiDismiss;
        if(dismiss)return void dismissProposal(dismiss);
      });
      host.addEventListener('input',event=>{
        if(event.target.id==='aiCoachInput')state.draft=event.target.value;
      });
      host.addEventListener('toggle',event=>{
        if(event.target.id==='aiCoachCard')state.open=event.target.open;
      },true);
      host.addEventListener('keydown',event=>{
        if(event.target.id==='aiCoachInput'&&event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat();}
      });
      window.addEventListener('online',()=>{if(!state.status?.configured||state.status?.offline)load();});
      window.addEventListener('home-access-reconnected',()=>{if(!state.status?.configured||state.status?.offline)load();});
      render();
      load();
    }

    return {mount,load,state,errorText,proposalOperationLabel,fieldValue};
  }

  let defaultCoach=null;
  function mount(options={}){
    if(defaultCoach)return defaultCoach;
    defaultCoach=createCoach(options);
    defaultCoach.mount();
    return defaultCoach;
  }

  return {mount,createCoach,proposalOperationLabel,fieldValue,fieldLabels:FIELD_LABELS,statusLabels:STATUS_LABELS};
});
