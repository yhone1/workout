const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.resolve(process.argv[2] || 'D:/projects/ExerciseGymGifsDB-main');
const sourceIndex = path.join(sourceRoot, 'api', 'en', 'exercises.json');
const manifestPath = path.join(__dirname, 'common-exercise-manifest.json');
const outputPath = path.join(__dirname, 'exercise-seed.json');
const mediaRoot = path.join(projectRoot, 'gym', 'media', 'exercises');

const muscleNames = {
  abductors: '髋外展肌群', abs: '腹肌', adductors: '髋内收肌群', biceps: '肱二头肌', calves: '小腿',
  delts: '三角肌', forearms: '前臂', glutes: '臀肌', hamstrings: '腘绳肌', lats: '背阔肌',
  pectorals: '胸肌', quads: '股四头肌', traps: '斜方肌', triceps: '肱三头肌', 'upper-back': '上背部',
  spine: '竖脊肌', 'levator-scapulae': '肩胛提肌', 'serratus-anterior': '前锯肌', cardio: '心肺',
};
const equipmentNames = {
  barbell: '杠铃', dumbbell: '哑铃', cable: '绳索器械', machine: '固定器械', smith: '史密斯机',
  lever: '固定器械', bodyweight: '徒手', band: '弹力带', kettlebell: '壶铃', 'ez-bar': '曲杆',
  other: '其他器械', none: '无器械',
};
const cueByMuscle = {
  pectorals: '肩胛稳定，手腕尽量叠在肘部上方；下放和推起都保持可控。',
  'upper-back': '躯干保持稳定，先控制肩胛再拉动；避免借腰摆动。',
  lats: '肩膀远离耳朵，手肘沿身体方向下拉；躯干不要明显后仰借力。',
  traps: '肩膀垂直上提后缓慢放下，避免绕肩或用身体弹动。',
  delts: '控制抬举幅度，肩膀远离耳朵；避免甩动和腰部代偿。',
  biceps: '上臂基本固定，回程缓慢；不要靠躯干摆动完成弯举。',
  triceps: '上臂稳定，在舒适范围伸肘；回程保持控制，不锁肘顶死。',
  forearms: '前臂稳定，使用舒适活动范围；不要用快速弹动借力。',
  quads: '脚掌踩稳，膝盖跟随脚尖；按能力控制深度，不追求疼痛范围。',
  hamstrings: '髋部向后折叠，脊柱保持中立；用臀腿发力还原。',
  glutes: '保持躯干稳定，以髋关节伸展发力；顶端收紧臀部但不顶腰。',
  calves: '脚跟充分下沉再抬起，顶端稍作停顿；避免弹震。',
  abs: '收紧腹部并正常呼吸，避免腰部过度拱起；只做能控制的幅度。',
  abductors: '骨盆保持稳定，膝盖沿脚尖方向移动；避免身体左右摇晃。',
  adductors: '控制双腿向中线靠拢，骨盆稳定；不要用惯性猛夹。',
  spine: '保持脊柱中立并从髋部完成动作；避免腰椎过度反弓。',
};

