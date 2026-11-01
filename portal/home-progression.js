(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HomeProgression=api;})(globalThis,()=>{
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const level=(name,cue,extra={})=>({name,cue,requiresSetup:true,...extra});
  const bandHint='记录弹力带品牌/颜色、单条或并联、握持长度和固定位置。每次只小幅增加一项；不超过厂家拉伸上限。';
  const band=(name,cue)=>({strategy:'弹力带加阻为主',setupHint:bandHint,levels:[
    level(name,cue+'先选能完成次数下限、保留目标余力的阻力，确认后开始。'),
    level('渐进加阻 · '+name,cue+'所有组达到上限并留有目标余力后，再小幅增加阻力；次数回到区间下段。',{loadable:true})
  ]});
  const routes={
    '普通俯卧撑':band('弹力带抗阻俯卧撑','弹力带绕过上背而非颈部，两端压稳在掌下；全程保持躯干直线。'),
    '弹力带抗阻俯卧撑':band('弹力带抗阻俯卧撑','使用同一手位和完整幅度，弹力带绕上背并压稳；避免只在顶端勉强伸肘。'),
    '脚抬高俯卧撑':band('脚抬高弹力带俯卧撑','固定舒适的低至中等脚高后加带；不靠继续抬高脚来升级。弹力带绕上背、两端压稳，肩胛自然移动。'),
    '窄距俯卧撑':band('弹力带窄距俯卧撑','手距略窄于肩，保持肘腕舒适；带绕上背并压稳，不用极窄手位增加难度。'),
    'TRX俯卧撑':{...band('稳定支撑弹力带俯卧撑','改用地面稳定支撑加带，避免把不稳定性当成加阻；带绕上背、两端压稳。'),strategy:'角度建立基础，后续用稳定支撑加带'},
    'TRX上斜俯卧撑':{...band('稳定支撑弹力带俯卧撑','先在地面重新校准，再用绕上背的弹力带加阻；不要在悬吊握把上额外缠带。'),strategy:'角度建立基础，后续用稳定支撑加带'},
    'TRX夹胸':{strategy:'角度和杠杆微调',setupHint:'记录脚位、带长、身体角度和肘弯程度；保持舒适幅度。',levels:[level('小步加难TRX夹胸','保持肘微屈和原有舒适幅度，脚位每次只移动少量；不靠加深肩部后伸升级。',{loadable:true})]},
    'TRX划船':null,'宽握TRX划船':null,'窄握TRX划船':null,
    'TRX反向飞鸟':{strategy:'小步调整角度',setupHint:'记录带长、脚位和肘弯程度；每次仅改变少量脚位。',levels:[level('低角度可控TRX反向飞鸟','身体稍更水平，保持肘微屈、躯干稳定；一旦耸肩或幅度缩短就退回原角度。',{loadable:true})]},
    '引体向上 / 弹力带辅助':null,'反手引体向上 / 弹力带辅助':null,
    '徒手反向弓步':band('弹力带反向弓步','弹力带踩稳在前脚足中，双手持带于身体两侧；后撤时保持前脚不移动、前腿发力，不让带滑脱。'),
    '分腿蹲':band('弹力带分腿蹲','弹力带踩稳于前脚足中，双手持带于两侧；固定站距和深度，平衡不稳可用TRX轻扶。'),
    'TRX辅助保加利亚分腿蹲':band('弹力带辅助分腿蹲','优先双脚稳定着地加带；带踩稳前脚、手持于两侧，需要平衡辅助时单手轻扶固定支撑，不悬吊后脚。'),
    'TRX辅助反向弓步':band('弹力带反向弓步','先减少手臂辅助；带踩稳前脚、手持两侧，保持稳定站姿，不同时拉扯TRX和弹力带。'),
    '徒手深蹲':band('弹力带深蹲','带踩稳双脚足中，双手持带于肩侧；固定站距和舒适深度，不用缩小幅度换次数。'),
    '臀桥':{strategy:'先单腿变式，再增加髋部阻力',setupHint:'记录单腿或双腿、脚距及弹力带固定方式。',levels:[
      level('双腿臀桥','肋骨收住，髋伸直时停止，不用腰部过伸顶高。'),
      level('单腿臀桥','左右分别完成，骨盆不旋转；先减少次数重新校准。',{perSide:true}),
      level('弹力带臀桥','回到双脚支撑，带跨髋部并在两侧可靠固定；不得绕颈。阻力在髋伸直时仍可控。',{loadable:true,perSide:false})]},
    '跪姿健腹轮':{strategy:'可控幅度优先，再增加杠杆',setupHint:'记录膝盖到限位墙的距离；站姿记录脚到墙距离。',levels:[
      level('跪姿全程限位健腹轮','在不塌腰、能主动拉回的范围逐次增加滚出距离；用墙限位，不能以腰部下沉换距离。',{loadable:true}),
      level('站姿短程墙限位健腹轮','进阶跨度较大，仅在跪姿全程轻松且腰背稳定时手动尝试；先靠近墙限位，不直接做站姿全程。',{loadable:true})]},
    '死虫式':{strategy:'伸长杠杆，保持腰盆稳定',setupHint:'记录腿的伸直程度、离地高度和弹力带设置。',levels:[
      level('屈膝死虫式','呼气收肋骨，对侧手脚缓慢移动，腰背保持原位。',{perSide:true}),
      level('长杠杆死虫式','逐步伸直对侧腿、手臂过头，保持腰背稳定；每侧计次。',{perSide:true}),
      level('弹力带下拉死虫式','高位固定带，双手保持下拉张力、双腿交替伸展；腰背不离地，记录带和腿的幅度。',{loadable:true,perSide:true})]},
    '倒V俯卧撑':{strategy:'稳定支撑上的重心和幅度进阶',setupHint:'记录手脚距离、脚高和头部下降限位。',levels:[
      level('屈膝倒V俯卧撑','臀部抬高，肘部向斜后方，头部朝双手前方下降；不以头颈承重。'),
      level('标准倒V俯卧撑','逐步把重心移向双手，完整可控地下降和推起。'),
      level('低脚垫倒V俯卧撑','脚放稳固低台，逐步增加手臂承重；不直接跳到倒立撑。',{loadable:true})]}
  };
  const bandCues={
    '弹力带站姿肩推':'带踩稳，肋骨不外翻，肩胛允许自然上旋，不以腰后仰完成。',
    '弹力带阿诺德肩推':'维持舒适的旋转幅度和腰盆位置；肩部不适改普通推肩。',
    '弹力带侧平举':'单臂逐侧完成，保持肘弯和抬举幅度一致；不靠甩动、耸肩完成。',
    '弹力带斜向侧平举':'单臂逐侧完成，沿舒适的斜前方抬起，维持躯干稳定。',
    '弹力带下压':'大臂固定，保持完整伸肘；不得用身体下压带。',
    '弹力带过顶臂屈伸':'保持肋骨和大臂稳定，肘部舒适，完整伸肘。',
    '弹力带面拉':'拉向眉眼附近，保持肩外旋控制；不得后仰或以耸肩换阻力。',
    '弹力带二头弯举':'大臂稳定、手腕自然，保持底部到顶部幅度，不靠后仰。',
    '弹力带锤式弯举':'掌心相对，握法固定，肘部稳定，手腕不折。',
    '弹力带高位下拉':'高位固定可靠，肘向身体两侧下拉，不后仰借力。',
    '弹力带直臂下压':'保持肘弯角度稳定和完整肩部活动，不用腰部代偿。',
    '弹力带罗马尼亚硬拉':'双脚踩稳带，臀部向后，下降至腿后侧拉伸且腰背中立的位置；不要只加大顶端阻力而牺牲下段张力。',
    '弹力带俯卧腿弯举':'骨盆贴垫，保持完整屈膝和可控回落；脚踝绑带与固定点必须可靠。',
    '站姿弹力带抗旋转':'双手推出，胸口和骨盆始终朝前，保持呼吸，不靠扭转完成。',
    '站姿弹力带提膝':'固定骨盆和躯干，逐侧完成，腰部不后仰。'
  };
  for(const [name,cue] of Object.entries(bandCues))routes[name]=band('加阻'+name.replace(/^弹力带/,''),cue);
  for(const name of ['TRX划船','宽握TRX划船','窄握TRX划船'])routes[name]={strategy:'身体角度和支撑变式为主',setupHint:'记录带长、脚位、脚垫高度；偏单侧版同时记录辅助手用力程度。',levels:[
    level('低脚垫'+name,'先达到接近水平且全程可控，再把脚放稳固低台；维持原握法和肘部轨迹，不塌腰。'),
    level('偏单侧辅助'+name,'回到较直立角度，两手各握一个手柄，一侧主拉、另一侧保留辅助；逐侧完成，骨盆不旋转。',{perSide:true,loadable:true})
  ]};
  for(const name of ['引体向上 / 弹力带辅助','反手引体向上 / 弹力带辅助']){
    const base=name.startsWith('反手')?'反手引体':'引体向上';
    routes[name]={strategy:'标准自重进阶，负重为有装备时的选项',setupHint:'记录握法、停顿方式；负重需可靠负重带/背心和确认承重的引体杆。没有负重装备时保持自重版。',levels:[
      level('停顿'+base,'保留完整下放和可控顶端短停，不摆动；重新从次数区间下段开始，不必增加轮次。',{loadable:true}),
      level('小负重'+base+'（需负重装备）','仅在自重各组到上限且有余力时选择；使用可靠的小负重与确认承重的横杆，不夹哑铃、不用弹力带向下拉身体。',{loadable:true})
    ]};
  }
  for(const name of ['单腿提踵','微屈膝单腿提踵','双脚慢速提踵'])routes[name]={strategy:'完整幅度后加弹力带阻力',setupHint:'记录单/双腿、膝角度、台阶高度和弹力带；手扶固定支撑保持平衡。',levels:[
    level(name==='双脚慢速提踵'?'弹力带单腿提踵':'弹力带'+name,'带踩稳足中、持带于同侧；保留扶持，保持完整起落，微屈膝版维持膝角度不变。',{loadable:true,perSide:true})
  ]};
  function extend(library){
    for(const [name,route] of Object.entries(routes)){
      const cfg=library[name]||(library[name]={defaultIndex:0,levels:[]});
      cfg.legacyLength=cfg.levels.length;
      cfg.strategy=route.strategy;cfg.setupHint=route.setupHint;
      cfg.levels.push(...route.levels);
    }
    return library;
  }
  function setupRevision(entry){return Math.max(0,Number(entry?.setupRevision)||0);}
  function sameSetup(row,entry,index){return (row.levelIndex==null||row.levelIndex===index)&&setupRevision(row)===setupRevision(entry);}
  function setSetup(entry,note){
    note=String(note??'').trim();
    if(!note||note.length>240)return false;
    if(note===entry.setupNote)return false;
    entry.setupNote=note;entry.setupRevision=setupRevision(entry)+1;
    entry.upgradeStreak=0;entry.hardStreak=0;return true;
  }
  function usesBand(name){return /弹力带/.test(name)||routes[name]?.levels.some(item=>/弹力带/.test(item.name))||false;}
  function normalizeBandLoad(value){
    if(value==null)return null;
    const low=String(value.min??'').trim(),high=String(value.max??'').trim();
    if(!low&&!high)return null;
    const min=Number(low),max=high?Number(high):min;
    if(!low||!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max<min||max>1000||!['kg','lb'].includes(value.unit)||!['resistance','assistance'].includes(value.mode))throw Error('拉力需大于0、上限不小于下限且不超过1000，请选择kg或lb及阻力/辅助。');
    return {min,max,unit:value.unit,mode:value.mode};
  }
  function bandLoad(entry,index=entry?.levelIndex){try{return normalizeBandLoad(entry?.bandLoads?.[index]);}catch{return null;}}
  function bandLabel(value){try{const load=normalizeBandLoad(value);return load?`${load.mode==='assistance'?'辅助':'阻力'} ${load.min}${load.max!==load.min?'–'+load.max:''} ${load.unit}`:'';}catch{return '';}}
  function setBandLoad(entry,index,value){
    if(!Number.isInteger(index)||index<0)throw Error('动作等级无效。');
    const next=normalizeBandLoad(value);if(JSON.stringify(bandLoad(entry,index))===JSON.stringify(next))return false;
    const loads=entry.bandLoads&&typeof entry.bandLoads==='object'&&!Array.isArray(entry.bandLoads)?{...entry.bandLoads}:{};
    if(next)loads[index]=next;else delete loads[index];
    entry.bandLoads=loads;entry.setupRevision=setupRevision(entry)+1;entry.upgradeStreak=0;entry.hardStreak=0;return true;
  }
  return {extend,routes,escape,setupRevision,sameSetup,setSetup,usesBand,normalizeBandLoad,bandLoad,bandLabel,setBandLoad};
});
