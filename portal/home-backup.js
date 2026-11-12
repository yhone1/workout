(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomeBackup=api;
})(globalThis,()=>{
  'use strict';
  const FORMAT='thin-muscle-backup',VERSION=1;
  const DEFAULT_KEYS=Object.freeze([
    'thinMuscleDoneV8','thinMusclePlanVariantV3','thinMuscleWorkoutSessionV3',
    'thinMuscleIntensityRatingsV2','thinMuscleRestSecondsV2','thinMuscleBodyProfileV1',
    'thinMuscleExercisePerformanceV1','thinMuscleGrowthV1','thinMuscleMrtV1','thinMuscleCindyV1',
    'thinMuscleHomePlanV1','thinMuscleExerciseFavoritesV1'
  ]);
  const AUTH_TOKEN='thinMuscleAuthToken',OWNER_KEY='thinMuscleStateOwnerV1';
  const dayLabels={push:'推',pull:'拉',legs:'腿核心',rest:'休息',four_push:'推＋腿前侧',four_pull:'拉＋腿后侧',mrt:'MRT',cindy:'Cindy'};
  const feedbackLabels={easy:'偏轻松',right:'刚刚好',hard:'偏吃力',joint:'关节不适'};
  const pad=value=>String(value).padStart(2,'0');
  function dateTime(value){
    const d=new Date(value);if(Number.isNaN(d.getTime()))return '';
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function localStamp(value=Date.now()){
    const d=new Date(value);return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function bad(message){const error=new Error(message);error.code='invalid_backup';return error;}
  function normalizeValue(value){
    if(value==null)return null;
    if(typeof value==='string')return value;
    if(typeof value==='number'||typeof value==='boolean')return String(value);
    if(typeof value==='object')return JSON.stringify(value);
    return null;
  }
  function validateValues(data,keys){
    for(const key of keys){
      if(data[key]===undefined)continue;
      try{JSON.parse(data[key]);}
      catch{throw bad(`记录 ${key} 的内容不是有效 JSON，已停止导入。`);}
    }
  }
  function createBackup(storage,{keys=DEFAULT_KEYS,now=Date.now()}={}){
    const data={};
    for(const key of keys){const value=storage.getItem(key);if(value!==null)data[key]=value;}
    return {format:FORMAT,version:VERSION,exportedAt:new Date(now).toISOString(),app:'thin-muscle-workout',data};
  }
  function parseBackup(text,{keys=DEFAULT_KEYS}={}){
    let raw;
    try{raw=JSON.parse(String(text||''));}
    catch{throw bad('不是有效的 JSON 文件。');}
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('备份文件格式不正确。');
    let data={},exportedAt=null,format='legacy';
    if(raw.format===FORMAT||raw.data){
      if(raw.format!==FORMAT)throw bad('备份文件标识不正确。');
      if(Number(raw.version)!==VERSION)throw bad(`备份版本 ${raw.version??'未知'} 不受支持，请使用当前页面导出的文件。`);
      if(!raw.data||typeof raw.data!=='object'||Array.isArray(raw.data))throw bad('备份内容缺失。');
      format=FORMAT;exportedAt=raw.exportedAt||null;
      for(const key of keys){
        const value=normalizeValue(raw.data[key]);
        if(value!==null)data[key]=value;
      }
    }else{
      for(const key of keys){
        const value=normalizeValue(raw[key]);
        if(value!==null)data[key]=value;
      }
    }
    const keysFound=Object.keys(data);
    if(!keysFound.length)throw bad('文件里没有可识别的训练数据。');
    validateValues(data,keys);
    const sessions=countSessions(data.thinMuscleWorkoutSessionV3);
    return {format,version:raw.version||null,exportedAt,data,keys:keysFound,sessions,unknownKeys:Object.keys(raw).filter(key=>!keys.includes(key)&&!['format','version','exportedAt','app','data'].includes(key)).length};
  }
  function countSessions(raw){
    try{
      const state=JSON.parse(raw||'{}'),days=state?.days&&typeof state.days==='object'?state.days:{};
      return Object.values(days).reduce((total,records)=>total+(records&&typeof records==='object'?Object.values(records).reduce((n,record)=>n+Math.max(Number(record?.count)||0,Array.isArray(record?.sessions)?record.sessions.length:0),0):0),0);
    }catch{return 0;}
  }
  function applyBackup(storage,data,{keys=DEFAULT_KEYS}={}){
    const entries=Object.entries(data||{}).filter(([key,value])=>keys.includes(key)&&value!==undefined&&value!==null);
    for(const key of keys)storage.removeItem(key);
    for(const [key,value] of entries)storage.setItem(key,String(value));
    return {count:entries.length,keys:entries.map(([key])=>key)};
  }
  function csvCell(value){
    const text=String(value??'');
    return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
  }
  function csv(rows){return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
  function sessionCsv(days={}){
    const rows=[['日期','训练日','开始时间','结束时间','时长（分钟）','体感','版本','计划','轮次摘要']];
    for(const [date,records] of Object.entries(days||{})){
      if(!records||typeof records!=='object')continue;
      for(const [key,record] of Object.entries(records)){
        if(!record||typeof record!=='object')continue;
        const sessions=Array.isArray(record.sessions)?record.sessions:[];
        const summary=Object.entries(record.roundProgress||{}).map(([id,row])=>`${row.label||id} ${Number(row.completed)||0}轮`).join('；');
        if(!sessions.length){
          const count=Number(record.count)||0;if(!count)continue;
          rows.push([date,dayLabels[key]||key,'','',((Number(record.totalMs)||0)/60000).toFixed(0),feedbackLabels[record.lastFeedback]||record.lastFeedback||'','','',summary]);
          continue;
        }
        for(const item of sessions)rows.push([date,dayLabels[key]||key,dateTime(item.startedAt),dateTime(item.endedAt),((Number(item.durationMs)||0)/60000).toFixed(1),feedbackLabels[item.feedback]||item.feedback||'',item.variant||'',item.planLabel||'',summary]);
      }
    }
    return csv(rows);
  }
  function bandText(load){
    if(!load||typeof load!=='object')return '';
    if(load.combination)return `阻力 ${load.combination}${load.unit?' '+load.unit:''}`;
    if(load.min!=null&&load.max!=null)return `阻力 ${load.min===load.max?load.min:`${load.min}–${load.max}`}${load.unit?' '+load.unit:''}`;
    return '';
  }
  function performanceCsv(sessions={}){
    const rows=[['开始时间','结束时间','训练日','版本','动作组','轮次','动作','次数','RIR','动作等级','阻力']];
    const ordered=Object.values(sessions||{}).filter(Boolean).sort((a,b)=>Number(a.startedAt)-Number(b.startedAt));
    for(const session of ordered){
      for(const [key,value] of Object.entries(session.values||{})){
        const [section,round,slug]=key.split('::');if(!value||value.reps==null||value.reps==='')continue;
        const rir=value.rir==null||value.rir===''?(value.rirSource==='default'?'1–2（默认）':'未记录'):String(value.rir);
        const name=decodeURIComponent(slug||'');
        const level=value.levelName&&value.levelName!==name?value.levelName:(value.levelIndex!=null?`Lv${Number(value.levelIndex)+1}`:'');
        rows.push([dateTime(session.startedAt),dateTime(session.endedAt),dayLabels[session.day]||session.day||'',session.variant||'',section||'',round||'',name,value.reps,rir,level,bandText(value.bandLoad)]);
      }
    }
    return csv(rows);
  }
  function downloadText(filename,content,type='application/json;charset=utf-8'){
    if(typeof document==='undefined')return false;
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);return true;
  }
  function mount({
    storage=typeof localStorage!=='undefined'?localStorage:null,
    getDays=()=>({}),getSessions=()=>({}),getUserId=()=>'',onStatus=()=>{},reload=()=>location.reload(),
  }={}){
    if(typeof document==='undefined'||!storage)return {};
    const host=document.getElementById('backupCard');
    const file=document.getElementById('backupFile');
    if(!host||!file)return {};
    const status=(text,tone='')=>{const node=document.getElementById('backupStatus');if(node){node.textContent=text;node.dataset.tone=tone;}onStatus(text,tone);};
    const exported=()=>{const backup=createBackup(storage,{keys:DEFAULT_KEYS});return {backup,text:JSON.stringify(backup,null,2)};};
    host.addEventListener('click',event=>{
      const button=event.target.closest('[data-backup]');if(!button)return;
      const action=button.dataset.backup;
      if(action==='import'){file.value='';file.click();return;}
      if(action==='json'){const {text}=exported();downloadText(`thin-muscle-backup-${localStamp()}.json`,text);status('已导出完整备份，包含计划、训练、身体数据与收藏。','ok');return;}
      if(action==='sessions'){downloadText(`thin-muscle-sessions-${localStamp()}.csv`,'\ufeff'+sessionCsv(getDays()),'text/csv;charset=utf-8');status('已导出训练记录 CSV，可直接用表格软件打开。','ok');return;}
      if(action==='performance'){downloadText(`thin-muscle-sets-${localStamp()}.csv`,'\ufeff'+performanceCsv(getSessions()),'text/csv;charset=utf-8');status('已导出逐组表现 CSV。','ok');return;}
    });
    file.addEventListener('change',async()=>{
      const chosen=file.files?.[0];if(!chosen)return;
      let parsed;
      try{parsed=parseBackup(await chosen.text(),{keys:DEFAULT_KEYS});}
      catch(error){status(error.message||'备份文件无法读取。','error');return;}
      const summary=[`导出时间：${parsed.exportedAt?dateTime(parsed.exportedAt):'未标注'}`,`包含 ${parsed.keys.length} 类数据、${parsed.sessions} 次训练记录`,'导入会覆盖本机当前全部训练记录（登录令牌和账号归属不变）。'].join('\n');
      if(!window.confirm(`${summary}\n\n确认恢复这份备份？`)){status('已取消导入','');file.value='';return;}
      const applied=applyBackup(storage,parsed.data,{keys:DEFAULT_KEYS});
      status(`已恢复到本机 ${applied.count} 类数据，正在同步账号…`,'busy');
      const userId=String(getUserId?.()||'').trim();
      let synced=false;
      if(userId&&root.HomeSync){
        try{synced=await root.HomeSync.createHomeSync({storage}).syncOwned({userId});}
        catch(error){synced=false;}
      }
      if(synced){status('恢复完成并已同步账号，正在刷新…','ok');setTimeout(()=>reload(),500);}
      else {status('已恢复到本机，但上传账号失败。为避免云端旧数据覆盖，页面未刷新；请确认登录状态后重新导入本备份。','error');window.alert('数据已恢复到本机浏览器，但上传账号失败。请保持此页面不要刷新，确认登录状态后重新导入同一份备份。');}
      file.value='';
    });
    return {status};
  }
  return {FORMAT,VERSION,DEFAULT_KEYS,AUTH_TOKEN,OWNER_KEY,createBackup,parseBackup,applyBackup,countSessions,sessionCsv,performanceCsv,downloadText,mount,localStamp};
});
