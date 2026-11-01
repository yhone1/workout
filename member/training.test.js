const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8').replace(/^import .*\r?\n/gm, '').replace(/\nload\(\);\s*$/, '');
const factory = import('../portal/shared/set-save-queue.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function harness() {
  const { createSetSaveQueue } = await factory;
  const elements = new Map();
  const node = () => ({ dataset: {}, disabled: false, isConnected: true, textContent: '', innerHTML: '', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  const get = (id) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const row = node();
  row.dataset = { sessionSet: '0:1', status: 'completed' };
  row.classList = { toggle() {} };
  const fields = Object.fromEntries(['actualWeight', 'actualReps', 'actualRir'].map((name) => [name, { ...node(), value: ({ actualWeight: '20', actualReps: '9', actualRir: '2' })[name] }]));
  const label = node(), skip = node(), complete = node();
  row.querySelector = (selector) => selector === '[data-set-status]' ? label : selector === '[data-skip-set]' ? skip : fields[selector.match(/data-session-field="(.*?)"/)?.[1]];
  row.querySelectorAll = () => Object.values(fields);
  const root = get('activeSession');
  root.querySelector = (selector) => selector === '[data-complete-session]' ? complete : null;
  root.querySelectorAll = (selector) => selector === '[data-session-set]' ? [row] : selector === 'button' ? [skip, complete] : [...Object.values(fields), skip, complete];
  const context = { createSetSaveQueue, console, setInterval() { return 1; }, clearInterval() {}, localStorage: { getItem() { return ''; } }, document: { getElementById: get, querySelector: () => node() }, window: { confirm: () => true }, location: {} };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.subject = { state, saveSetRow, rememberSetRow, completeSession, renderActiveSession, setRequest(fn) { request = fn; }, setRefresh(fn) { refreshSessions = fn; } };', context);
  const session = { id: 77, status: 'draft', dayName: '推', dayNo: 1, startedAt: new Date().toISOString(), snapshot: { exercises: [{ exerciseNameZh: '测试卧推', restSeconds: 90 }] }, sets: [{ exerciseIndex: 0, setNo: 1, actualWeight: 20, actualReps: 9, actualRir: 2, status: 'completed' }] };
  context.subject.state.openSession = session;
  context.subject.state.view = 'workout';
  return { subject: context.subject, session, row, fields, root, get, complete };
}

test('member autosave keeps in-progress input and never redraws the workout', async () => {
  const h = await harness();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  h.subject.setRequest(async () => { await hold; return { set: { ...h.session.sets[0] } }; });
  h.root.innerHTML = 'keep-input-elements';
  const save = h.subject.saveSetRow(h.row);
  h.fields.actualReps.value = '10';
  h.subject.rememberSetRow(h.session, h.row);
  release();
  await save;
  assert.equal(h.fields.actualReps.value, '10');
  assert.equal(h.root.innerHTML, 'keep-input-elements');
});

test('member writes serialize and a response from an old session cannot alter the newly opened one', async () => {
  const h = await harness();
  const calls = [];
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  h.subject.setRequest(async (path, options) => {
    const body = JSON.parse(options.body); calls.push({ path, body });
    if (calls.length === 1) await hold;
    return { set: body };
  });
  const old = h.subject.saveSetRow(h.row);
  h.fields.actualReps.value = '10';
  const latest = h.subject.saveSetRow(h.row);
  await tick();
  assert.equal(calls.length, 1);
  const other = { id: 88, status: 'draft', sets: [{ exerciseIndex: 0, setNo: 1, actualReps: 15 }] };
  h.subject.state.openSession = other;
  release();
  await Promise.all([old, latest]);
  assert.equal(h.session.sets[0].actualReps, 10);
  assert.equal(other.sets[0].actualReps, 15);
  assert.equal(calls.every((call) => call.path.includes('/sessions/77/')), true);
});

test('member completion saves current input and waits for autosave before submitting complete', async () => {
  const h = await harness();
  const calls = [];
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  h.subject.setRequest(async (path, options) => {
    const body = JSON.parse(options.body); calls.push({ path, body });
    if (path.endsWith('/complete')) return { session: { ...h.session, status: 'completed' } };
    if (calls.length === 1) await hold;
    return { set: body };
  });
  h.subject.setRefresh(async () => {});
  const old = h.subject.saveSetRow(h.row);
  h.fields.actualReps.value = '10'; h.fields.actualRir.value = '0';
  const finish = h.subject.completeSession();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(h.complete.disabled, true);
  release();
  await Promise.all([old, finish]);
  assert.equal(calls[1].body.actualReps, 10);
  assert.equal(calls[1].body.actualRir, 0);
  assert.equal(calls.at(-1).path.endsWith('/complete'), true);
});

test('failed member save preserves input, blocks completion, and supports retry', async () => {
  const h = await harness();
  let fail = true;
  const calls = [];
  h.subject.setRefresh(async () => {});
  h.subject.setRequest(async (path, options) => {
    calls.push(path);
    if (fail) throw new Error('offline');
    return path.endsWith('/complete') ? { session: { ...h.session, status: 'completed' } } : { set: JSON.parse(options.body) };
  });
  await h.subject.completeSession();
  assert.equal(calls.some((path) => path.endsWith('/complete')), false);
  assert.equal(h.session.status, 'draft');
  assert.equal(h.fields.actualReps.value, '9');
  assert.equal(h.complete.disabled, false);
  fail = false;
  await h.subject.completeSession();
  assert.equal(h.subject.state.openSession.status, 'completed');
});

test('member workout renders rest duration from the session snapshot, including zero', async () => {
  const h = await harness();
  h.subject.renderActiveSession();
  assert.match(h.root.innerHTML, /组间休息 90 秒/);
  h.session.snapshot.exercises[0].restSeconds = 0;
  h.subject.renderActiveSession();
  assert.match(h.root.innerHTML, /无需组间休息/);
});