function cueFor(item) {
  const file = item.file.toLowerCase();
  const muscle = item.muscle;
  if (muscle === 'pectorals') {
    if (/fly|cross-over|crossovers|seated-fly/.test(file)) return '肩胛保持稳定、肘部微屈；用胸肌把手臂向前合拢，回程控制幅度。';
    if (/dip/.test(file)) return '身体略前倾，肩膀远离耳朵；在肩部舒适范围下降，再用胸肌推回。';
    if (/push-up/.test(file)) return '头、躯干和髋部保持一条线；胸部靠近支撑面，肘部斜向后打开。';
    return '肩胛向后下方稳定、双脚踩稳；下放至舒适胸前位置，再沿原路径推起。';
  }
  if (muscle === 'upper-back') return '躯干保持稳定、脊柱中立；先控制肩胛，再把肘部向后拉，避免耸肩和借腰摆动。';
  if (muscle === 'lats') {
    if (/straight-arm/.test(file)) return '手肘保持微屈且角度固定；肩膀远离耳朵，从肩关节把手臂压向大腿。';
    if (/pull-up|chin-up/.test(file)) return '先让肩胛下沉，再把肘部向下拉；身体不摆动，避免用颈部去够横杆。';
    return '胸廓保持稳定、肩膀远离耳朵；肘部沿身体方向下拉，不用后仰借力。';
  }
  if (muscle === 'delts') {
    if (/rear|reverse|face-pull|cross-over-high/.test(file)) return '躯干稳定、肩膀远离耳朵；手肘向两侧打开，控制回程，不耸肩借力。';
    if (/lateral-raise/.test(file)) return '肘部微屈，手臂略在身体前侧抬起至肩高附近；不耸肩、不甩动躯干。';
    if (/front-raise/.test(file)) return '腹部收紧、躯干不后仰；控制手臂前举幅度，避免耸肩。';
    return '臀腹收紧、肋骨保持下沉；向上推时不顶腰，下降到肩部舒适范围。';
  }
  if (muscle === 'traps') return '肩膀垂直向上提至舒适范围，顶端停顿后缓慢放下；避免绕肩或弹震。';
  if (muscle === 'biceps') return '上臂靠近身体或支撑面并保持稳定；弯起后控制下放，不用躯干摆动借力。';
  if (muscle === 'triceps') {
    if (/pushdown/.test(file)) return '上臂贴近身体并固定；伸肘时控制到底，回程缓慢，不耸肩或锁肘顶死。';
    return '上臂尽量保持稳定，在肘部舒适范围屈伸；回程慢而可控，不外展顶肩。';
  }
  if (muscle === 'quads' || muscle === 'glutes') {
    if (/squat/.test(file)) return '全脚掌踩稳，膝盖跟随脚尖方向；下蹲时保持躯干稳定，按活动度控制深度。';
    if (/split-squat|step-up|lunge/.test(file)) return '前脚踩稳、膝盖跟随脚尖；身体保持平衡，缓慢下放后由前腿发力站起。';
    if (/leg-press/.test(file)) return '腰背贴稳靠垫，膝盖对准脚尖；下降到骨盆不卷起的位置，再平稳推回。';
    if (/deadlift|romanian/.test(file)) return '膝微屈、髋部向后折叠，重物贴近腿部；保持脊柱中立，用臀腿伸髋站起。';
    if (/bridge|thrust/.test(file)) return '肋骨下沉、骨盆保持中立；用臀部抬髋，顶端收紧但不要过度反弓腰部。';
  }
  if (muscle === 'hamstrings') {
    if (/deadlift|romanian/.test(file)) return '髋部向后折叠、膝微屈且脊柱中立；重物贴腿移动，感受大腿后侧拉伸。';
    return '膝关节对准器械转轴，屈膝时平稳发力；回程缓慢，不用惯性弹动。';
  }
  if (muscle === 'calves') return '脚掌前部踩稳，脚跟充分下沉再抬高；顶端稍停，避免弹震借力。';
  if (muscle === 'abductors' || muscle === 'adductors') return '躯干和骨盆保持稳定；用髋部肌群控制开合，不用快速弹动或左右摇摆。';
  if (muscle === 'abs') {
    if (/leg-raise|hanging/.test(file)) return '先收紧腹部并稳定骨盆，再抬腿；避免摆动借力和腰部过度反弓。';
    if (/plank/.test(file)) return '头、躯干和髋保持一条线，腹部持续收紧并正常呼吸；避免塌腰或憋气。';
    if (/twist/.test(file)) return '骨盆保持稳定，以躯干控制旋转；幅度适中、呼气发力，不猛甩腰部。';
    return '呼气时收紧腹部并卷起躯干，腰部保持舒适；回程缓慢，不用手臂拉颈部。';
  }
  return cueByMuscle[muscle] || '保持动作稳定并控制完整活动范围；如出现疼痛应停止并调整。';
}

