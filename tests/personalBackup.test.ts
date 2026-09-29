import { expect, test } from 'vitest';
import { createPersonalBackupManager, parsePersonalBackup, PERSONAL_BACKUP_LIMIT, type PendingPersonalPreferences, type PersonalBackup, type PersonalBackupPersistence } from '../app/web/personalBackup.js';
import { initialWorkspace } from '../app/web/workspace.js';
import type { ReadingSnapshot, SavedReadingSession } from '../app/web/readingSessions.js';

function snapshot(): ReadingSnapshot {
  return { version: 1, workspace: initialWorkspace('file:mount:report.html'), view: { immersive: false, collapsed: false, width: 280, openedExpanded: true, view: 'files', query: '' }, positions: {}, expanded: {} };
}
function backup(): PersonalBackup {
  return { format: 'agentdeck-personal-backup', version: 1, exportedAt: new Date(1000).toISOString(), preferences: { theme: 'dark', 'reading.font-size': 16 }, favorites: ['file:mount:report.html'], collections: [{ name: '报告与工具', pinned: true, snapshot: snapshot() }] };
}
function environment() {
  const values = new Map<string, string>([['theme', '"light"'], ['favorites', '[]'], ['unrelated-secret', 'never-export']]);
  const records = new Map<string, SavedReadingSession>();
  let pending: unknown = null;
  let sequence = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence: PersonalBackupPersistence = {
    list: async () => [...records.values()],
    commit: async (next, settings) => {
      if (next.some(record => records.has(record.id)) || new Set(next.map(record => record.id)).size !== next.length) throw new Error('collision');
      for (const record of next) records.set(record.id, structuredClone(record));
      pending = structuredClone(settings);
    },
    pending: async () => structuredClone(pending),
    clearPending: async token => { if ((pending as PendingPersonalPreferences | null)?.token === token) pending = null; },
  };
  const manager = createPersonalBackupManager({ storage, persistence, newId: () => `import-${++sequence}`, now: () => 2000 });
  return { ...manager, values, records, storage, persistence, setPending: (value: unknown) => { pending = value; } };
}

test('export includes only whitelisted preferences, favorites and explicit combinations', async () => {
  const env = environment();
  env.values.set('html.shortcuts:file:secret', '"workbench"');
  env.records.set('live', { id: 'live', activeAt: 1, updatedAt: 1, snapshot: snapshot() });
  env.records.set('combo', { id: 'combo', activeAt: 0, updatedAt: 1, name: '组合', pinned: true, collection: true, snapshot: snapshot() });
  const text = await env.exportBackup();
  const data = parsePersonalBackup(text);
  expect(data.preferences).toEqual({ theme: 'light' });
  expect(data.collections).toHaveLength(1);
  expect(text).not.toContain('never-export');
  expect(text).not.toContain('"live"');
  expect(text).not.toContain('html.shortcuts:file:secret');
});

test('imports create fresh combination IDs and stage preferences without changing a live browser', async () => {
  const env = environment();
  env.records.set('live', { id: 'live', activeAt: 1, updatedAt: 1, snapshot: snapshot() });
  await env.importBackup(JSON.stringify(backup()));
  await env.importBackup(JSON.stringify(backup()));
  expect([...env.records.keys()]).toEqual(['live', 'import-1', 'import-3']);
  expect(env.values.get('theme')).toBe('"light"');
  expect(env.records.get('import-1')).toMatchObject({ collection: true, activeAt: 0, name: '报告与工具' });
  expect(await env.applyPendingPreferences()).toEqual({ applied: true });
  expect(env.values.get('theme')).toBe('"dark"');
  expect(env.values.get('favorites')).toBe('["file:mount:report.html"]');
  expect(await env.persistence.pending()).toBeNull();
  expect(env.values.get('unrelated-secret')).toBe('never-export');
});

test('invalid versions, unknown keys, malformed snapshots and oversized files do not commit', async () => {
  const mutations: ((value: any) => void)[] = [
    value => { value.version = 2; },
    value => { value.preferences['arbitrary-key'] = 'injected'; },
    value => { value.preferences['reading.font-size'] = 100; },
    value => { value.favorites = [null]; },
    value => { value.collections[0].id = 'live'; },
    value => { value.collections[0].snapshot.workspace.active = 99; },
    value => { value.collections[0].name = 'x'.repeat(121); },
  ];
  for (const change of mutations) {
    const env = environment(); const value = backup(); change(value);
    await expect(env.importBackup(JSON.stringify(value))).rejects.toThrow('无效');
    expect(env.records.size).toBe(0);
    expect(await env.persistence.pending()).toBeNull();
  }
  expect(() => parsePersonalBackup('{"__proto__":{},"version":1}')).toThrow('无效');
  expect(() => parsePersonalBackup(' '.repeat(PERSONAL_BACKUP_LIMIT + 1))).toThrow('5 MiB');
});

test('an aborted import leaves both combinations and staged preferences unchanged', async () => {
  const env = environment();
  env.persistence.commit = async () => { throw new Error('quota'); };
  await expect(env.importBackup(JSON.stringify(backup()))).rejects.toThrow('quota');
  expect(env.records.size).toBe(0);
  expect(await env.persistence.pending()).toBeNull();
  expect(env.values.get('theme')).toBe('"light"');
});

test('projection failure rolls back earlier local keys and keeps the durable pending import for retry', async () => {
  const env = environment();
  await env.importBackup(JSON.stringify(backup()));
  const write = env.storage.setItem;
  env.storage.setItem = (key, value) => { if (key === 'reading.font-size') throw new Error('quota'); write(key, value); };
  expect(await env.applyPendingPreferences()).toMatchObject({ applied: false, error: expect.stringContaining('导入记录已保留') });
  expect(env.values.get('theme')).toBe('"light"');
  expect(env.values.has('reading.font-size')).toBe(false);
  expect(await env.persistence.pending()).not.toBeNull();
  env.storage.setItem = write;
  expect(await env.applyPendingPreferences()).toEqual({ applied: true });
});

test('a malformed pending record never executes arbitrary storage keys', async () => {
  const env = environment();
  env.setPending({ id: '__agentdeck_pending_personal_preferences__', version: 1, token: 'x', values: { 'unrelated-secret': 'changed' } });
  expect(await env.applyPendingPreferences()).toMatchObject({ applied: false, error: expect.stringContaining('无效') });
  expect(env.values.get('unrelated-secret')).toBe('never-export');
});
