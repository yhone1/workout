/* 动作演示配置。路径默认相对于 ./IMG/。 */
window.WORKOUT_GIF_BASE_URL = (window.WORKOUT_MEDIA_CONFIG && window.WORKOUT_MEDIA_CONFIG.imageBaseUrl) || './IMG/';
window.WORKOUT_GIF_LINKS = {
  "肩绕环 + 弹力带拉开": { cue: "先活动肩关节，再完成弹力带拉开", items: [
    { label: "肩绕环", url: "warmup/arm-circles.gif" },
    { label: "弹力带拉开", url: "warmup/band-pull-apart.gif" },
  ] },
  "徒手深蹲 + 轻松俯卧撑": { cue: "两项都只用于升温，不要做到力竭", items: [
    { label: "徒手深蹲", url: "warmup/bodyweight-squat.gif" },
    { label: "轻松俯卧撑", url: "warmup/push-up.gif" },
  ] },
  "TRX俯卧撑": { cue: "身体保持直线，胸口向双手之间下降", items: [
    { label: "TRX俯卧撑", url: "push/trx-push-up.gif" },
  ] },
  "弹力带站姿肩推": { cue: "踩住弹力带，从肩部垂直推到头顶", items: [
    { label: "弹力带肩推", url: "push/band-shoulder-press.gif" },
  ] },
  "弹力带侧平举": { cue: "双臂向两侧抬至肩高，避免耸肩", items: [
    { label: "弹力带侧平举", url: "push/band-lateral-raise.gif" },
  ] },
  "TRX夹胸": { cue: "手臂微屈，胸部主动把双手合拢", items: [
    { label: "夹胸动作参考", url: "push/band-chest-fly.gif" },
  ] },
  "弹力带下压": { cue: "肘部固定，完全伸直后停顿", items: [
    { label: "三头伸展参考", url: "push/trx-triceps-extension.gif" },
  ] },
  "俯卧撑 + 站姿快速提膝": { cue: "20秒训练、10秒休息，两项交替", items: [
    { label: "俯卧撑", url: "warmup/push-up.gif" },
    { label: "站姿快速提膝", url: "challenge/high-knees.gif" },
  ] },
  "TRX上斜俯卧撑": { cue: "身体保持直线，控制下放", items: [
    { label: "TRX俯卧撑参考", url: "push/trx-push-up.gif" },
  ] },
  "弹力带阿诺德肩推": { cue: "旋转过程缓慢，腰部不要后仰", items: [
    { label: "肩推动作参考", url: "push/band-shoulder-press.gif" },
  ] },
  "弹力带斜向侧平举": { cue: "略向前上方抬，保持肩胛稳定", items: [
    { label: "侧平举参考", url: "push/band-lateral-raise.gif" },
  ] },
  "脚抬高俯卧撑": { cue: "腰腹持续收紧，动作变形即停止", items: [
    { label: "俯卧撑参考", url: "warmup/push-up.gif" },
  ] },
  "弹力带过顶臂屈伸": { cue: "肘尖朝前，回程慢放", items: [
    { label: "臂屈伸参考", url: "push/trx-triceps-extension.gif" },
  ] },
  "窄距俯卧撑 + 站姿出拳": { cue: "20秒训练、10秒休息，两项交替", items: [
    { label: "窄距俯卧撑", url: "challenge/close-grip-push-up.gif" },
    { label: "站姿出拳", url: "challenge/standing-punch.gif" },
  ] },
  "弹力带拉开 + 肩胛下沉": { cue: "先打开肩背，再做肩胛下沉", items: [
    { label: "弹力带拉开", url: "warmup/band-pull-apart.gif" },
    { label: "肩胛下沉", url: "pull/scapular-pull-up.gif" },
  ] },
  "轻角度TRX划船": { cue: "身体较直，只做热身", items: [
    { label: "TRX划船", url: "pull/trx-row.gif" },
  ] },
  "TRX划船": { cue: "胸口拉向手柄，肩膀远离耳朵", items: [
    { label: "TRX划船", url: "pull/trx-row.gif" },
  ] },
  "引体向上 / 弹力带辅助": { cue: "肩胛先下沉，胸口向横杆靠近", items: [
    { label: "引体向上", url: "pull/pull-up.gif" },
  ] },
  "弹力带面拉": { cue: "拉向眉眼高度，双肘向外打开", items: [
    { label: "弹力带面拉", url: "pull/band-face-pull.gif" },
  ] },
  "宽握TRX划船": { cue: "双肘向外打开，重点刺激上背", items: [
    { label: "TRX划船参考", url: "pull/trx-row.gif" },
  ] },
  "弹力带二头弯举": { cue: "肘部固定，只移动前臂", items: [
    { label: "弹力带弯举", url: "pull/band-biceps-curl.gif" },
  ] },
  "弹力带快速划船 + 锤式弯举": { cue: "20秒训练、10秒休息，两项交替", items: [
    { label: "快速划船参考", url: "pull/trx-row.gif" },
    { label: "锤式弯举参考", url: "pull/band-biceps-curl.gif" },
  ] },
  "反手引体向上 / 弹力带辅助": { cue: "掌心朝向自己，动作全程受控", items: [
    { label: "引体向上参考", url: "pull/pull-up.gif" },
  ] },
  "窄握TRX划船": { cue: "肘部贴近身体，重点感受背阔", items: [
    { label: "TRX划船参考", url: "pull/trx-row.gif" },
  ] },
  "弹力带高位下拉": { cue: "肘部向下夹，避免只用手臂", items: [
    { label: "弹力带下拉参考", url: "pull/band-high-pulldown.gif" },
  ] },
  "弹力带直臂下压": { cue: "手臂基本伸直，用背阔肌下压", items: [
    { label: "直臂下压", url: "pull/band-straight-arm-pulldown.gif" },
  ] },
  "弹力带锤式弯举": { cue: "掌心相对，肘部固定", items: [
    { label: "弹力带弯举参考", url: "pull/band-biceps-curl.gif" },
  ] },
  "直臂下压 + 站姿高抬腿": { cue: "20秒训练、10秒休息，两项交替", items: [
    { label: "直臂下压", url: "pull/band-straight-arm-pulldown.gif" },
    { label: "站姿高抬腿", url: "challenge/high-knees.gif" },
  ] },
  "低冲击开合步 + 站姿交替提膝": { cue: "20秒训练、10秒休息；全程轻落地，以提高心率为主", items: [
    { label: "低冲击开合步", url: "warmup/jumping-jack.gif" },
    { label: "站姿交替提膝", url: "challenge/high-knees.gif" },
  ] },
  "快速点步 + 站姿交替提膝": { cue: "20秒训练、10秒休息；动作交替，保持轻快但不跺脚", items: [
    { label: "快速点步", url: "challenge/quick-step.gif" },
    { label: "站姿交替提膝", url: "challenge/high-knees.gif" },
  ] },
  "低冲击开合步 + 快速点步": { cue: "20秒训练、10秒休息；全程轻落地，只作为心肺收尾", items: [
    { label: "低冲击开合步", url: "warmup/jumping-jack.gif" },
    { label: "快速点步", url: "challenge/quick-step.gif" },
  ] },
  "站姿出拳 + 站姿交替提膝": { cue: "20秒训练、10秒休息；出拳轻快，肩颈放松，不追求力量", items: [
    { label: "站姿出拳", url: "challenge/standing-punch.gif" },
    { label: "站姿交替提膝", url: "challenge/high-knees.gif" },
  ] },
  "低冲击开合步 + 站姿出拳": { cue: "20秒训练、10秒休息；开合步轻落地，出拳只求节奏", items: [
    { label: "低冲击开合步", url: "warmup/jumping-jack.gif" },
    { label: "站姿出拳", url: "challenge/standing-punch.gif" },
  ] },
  "快速点步 + 站姿出拳": { cue: "20秒训练、10秒休息；点步轻快，出拳不耸肩、不锁死手肘", items: [
    { label: "快速点步", url: "challenge/quick-step.gif" },
    { label: "站姿出拳", url: "challenge/standing-punch.gif" },
  ] },
  "开合跳 + 髋关节绕环": { cue: "开合跳升温，髋绕环活动关节", items: [
    { label: "开合跳", url: "warmup/jumping-jack.gif" },
    { label: "髋关节绕环", url: "warmup/hip-circles.gif" },
  ] },
  "徒手弓步": { cue: "前脚稳定，膝盖方向与脚尖一致", items: [
    { label: "徒手弓步", url: "warmup/bodyweight-lunge.gif" },
  ] },
  "徒手深蹲": { cue: "双脚与肩同宽，膝盖跟随脚尖方向", items: [
    { label: "徒手深蹲", url: "warmup/bodyweight-squat.gif" },
  ] },
  "TRX辅助保加利亚分腿蹲": { cue: "前腿负责发力，TRX只用于平衡", items: [
    { label: "保加利亚分腿蹲", url: "legs/trx-bulgarian-split-squat.gif" },
  ] },
  "弹力带罗马尼亚硬拉": { cue: "髋向后坐，背部保持中立", items: [
    { label: "罗马尼亚硬拉", url: "legs/band-romanian-deadlift.gif" },
  ] },
  "跪姿健腹轮": { cue: "膝下垫软垫，腰背稳定后再逐步加大滚动幅度", items: [
    { label: "跪姿健腹轮", url: "core/kneeling-ab-wheel-rollout.gif" },
  ] },
  "单腿提踵": { cue: "脚跟充分抬高后缓慢下降", items: [
    { label: "单腿提踵", url: "legs/single-leg-calf-raise.gif" },
  ] },
  "站姿弹力带抗旋转": { cue: "骨盆保持正对前方，身体不旋转", items: [
    { label: "Pallof 抗旋转", url: "core/band-pallof-press.gif" },
  ] },
  "深蹲 + 站姿交替提膝": { cue: "20秒训练、10秒休息，两项交替", items: [
    { label: "深蹲", url: "warmup/bodyweight-squat.gif" },
    { label: "站姿交替提膝", url: "challenge/high-knees.gif" },
  ] },
  "TRX辅助反向弓步": { cue: "前脚稳定，TRX只辅助平衡", items: [
    { label: "反向弓步参考", url: "legs/trx-reverse-lunge.gif" },
  ] },
  "双脚慢速提踵": { cue: "顶部停顿，下放保持控制", items: [
    { label: "提踵参考", url: "legs/single-leg-calf-raise.gif" },
  ] },
  "站姿弹力带提膝": { cue: "骨盆稳定，膝盖向胸口方向提", items: [
    { label: "提膝参考", url: "challenge/high-knees.gif" },
  ] },
  "交替后撤弓步 + 快速点步": { cue: "20秒训练、10秒休息，两项交替", items: [
    { label: "后撤弓步参考", url: "legs/trx-reverse-lunge.gif" },
    { label: "快速点步参考", url: "challenge/quick-step.gif" },
  ] },
};