function splitTags(item) {
  const muscle = item.muscle;
  const file = item.file.toLowerCase();
  const tags = [];
  if (['pectorals', 'triceps'].includes(muscle) || (muscle === 'delts' && !/rear|reverse|back/.test(file))) tags.push('ppl_push');
  if (['lats', 'upper-back', 'traps', 'biceps', 'forearms'].includes(muscle) || (muscle === 'delts' && /rear|reverse|back/.test(file))) tags.push('ppl_pull');
  if (['quads', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors', 'abs', 'spine'].includes(muscle)) tags.push('ppl_legs');
  if (['pectorals', 'delts', 'triceps', 'lats', 'upper-back', 'traps', 'biceps', 'forearms'].includes(muscle)) tags.push('upper_lower_upper');
  if (['quads', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors', 'abs', 'spine'].includes(muscle)) tags.push('upper_lower_lower');
  if (muscle === 'pectorals') tags.push('five_chest');
  else if (['lats', 'upper-back', 'traps'].includes(muscle)) tags.push('five_back');
  else if (['quads', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors'].includes(muscle)) tags.push('five_legs');
  else if (muscle === 'delts') tags.push('five_shoulders');
  else if (['biceps', 'triceps', 'forearms', 'abs'].includes(muscle)) tags.push('five_arms');
  return tags;
}

function main() {
  if (!fs.existsSync(sourceIndex)) throw new Error(`素材库索引不存在：${sourceIndex}`);
  const sourceData = JSON.parse(fs.readFileSync(sourceIndex, 'utf8'));
  const sourceByFile = new Map(sourceData.exercises.map((item) => [item.file, item]));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const preflight = new Set();
  for (const [file] of manifest) {
    if (preflight.has(file)) throw new Error(`清单有重复动作：${file}`);
    preflight.add(file);
    if (!sourceByFile.has(file) || !fs.existsSync(path.join(sourceRoot, file))) throw new Error(`素材或元数据缺失：${file}`);
  }
  const seen = new Set();
  const seed = manifest.map(([file, nameZh]) => {
    if (seen.has(file)) throw new Error(`清单有重复动作：${file}`);
    seen.add(file);
    const metadata = sourceByFile.get(file);
    const sourcePath = path.join(sourceRoot, file);
    if (!metadata || !fs.existsSync(sourcePath)) throw new Error(`素材或元数据缺失：${file}`);
    const mediaPath = `/gym/media/exercises/${file}`;
    const targetPath = path.join(mediaRoot, file);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) {
      const existing = fs.readFileSync(targetPath);
      const incoming = fs.readFileSync(sourcePath);
      if (!existing.equals(incoming)) throw new Error(`目标 GIF 已存在且内容不同，停止覆盖：${targetPath}`);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
    const primaryMuscle = metadata.muscle;
    const secondaryMuscles = metadata.secondaryMuscles || [];
    return {
      slug: file.replace(/\.gif$/i, ''),
      nameZh,
      nameEn: metadata.name,
      primaryMuscle,
      primaryMuscleZh: muscleNames[primaryMuscle] || primaryMuscle,
      secondaryMuscles,
      secondaryMusclesZh: secondaryMuscles.map((muscle) => muscleNames[muscle] || muscle),
      equipment: metadata.equipment,
      equipmentZh: equipmentNames[metadata.equipment] || metadata.equipment,
      bodyPart: metadata.bodyPart,
      category: metadata.category,
      splitTags: splitTags(metadata),
      cueZh: cueFor(metadata),
      sourceFile: file,
      mediaPath,
      isActive: true,
    };
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  console.log(`动作条目：${seed.length}`);
  console.log(`GIF 素材：${seen.size}`);
  console.log(`种子文件：${outputPath}`);
  console.log(`目标图片目录：${mediaRoot}`);
}

main();
