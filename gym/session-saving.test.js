const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/coach.js`, 'utf8');
const draw = source.slice(source.indexOf('  function drawSession(session){'), source.indexOf('function renderSetEditor(session,set){')).trim().replace(/\}\s*$/, '');
const factory = import('../portal/shared/set-save-queue.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function harness(write) {
  const { createSetSaveQueue } = await factory;
  const handlers = {}, fields = {}, timers = new Map(), messages = [];
  let timerNo = 0;
  for (const name of ['set-status', 'actual-weight', 'actual-reps', 'actual-rir', 'replacement-name', 'set-note']) {
    fields[name] = { value: ({ 'set-status': 'completed', 'actual-weight': '20', 'actual-reps': '9', 'actual-rir': '2' })[name] || '', isConnected: true,
      addEventListener(type, fn) { handlers[`${name}:${type}`] = fn; } };
  }
  const form = { isConnected: true, dataset: { exerciseIndex: '0', setNo: '1', status: 'completed' }, classList: { toggle() {} },
    querySelector(selector) { return fields[selector.match(/data-(.*?)\]/)[1]]; }, querySelectorAll() { return Object.values(fields); } };
  const buttons = {};
  for (const id of ['completeSession', 'abandonCurrent']) buttons[id] = { isConnected: true, addEventListener(_type, fn) { handlers[id] = fn; } };
  const hint = { isConnected: true };
  const controls = [...Object.values(fields), ...Object.values(buttons)];
  const panel = { innerHTML: '', querySelectorAll(selector) { return selector === '[data-session-set]' ? [form] : controls; },
    querySelector(selector) {
      if (selector === '[data-started-at]') return { isConnected: false };
      if (selector === '#sessionNotes') return { value: '' };
      if (selector === '#sessionSaveHint') return hint;
      return buttons[selector.slice(1)];
    } };
  const context = { createSetSaveQueue, content: { querySelector: () => panel }, escapeHtml: String, renderSetEditor: () => '',
    confirm: () => true, notify: (message) => messages.push(message), jsonBody: JSON.stringify,
    setInterval: () => 1, clearInterval() {}, setTimeout(fn) { timers.set(++timerNo, fn); return timerNo; }, clearTimeout(id) { timers.delete(id); },
    api: write, async loadHistory() {}, async showSession() { form.isConnected = false; controls.forEach((node) => { node.isConnected = false; }); } };
  vm.createContext(context);
  vm.runInContext(draw + '\nthis.draw = drawSession;', context);
  context.draw({ id: 77, status: 'draft', dayName: '推', startedAt: new Date().toISOString(), snapshot: {}, sets: [{}] });
  return { handlers, fields, timers, messages, form, buttons, hint };
}

test('coach finish flushes the 350 ms debounce and waits for last changed set', async () => {
  const calls = [];
  let release, recordedReps = 9;
  const hold = new Promise((resolve) => { release = resolve; });
  const h = await harness(async (path, options) => {
    calls.push(path);
    if (options.method === 'PATCH') { await hold; recordedReps = JSON.parse(options.body).actualReps; }
    return {};
  });
  h.fields['actual-reps'].value = '10';
  h.handlers['actual-reps:input']();
  const finish = h.handlers.completeSession();
  await tick();
  assert.equal(h.timers.size, 0);
  assert.equal(h.buttons.completeSession.disabled, true);
  assert.deepEqual(calls, ['/api/coach/sessions/77/sets/0/1']);
  release();
  await finish;
  assert.equal(recordedReps, 10);
  assert.equal(calls.at(-1), '/api/coach/sessions/77/complete');
});

test('coach save failure keeps draft editable and never completes; retry saves the same input', async () => {
  const calls = [];
  let fail = true;
  const h = await harness(async (path) => { calls.push(path); if (fail) throw new Error('offline'); return {}; });
  await h.handlers.completeSession();
  assert.equal(calls.some((path) => path.endsWith('/complete')), false);
  assert.equal(h.buttons.completeSession.disabled, false);
  assert.equal(h.fields['actual-reps'].value, '9');
  assert.equal(h.form.isConnected, true);
  fail = false;
  await h.handlers.completeSession();
  assert.equal(calls.at(-1).endsWith('/complete'), true);
});

test('coach cannot finish after clearing a previously completed set field', async () => {
  const calls = [];
  const h = await harness(async (path) => { calls.push(path); return {}; });
  h.fields['actual-rir'].value = '';
  await h.handlers.completeSession();
  assert.deepEqual(calls, []);
  assert.equal(h.buttons.completeSession.disabled, false);
  assert.match(h.messages.at(-1), /填写或跳过/);
});
