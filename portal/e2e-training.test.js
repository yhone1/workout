/**
 * 居家训练端到端回归：用真实的训练核心逻辑（portal/home-performance.js）跑完
 * 「开始训练 → 逐轮记录 → 结束并归档 → 下一次训练按实际表现校准首轮」的完整流程。
 *
 * 这里不碰 DOM，只注入 index.html 同名宿主依赖（sessionState、performanceState、levelSnapshot、
 * persistPerformance 等），断言的是跨阶段的连带关系：落盘的键名与结构、逐轮冻结的等级/阻力快照、
 * 归档轮数对历史筛选的影响、换阻力后的重新校准，而不是单个函数的孤立返回值。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const HomePlan = require('./home-plan');
const HomeProgression = require('./home-progression');
const HomePerformance = require('./home-performance');

// 与 index.html 的 STORAGE.performance 保持一致：键名与 JSON 结构都不允许在这轮重构里变化。
const PERFORMANCE_KEY = 'thinMuscleExercisePerformanceV1';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: key => void data.delete(key)
  };
}

// 复刻页面的接线：宿主状态由闭包提供，模块方法就是 index.html 里同名薄封装转调的对象。
function training({ startedAt = Date.now(), store = memoryStorage() } = {}) {
  const exercise = { name: '弹力带侧平举', repMin: 10, repMax: 14, rir: 2, perSide: false };
  const section = { id: 'shoulders', mode: 'rounds', rounds: 3, exercises: [exercise] };
  const growthEntry = { levelIndex: 1, xp: 0, upgradeStreak: 0, hardStreak: 0, history: [], setupNote: '', setupRevision: 0, bandLoads: {} };
  const ctx = {
    WORKOUT_TARGET_MS: 40 * MINUTE,
    sessionState: {
      active: {
        day: 'push', variant: 'A', startedAt,
        planRevision: 1, homeSchedule: HomePlan.groupDefaults().schedule || 'threeDay',
        planSnapshot: HomePlan.clone(HomePlan.groupDefaults())
      }
    },
    performanceState: JSON.parse(store.getItem(PERFORMANCE_KEY) || '{"sessions":{}}'),
    HomePlan,
    HomeProgression,
    levelSnapshot: () => ({ index: 1, current: { name: exercise.name, perSide: exercise.perSide }, entry: growthEntry }),
    exerciseSlug: name => name,
    persistPerformance: () => store.setItem(PERFORMANCE_KEY, JSON.stringify(ctx.performanceState)),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value))
  };
  const hp = HomePerformance.create(ctx);
  const save = (round, reps, rir) => hp.savePerformanceEntry(section.id, round, exercise.name, { reps, rir });
  // 页面在「结束并保存训练」时做的事：归档轮数、标记 finalized、写入 endedAt 后落盘。
  const finish = (completedRounds = section.rounds, endedAt = startedAt + 35 * MINUTE) => {
    const record = hp.ensurePerformanceSession();
    record.roundProgress = { [section.id]: { completed: completedRounds } };
    record.finalized = true;
    record.endedAt = endedAt;
    ctx.persistPerformance();
    return record;
  };
  return { ctx, hp, store, exercise, section, growthEntry, save, finish };
}

test('开始训练就建立本次记录，落盘仍用原键名与原结构', () => {
  const startedAt = 1763000000000;
  const { ctx, hp, store, section } = training({ startedAt });
  assert.equal(store.data.size, 0, '未记录任何一组时不应提前写存储');

  const record = hp.ensurePerformanceSession();
  assert.equal(hp.performanceSessionId(startedAt), String(startedAt));
  assert.equal(ctx.performanceState.sessions[String(startedAt)], record);
  for (const [key, expected] of Object.entries({ day: 'push', variant: 'A', startedAt, planRevision: 1, finalized: false })) {
    assert.equal(record[key], expected, `本次记录字段 ${key} 跟随当前会话`);
  }
  assert.equal(record.planSnapshot.schema, ctx.sessionState.active.planSnapshot.schema, '计划快照按深拷贝存档，不受后续编辑影响');

  hp.savePerformanceEntry(section.id, 1, '弹力带侧平举', { reps: 12, rir: 2 });
  assert.deepEqual([...store.data.keys()], [PERFORMANCE_KEY], '只写训练表现这一个键');
  assert.deepEqual(JSON.parse(store.getItem(PERFORMANCE_KEY)), ctx.performanceState, '落盘内容可原样读回内存状态');
  assert.deepEqual(Object.keys(ctx.performanceState.sessions[String(startedAt)].values), ['shoulders::1::弹力带侧平举'], '逐组键仍为 section::round::动作');

  // 还没结束的本次训练不能当成历史，否则中途刷新会立刻用未完成的数据去校准。
  const analysis = hp.performanceAnalysis('push', 'A', section, { name: '弹力带侧平举', repMin: 10, repMax: 14, rir: 2 });
  assert.equal(analysis.mode, 'new');
  assert.match(analysis.reason, /首次校准/);
});

test('逐轮记录会冻结等级、阻力与设置版本，默认 RIR 只在未手工记录时补上', () => {
  const { ctx, hp, section, exercise, growthEntry } = training();
  HomeProgression.setBandLoad(growthEntry, 1, { min: 15, max: 15, unit: 'kg', mode: 'resistance' });
  hp.savePerformanceEntry(section.id, 1, exercise.name, { reps: 12, rir: null });
  const first = hp.activePerformanceEntry(section.id, 1, exercise.name);
  assert.equal(first.reps, 12);
  assert.equal(first.rir, null);
  assert.equal(HomeProgression.bandLabel(first.bandLoad), '阻力 15 kg', '这一轮的阻力按保存当时冻结');
  assert.equal(first.levelIndex, 1);
  assert.equal(first.levelName, exercise.name);
  assert.equal(HomeProgression.setupRevision(first), 1, '记录当下冻结设置版本');

  // 换阻力会让 setupRevision 递增，但已写下的那一轮仍显示当时的负荷。
  HomeProgression.setBandLoad(growthEntry, 1, { min: 20, max: 25, unit: 'lb', mode: 'resistance' });
  hp.savePerformanceEntry(section.id, 2, exercise.name, { reps: 14, rir: 3 });
  const second = hp.activePerformanceEntry(section.id, 2, exercise.name);
  assert.equal(HomeProgression.bandLabel(first.bandLoad), '阻力 15 kg');
  assert.equal(HomeProgression.bandLabel(second.bandLoad), '阻力 20–25 lb');
  assert.equal(second.rirSource, 'manual');
  assert.equal(hp.rirLabel(second), '3+');

  // 力量组结束但没填 RIR 时补默认 1–2，而不是留成空白。
  hp.savePerformanceEntry(section.id, 3, exercise.name, { reps: 13, rir: null });
  hp.confirmStrengthRir(section.id, 3, exercise.name);
  const third = hp.activePerformanceEntry(section.id, 3, exercise.name);
  assert.equal(third.rirSource, 'default');
  assert.deepEqual(third.rirRange, [1, 2]);
  assert.equal(hp.rirLabel(third), '1–2（默认）');

  // 换了阻力之后，「本轮」视图只保留当前设置下的轮次；旧设置那一轮仍留在历史里（见下一个用例）。
  const rows = hp.activePerformanceRows(section.id, exercise.name);
  assert.deepEqual(rows.map(row => row.round), [2, 3], '只统计当前阻力设置下记录的轮次');
  assert.deepEqual(rows.map(row => row.reps), [14, 13]);
  assert.deepEqual(hp.activePerformanceRows(section.id, exercise.name, 2).map(row => row.round), [2], '只看已完成的轮次');
});

test('结束并归档后，下次训练按上次实际表现给首轮目标，有余力只加 1 次', () => {
  const { ctx, hp, section, exercise, save, finish } = training();
  save(1, 12, 2); save(2, 14, 3); save(3, 14, 3);
  finish();

  // 换到下一场训练：同一个动作、同一等级、同一阻力设置。
  ctx.sessionState.active = { ...ctx.sessionState.active, day: 'push', variant: 'B', startedAt: ctx.sessionState.active.startedAt + DAY };
  const analysis = hp.performanceAnalysis('push', 'B', section, exercise);
  assert.equal(analysis.mode, 'hold');
  assert.deepEqual(analysis.targets, [13, 13, 13], '后两轮高于首轮 2 次以上：下次首轮只 +1，不直接跳到上限');
  assert.match(analysis.reason, /下次首轮 13 次/);
  assert.equal(hp.targetForRound('push', 'B', section, exercise, 1).target, 13, '第一组第一轮直接吃这个目标');
  assert.equal(hp.targetForRound('push', 'B', section, exercise, 2).targets.length, 3);

  // 所有轮都做到上限且余力达标：提示提高难度，而不是继续加次数。
  const maxed = training({ startedAt: Date.now() + 2 * DAY });
  maxed.save(1, 14, 2); maxed.save(2, 14, 2); maxed.save(3, 14, 2);
  maxed.finish();
  maxed.ctx.sessionState.active = { ...maxed.ctx.sessionState.active, startedAt: Date.now() + 3 * DAY };
  const allMax = maxed.hp.performanceAnalysis('push', 'A', maxed.section, maxed.exercise);
  assert.equal(allMax.mode, 'progress');
  assert.deepEqual(allMax.targets, [14, 14, 14]);
  assert.match(allMax.reason, /可考虑提高难度/);
});

test('本轮没做完的轮次不参与下次校准，换过阻力则重新校准首轮', () => {
  const { ctx, hp, section, exercise, save, finish, growthEntry } = training();
  save(1, 12, 2); save(2, 14, 3); save(3, 14, 3);
  finish(2); // 第三轮只做了没记完，页面归档的完成轮数是 2。

  ctx.sessionState.active = { ...ctx.sessionState.active, startedAt: ctx.sessionState.active.startedAt + DAY };
  hp.ensurePerformanceSession(); // 新的一天开始训练，本次记录另起一条，不动上次归档。
  const partial = hp.performanceAnalysis('push', 'A', section, exercise);
  assert.deepEqual(partial.rows.map(row => row.round), [1, 2], '超出归档轮数的记录不参与下次校准');
  assert.deepEqual(partial.targets, [13, 13, 13]);

  // 中途换了阻力：setupRevision 变了，旧数据只能做参考，首轮按上次首轮微调。
  HomeProgression.setBandLoad(growthEntry, 1, { min: 20, max: 25, unit: 'lb', mode: 'resistance' });
  const changed = hp.performanceAnalysis('push', 'A', section, exercise);
  assert.equal(changed.mode, 'new');
  assert.deepEqual(changed.targets, [11, 10, 10]);
  assert.match(changed.reason, /按上次首轮 12次微调为首轮 11次；旧记录保留/);
  assert.equal(Object.keys(ctx.performanceState.sessions).length, 2, '历史会话不会被改写或删除');
});

test('40 分钟只是参考：到点与做到 RIR 0 都只提示，不自动结束训练', () => {
  const short = training({ startedAt: Date.now() - MINUTE });
  short.save(1, 12, 0);
  short.save(2, 10, 0);
  assert.equal(short.hp.finishSuggestion('pull'), null, '不是当前训练日就不给收工建议');
  assert.match(short.hp.finishSuggestion('push').reason, /已有两项动作达到RIR 0/);

  const long = training({ startedAt: Date.now() - 41 * MINUTE });
  long.save(1, 12, 0);
  assert.match(long.hp.finishSuggestion('push').reason, /40分钟参考时长/);

  assert.match(short.hp.workoutTimeAssessment(39 * MINUTE), /不必凑满40分钟/);
  assert.match(short.hp.workoutTimeAssessment(52 * MINUTE), /40分钟仅作参考/);
});

test('index.html 已接线到本模块，页面仍通过同名函数调用', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="\/portal\/home-performance\.js\?v=\d{8}-\d+"><\/script>/, '居家页加载了训练核心模块');
  assert.match(html, /window\.HomePerformance\.create\(/, '页面在自身作用域里创建模块实例并注入宿主状态');
  const names = Object.keys(HomePerformance.create({}));
  assert.equal(names.length, 22, '模块对外暴露 22 个核心函数');
  for (const name of names) {
    assert.ok(html.includes(`function ${name}(`), `${name} 在页面里仍同名存在`);
    assert.ok(html.includes(`HP.${name}(`), `${name} 转交给 home-performance 模块`);
  }
});
