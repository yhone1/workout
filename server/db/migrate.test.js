const test = require('node:test');
const assert = require('node:assert/strict');
const { runMigrations } = require('./migrate');

test('schema migrations are not replayed on the next startup', async () => {
  const applied = new Set();
  const executed = [];
  const client = {
    async query(sql, args = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.startsWith('SELECT 1 FROM schema_migrations')) {
        return { rows: applied.has(args[0]) ? [{}] : [], rowCount: applied.has(args[0]) ? 1 : 0 };
      }
      executed.push(sql);
      const version = sql.match(/INSERT\s+INTO\s+schema_migrations[\s\S]*?VALUES\s*\('([^']+)'/i)?.[1];
      if (version) applied.add(version);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; },
    async connect() { return client; },
  };

  await runMigrations(pool);
  await runMigrations(pool);

  assert.equal(executed.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS coach_capacity_tiers')).length, 1);
});
