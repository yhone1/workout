/**
 * 居家间歇计时（Tabata / 计时动作）的息屏与后台回归测试。
 *
 * 计时核心（tick / advanceInterval / transitionIntervalPhase / playCountdownCrossings）仍内联在 index.html，
 * 这里按项目惯例从源码里切出这几个函数在 vm 沙箱里跑，并用 Date.now 打桩模拟“息屏一段时间后回前台”的大跳跃。
 * 断言的基准是一份独立的阶段表（expectedState），不看实现怎么写、只看真实经过的时间应该落在哪个阶段。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// 计划总时长 =（训练 + 休息）× 轮数；末轮也是带休息收尾的，所以最后一段是休息。
// 代码里 timer.round 在离开训练阶段时递增：第 i 个循环的休息显示为“第 i+2 轮”，末轮休息仍是 rounds。
function expectedState(plan, elapsed) {
  const cycle = plan.work + plan.rest;
  const total = (plan.work + plan.rest) * plan.rounds;
  if (elapsed >= total) return { left: 0, phase: 'rest', phaseLeft: 0, round: plan.rounds };
  const doneCycles = Math.floor(elapsed / cycle);
  const inCycle = elapsed - doneCycles * cycle;
  const inWork = cycle === 0 || inCycle < plan.work;
  const round = Math.min(plan.rounds, inWork ? doneCycles + 1 : doneCycles + 2);
  if (inWork) return { left: total - elapsed, phase: 'work', phaseLeft: plan.work - inCycle, round };
  return { left: total - elapsed, phase: 'rest', phaseLeft: cycle - inCycle, round };
}

function tabataHarness(plan = { work: 20, rest: 10, rounds: 6 }) {
  const total = (plan.work + plan.rest) * plan.rounds;
  const clock = { now: 0 };
  const beeps = [];
  const completed = [];
  const ctx = {
    clock,
    timer: {
      total, left: total, running: true, last: 0, type: 'interval', label: 'Tabata / 间歇', day: 'pull',
      intervalPlan: { work: plan.work, rest: plan.rest, rounds: plan.rounds },
      phase: 'work', phaseLeft: plan.work, round: 1, totalRounds: plan.rounds, hasStarted: true,
      groupAction: { day: 'pull', sectionId: 'challenge', round: 1, name: 'Tabata / 间歇', startedAt: 0 }
    },
    renders: 0, collapses: 0, pendingTick: null,
    beep: name => beeps.push(name),
    vibrate: () => {},
    renderTimer: () => { ctx.renders++; },
    startPause: { textContent: '' },
    collapseTimer: () => { ctx.collapses++; },
    requestAnimationFrame: fn => { ctx.pendingTick = fn; return 1; },
    cancelAnimationFrame: () => { ctx.pendingTick = null; },
    completeTimedGroupAction: (...args) => completed.push(args),
    doneState: {}, persistDone: () => {}, showToast: () => {}, renderDay: () => {}, sessionState: {},
    document: { getElementById: () => ({}) },
    Date: class extends Date { static now() { return clock.now; } }
  };
  vm.createContext(ctx);
  for (const name of ['playCountdownCrossings', 'transitionIntervalPhase', 'advanceInterval', 'tick']) {
    const start = source.indexOf(`  function ${name}(`);
    const end = source.indexOf('\n  function ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} 仍应内联在 index.html`);
    vm.runInContext(source.slice(start, end), ctx);
  }
  let elapsed = 0;
  const jump = seconds => {
    elapsed += seconds;
    clock.now += seconds * 1000;
    ctx.tick();
    return state();
  };
  const state = () => ({
    left: ctx.timer.left,
    phase: ctx.timer.phase,
    phaseLeft: ctx.timer.phaseLeft,
    round: ctx.timer.round
  });
  const assertMatchesWallClock = tolerance => {
    const want = expectedState(plan, elapsed);
    const got = state();
    assert.ok(Math.abs(got.left - want.left) < tolerance, `总剩余应与墙钟一致：期望 ${want.left.toFixed(3)}，实际 ${got.left.toFixed(3)}`);
    assert.equal(got.phase, want.phase, `经过 ${elapsed.toFixed(2)} 秒时的阶段`);
    assert.equal(got.round, want.round, `经过 ${elapsed.toFixed(2)} 秒时的轮次`);
    assert.ok(Math.abs(got.phaseLeft - want.phaseLeft) < tolerance, `阶段剩余应一致：期望 ${want.phaseLeft.toFixed(3)}，实际 ${got.phaseLeft.toFixed(3)}`);
  };
  return { ctx, plan, total, jump, state, assertMatchesWallClock, beeps, completed, elapsed: () => elapsed };
}

test('前台逐帧推进时六个阶段按 20/10 正常轮转，末轮休息走完不再翻回训练', () => {
  const h = tabataHarness();
  for (let step = 0.5; step < h.total - 0.0001; step += 0.5) h.jump(0.5);
  const finish = h.jump(0.5);
  assert.equal(finish.phase, 'rest', '结束后停在末轮休息，不出现第 7 轮训练');
  assert.equal(finish.round, 6);
  assert.equal(finish.phaseLeft, 0);
  assert.equal(h.ctx.timer.left, 0);
  assert.equal(h.ctx.timer.running, false, '计时自动停止');
  assert.equal(h.completed.length, 1, '结束时写入一次完成记录');
  const workBeeps = h.beeps.filter(name => name === 'work').length;
  const restBeeps = h.beeps.filter(name => name === 'rest').length;
  assert.equal(restBeeps, 6, '每轮进入休息各响一次');
  assert.equal(workBeeps, 5, '轮次之间的训练提示音不超过轮数');
});

test('息屏几十秒回前台会一次性结算全部时间，显示阶段不落后', () => {
  const h = tabataHarness();
  for (const seconds of [0.2, 45, 7.5, 40, 12, 60, 30]) {
    h.jump(seconds);
    h.assertMatchesWallClock(1e-6);
    assert.ok(h.ctx.timer.running || h.ctx.timer.left <= 0, '没到点之前不应停表');
  }
  assert.equal(h.ctx.timer.left, 0, '跳跃跨过总时长后应结束');
  assert.equal(h.completed.length, 1);
});

test('第 5 轮训练中途息屏 35 秒：回前台直接落到第 6 轮训练剩 5 秒', () => {
  const h = tabataHarness();
  h.jump(130);                       // 4 个完整循环 + 第 5 轮训练已做 10 秒
  h.assertMatchesWallClock(1e-6);
  const afterSleep = h.jump(35);     // 息屏：休息 10 秒 + 第 6 轮训练 20 秒已过 5 秒
  assert.equal(afterSleep.phase, 'work');
  assert.equal(afterSleep.round, 6);
  assert.ok(Math.abs(afterSleep.phaseLeft - 5) < 1e-6, `应显示训练剩 5 秒，实际 ${afterSleep.phaseLeft.toFixed(3)}`);
  assert.ok(Math.abs(afterSleep.left - 15) < 1e-6, '总剩余同步为 15 秒');
});

test('末轮休息期间息屏：回前台立即结束，不补出多余轮次', () => {
  const h = tabataHarness();
  h.jump(175);                       // 进入末轮休息 5 秒
  assert.equal(h.state().phase, 'rest');
  assert.equal(h.state().round, 6);
  const afterSleep = h.jump(30);
  assert.equal(afterSleep.left, 0);
  assert.equal(afterSleep.phase, 'rest');
  assert.equal(afterSleep.phaseLeft, 0);
  assert.equal(afterSleep.round, 6);
  assert.equal(h.completed.length, 1);
  assert.equal(h.beeps.filter(name => name === 'work').length, 5, '不应再响第 7 轮的训练提示音');
});

test('休息为 0 秒的间歇不会死循环，也不会丢时间', () => {
  const plan = { work: 20, rest: 0, rounds: 2 };
  const h = tabataHarness(plan);
  const mid = h.jump(25);
  assert.equal(mid.phase, 'work');
  assert.equal(mid.round, 2);
  assert.ok(Math.abs(mid.phaseLeft - 15) < 1e-6, `第 2 轮训练应剩 15 秒，实际 ${mid.phaseLeft.toFixed(3)}`);
  h.assertMatchesWallClock(1e-6);
  h.jump(30);
  assert.equal(h.ctx.timer.left, 0);
  assert.equal(h.completed.length, 1);
});
