const test = require('node:test');
const assert = require('node:assert/strict');

const factory = import('./set-save-queue.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('same-set writes stay ordered while other sets can save independently', async () => {
  const { createSetSaveQueue } = await factory;
  const calls = [];
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const queue = createSetSaveQueue(async (key, value) => {
    calls.push([key, value.reps]);
    if (key === '0:1' && value.reps === 9) await hold;
    return value;
  });
  const old = queue.save('0:1', { reps: 9 });
  const latest = queue.save('0:1', { reps: 10 });
  await queue.save('0:2', { reps: 8 });
  assert.deepEqual(calls, [['0:1', 9], ['0:2', 8]]);
  assert.equal(queue.isLatest('0:1', { reps: 9 }), false);
  let finished = false;
  const flush = queue.flush().then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  release();
  await Promise.all([old, latest, flush]);
  assert.deepEqual(calls.at(-1), ['0:1', 10]);
});

test('failed writes block completion and identical input can be retried', async () => {
  const { createSetSaveQueue } = await factory;
  let attempts = 0;
  const queue = createSetSaveQueue(async () => {
    if (++attempts === 1) throw new Error('offline');
    return 'saved';
  });
  await assert.rejects(queue.save('0:1', { reps: 10 }), /offline/);
  await assert.rejects(queue.flush(), /offline/);
  assert.equal(await queue.save('0:1', { reps: 10 }), 'saved');
  await queue.flush();
  assert.equal(attempts, 2);
});

test('completion waits for writes added during a flush and deduplicates identical saves', async () => {
  const { createSetSaveQueue } = await factory;
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const queue = createSetSaveQueue(async (key, value) => { calls.push(key); if (key === 'a') await hold; return value; });
  const a = queue.save('a', { reps: 10 });
  assert.equal(queue.save('a', { reps: 10 }), a);
  const flush = queue.flush();
  queue.save('b', { reps: 8 });
  release();
  await flush;
  assert.deepEqual(calls.sort(), ['a', 'b']);
});
