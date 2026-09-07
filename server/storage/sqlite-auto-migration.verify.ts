import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'chatcut-auto-sqlite-'));
process.env.OPENCHATCUT_DATA_DIR = root;
delete process.env.OPENCHATCUT_SQLITE_STORE;
const { runtimeProfile } = await import('../runtime-profile.ts');
const { initializeSqliteProjectStore, sqliteReadEntry, sqliteWriteEntry, resetSqliteStoreForTests } = await import('./sqlite-store.ts');
try {
  const directory = runtimeProfile().projectStore.directory;
  mkdirSync(directory, { recursive: true });
  const source = join(directory, 'project%3Aauto.json');
  const original = JSON.stringify({ title: 'Original project' });
  writeFileSync(source, original);
  process.env.OPENCHATCUT_SQLITE_STORE = '0';
  assert.equal((await initializeSqliteProjectStore()).enabled, false);
  delete process.env.OPENCHATCUT_SQLITE_STORE;
  const statuses = await Promise.all([initializeSqliteProjectStore(), initializeSqliteProjectStore()]);
  assert.ok(statuses.every((status) => status.enabled && status.phase === 'complete'));
  assert.deepEqual(await sqliteReadEntry('project:auto'), { found: true, value: { title: 'Original project' } });
  assert.equal(readFileSync(source, 'utf8'), original);
  await sqliteWriteEntry('project:auto', { title: 'SQLite edit' });
  resetSqliteStoreForTests();
  assert.equal((await initializeSqliteProjectStore()).enabled, true);
  assert.deepEqual(await sqliteReadEntry('project:auto'), { found: true, value: { title: 'SQLite edit' } });
  assert.equal(readFileSync(source, 'utf8'), original);
  console.log('Automatic SQLite migration preserves JSON, respects opt-out, and does not replay after restart');
} finally {
  resetSqliteStoreForTests();
  rmSync(root, { recursive: true, force: true });
}
