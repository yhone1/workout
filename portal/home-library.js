(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomeLibrary=api;
})(globalThis,()=>{
  'use strict';
  const FILTERS=Object.freeze([
    {id:'chest',label:'胸',test:text=>/胸/.test(text)},
    {id:'back',label:'背',test:text=>/背|斜方/.test(text)},
    {id:'shoulders',label:'肩',test:text=>/肩/.test(text)},
    {id:'biceps',label:'二头',test:text=>/二头|肱肌/.test(text)},
    {id:'triceps',label:'三头',test:text=>/三头/.test(text)},
    {id:'legs',label:'臀腿',test:text=>/臀|腿|股|腘绳|小腿/.test(text)},
    {id:'core',label:'核心',test:text=>/核心|腹/.test(text)},
    {id:'warmup',label:'热身 / 计时',test:(text,item)=>!!item?.timerType||/热身|间歇/.test(text)}
  ]);
  const valueOf=item=>String(item?.focus||'');
  const display=item=>item?.displayName||item?.name||'';
  function focusIds(item){
    const text=valueOf(item);
    return FILTERS.filter(filter=>filter.test(text,item)).map(filter=>filter.id);
  }
  function matchesFilter(item,filterId){
    if(!filterId)return true;
    return focusIds(item).includes(filterId);
  }
  function filterCatalog(items,filters={}){
    const query=String(filters.query||'').trim().toLowerCase(),favorites=new Set(filters.favorites||[]);
    return (items||[]).filter(item=>{
      if(!item)return false;
      if(filters.equipment&&item.equipment!==filters.equipment)return false;
      if(filters.focus&&!matchesFilter(item,filters.focus))return false;
      if(filters.favoritesOnly&&!favorites.has(item.id))return false;
      if(!query)return true;
      return `${display(item)} ${item.name||''} ${item.equipment||''} ${item.focus||''} ${item.cue||''}`.toLowerCase().includes(query);
    }).sort((a,b)=>(favorites.has(b.id)?1:0)-(favorites.has(a.id)?1:0)||display(a).localeCompare(display(b),'zh-Hans-CN'));
  }
  function overlap(a,b){
    const left=focusIds(a),right=new Set(focusIds(b));
    return left.filter(id=>right.has(id));
  }
  function rankReplacements(items,target,{favorites=[],excludeIds=[],limit=3}={}){
    if(!target)return [];
    const favoriteSet=new Set(favorites),excluded=new Set([target.id,...excludeIds]);
    return (items||[]).filter(item=>item&&!excluded.has(item.id)).map(item=>{
      const shared=overlap(item,target),sameEquipment=item.equipment===target.equipment,sameType=!!item.timerType===!!target.timerType;
      const score=shared.length*3+(shared.includes(focusIds(target)[0])?1:0)+(sameEquipment?2:0)+(sameType?1:0)+(favoriteSet.has(item.id)?1:0);
      return {item,score,shared,sameEquipment,sameType,favorite:favoriteSet.has(item.id)};
    }).sort((a,b)=>b.score-a.score||display(a.item).localeCompare(display(b.item),'zh-Hans-CN')).slice(0,limit).map(row=>({
      ...row,
      reason:[row.shared.length?'同部位':row.sameEquipment?'同器械':row.sameType?'同类型':'可替换',row.favorite?'已收藏':''].filter(Boolean).join(' · ')
    }));
  }
  function compare(a,b){
    if(!a||!b)return [];
    const type=item=>item.timerType==='timer'?'计时':item.timerType==='interval'?'间歇':'次数 / RIR';
    return [
      {label:'动作',left:display(a),right:display(b)},
      {label:'器械',left:a.equipment||'—',right:b.equipment||'—'},
      {label:'部位',left:a.focus||'—',right:b.focus||'—'},
      {label:'记录方式',left:type(a),right:type(b)},
      {label:'动作要领',left:a.cue||'—',right:b.cue||'—'}
    ];
  }
  return {FILTERS,focusIds,matchesFilter,filterCatalog,rankReplacements,compare};
});
