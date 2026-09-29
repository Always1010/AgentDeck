import { expect, test } from 'vitest';
import { createReadingSessionManager, validateReadingSnapshot, type ReadingSessionStore, type ReadingSnapshot } from '../app/web/readingSessions.js';

function snapshot(file = 'report'): ReadingSnapshot {
  return {
    version: 1,
    workspace: {
      panes: { 0: { items: [{ id: file, kept: true }], active: file, recent: [file] } },
      histories: { 0: { entries: [file], index: 0 } },
      active: 0, root: { type: 'pane', pane: 0 }, maximized: null, nextPane: 1,
    },
    view: { immersive: false, collapsed: false, width: 280, openedExpanded: true, view: 'files', query: '' },
    positions: { '0:report': { x: 0, y: 520 } },
    expanded: { files: ['folder'] },
  };
}

function environment(supportsOwnership = true) {
  const records = new Map<string, unknown>();
  const owners = new Set<string>();
  let sequence = 0;
  let now = 100;
  const store: ReadingSessionStore = {
    get: async id => structuredClone(records.get(id) ?? null),
    list: async () => structuredClone([...records.values()]),
    put: async record => { records.set(record.id, structuredClone(record)); },
  };
  const manager = createReadingSessionManager({
    store,
    supportsOwnership,
    claim: async id => {
      if (owners.has(id)) return null;
      owners.add(id);
      return () => { owners.delete(id); };
    },
    newId: () => `scene-${++sequence}`,
    now: () => ++now,
  });
  return { ...manager, store, records, owners };
}

test('validates a complete multi-pane scene, including tree and per-pane histories', () => {
  const scene = snapshot();
  scene.workspace.panes[3] = { items: [], active: '', recent: [] };
  scene.workspace.histories[3] = { entries: [], index: -1 };
  scene.workspace.root = { type: 'split', id: 'split-a', direction: 'columns', ratio: 35, first: { type: 'pane', pane: 0 }, second: { type: 'pane', pane: 3 } };
  scene.workspace.nextPane = 4;
  scene.workspace.maximized = 3;
  expect(validateReadingSnapshot(scene)).toBe(true);
});

test('rejects malformed trees, missing panes, impossible histories and stale active references', () => {
  const mutations: ((value: any) => void)[] = [
    value => { value.version = 2; },
    value => { value.workspace.root.pane = 8; },
    value => { value.workspace.root = { type: 'split', id: 'same', direction: 'rows', ratio: 50, first: value.workspace.root, second: value.workspace.root }; },
    value => { value.workspace.root = { type: 'split', id: 'cycle', direction: 'rows', ratio: 50, first: value.workspace.root }; value.workspace.root.second = value.workspace.root; },
    value => { value.workspace.panes[1] = structuredClone(value.workspace.panes[0]); },
    value => { value.workspace.active = 1; },
    value => { value.workspace.maximized = 1; },
    value => { value.workspace.nextPane = 0; },
    value => { value.workspace.histories[0].index = 5; },
    value => { delete value.workspace.histories[0]; },
    value => { value.workspace.panes[0].active = 'missing'; },
    value => { value.workspace.panes[0].recent.push('missing'); },
    value => { value.workspace.panes[0].items.push(value.workspace.panes[0].items[0]); },
    value => { value.view.width = NaN; },
    value => { value.positions.test = { x: 0, y: Infinity }; },
  ];
  for (const mutate of mutations) { const value = snapshot(); mutate(value); expect(validateReadingSnapshot(value)).toBe(false); }
  expect(validateReadingSnapshot(null)).toBe(false);
});

test('reopens an unowned scene and forks a live scene without cross-tab writes', async () => {
  const env = environment();
  const a = await env.openReadingSession();
  await a.save(snapshot('a'), true);
  const b = await env.openReadingSession(a.id);
  expect(b.id).not.toBe(a.id);
  expect(b.snapshot).toEqual(a.snapshot);
  await b.save(snapshot('b'), true);
  expect((await env.store.get(a.id) as any).snapshot.workspace.panes[0].active).toBe('a');
  a.close();
  await Promise.resolve();
  const reopened = await env.openReadingSession(a.id);
  expect(reopened.id).toBe(a.id);
  expect(reopened.snapshot?.workspace.panes[0].active).toBe('a');
});

test('new pages start from the last foreground activity, even after another scene saves in background', async () => {
  const env = environment();
  const a = await env.openReadingSession();
  await a.save(snapshot('a'), true);
  const b = await env.openReadingSession();
  await b.save(snapshot('b'), true);
  await a.save(snapshot('a-background'));
  const recent = await env.listReadingSessions();
  expect(recent[0].id).toBe(b.id);
  expect(recent[1].updatedAt).toBeGreaterThan(recent[0].updatedAt);
  const c = await env.openReadingSession();
  expect(c.snapshot?.workspace.panes[0].active).toBe('b');
  expect(c.id).not.toBe(b.id);
});

test('without exclusive browser locks each document conservatively saves an independent copy', async () => {
  const env = environment(false);
  const a = await env.openReadingSession();
  await a.save(snapshot(), true);
  a.close();
  const b = await env.openReadingSession(a.id);
  expect(b.id).not.toBe(a.id);
  expect(b.snapshot).toEqual(a.snapshot);
});

test('save captures state at call time, serializes commits, and releases ownership after pending saves', async () => {
  const env = environment();
  const session = await env.openReadingSession();
  const persist = env.store.put;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const entered: string[] = [];
  const committed: ReadingSnapshot[] = [];
  env.store.put = async record => {
    entered.push(record.snapshot.workspace.panes[0].active);
    if (entered.length === 1) await firstGate;
    committed.push(structuredClone(record.snapshot));
    await persist(record);
  };
  const state = snapshot('first');
  const first = session.save(state, true);
  state.workspace.panes[0].items[0].title = 'changed after save';
  const second = session.save(snapshot('second'), true);
  await Promise.resolve();
  expect(entered).toEqual(['first']);
  session.close();
  expect(env.owners.has(session.id)).toBe(true);
  await expect(session.save(snapshot())).rejects.toThrow('已关闭');
  releaseFirst();
  await Promise.all([first, second]);
  await Promise.resolve();
  expect(entered).toEqual(['first', 'second']);
  expect(committed[0].workspace.panes[0].items[0].title).toBeUndefined();
  expect(env.owners.has(session.id)).toBe(false);
  expect((await env.store.get(session.id) as any).snapshot.workspace.panes[0].active).toBe('second');
});

test('quota failure preserves the last committed scene and a subsequent retry can succeed', async () => {
  const env = environment();
  const session = await env.openReadingSession();
  await session.save(snapshot('good'), true);
  const persist = env.store.put;
  env.store.put = async () => { throw new Error('quota'); };
  await expect(session.save(snapshot('failed'))).rejects.toThrow('quota');
  expect(session.snapshot?.workspace.panes[0].active).toBe('good');
  expect((await env.store.get(session.id) as any).snapshot.workspace.panes[0].active).toBe('good');
  env.store.put = persist;
  await session.save(snapshot('retry'));
  expect(session.snapshot?.workspace.panes[0].active).toBe('retry');
});

test('a slow write keeps only the newest pending snapshot and preserves foreground recency', async () => {
  const env = environment();
  const session = await env.openReadingSession();
  const persist = env.store.put;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  env.store.put = async record => {
    writes.push(record.snapshot.workspace.panes[0].active);
    if (writes.length === 1) await gate;
    await persist(record);
  };
  const first = session.save(snapshot('first'));
  const second = session.save(snapshot('second'), true);
  const third = session.save(snapshot('latest'));
  session.close();
  release();
  await Promise.all([first, second, third]);
  expect(writes).toEqual(['first', 'latest']);
  expect(session.snapshot?.workspace.panes[0].active).toBe('latest');
  expect((await env.store.get(session.id) as any).activeAt).toBeGreaterThan(0);
  expect(env.owners.has(session.id)).toBe(false);
});

test('a failed in-flight save does not discard the newer pending save', async () => {
  const env = environment();
  const session = await env.openReadingSession();
  const persist = env.store.put;
  let rejectFirst!: (reason: Error) => void;
  const gate = new Promise<void>((_, reject) => { rejectFirst = reject; });
  let count = 0;
  env.store.put = async record => { if (++count === 1) await gate; await persist(record); };
  const failed = session.save(snapshot('failed'));
  const checkedFailure = expect(failed).rejects.toThrow('quota');
  const latest = session.save(snapshot('latest'));
  rejectFirst(new Error('quota'));
  await checkedFailure;
  await latest;
  expect(session.snapshot?.workspace.panes[0].active).toBe('latest');
});

test('corrupt saved scenes are retained, excluded from recent scenes, and explicit restore reports the error', async () => {
  const env = environment();
  env.records.set('broken', { id: 'broken', activeAt: 100, updatedAt: 100, snapshot: { version: 1 } });
  expect(await env.listReadingSessions()).toEqual([]);
  await expect(env.openReadingSession('broken')).rejects.toThrow('原记录已保留');
  expect(env.records.has('broken')).toBe(true);
});

test('failed initial fork releases its lock and invalid saves never replace a good record', async () => {
  const env = environment();
  const session = await env.openReadingSession();
  await session.save(snapshot(), true);
  const invalid = snapshot();
  invalid.workspace.active = 9;
  await expect(session.save(invalid)).rejects.toThrow('状态无效');
  env.store.put = async () => { throw new Error('unavailable'); };
  await expect(env.openReadingSession(session.id)).rejects.toThrow('unavailable');
  expect([...env.owners]).toEqual([session.id]);
});

test('storage access failures are surfaced without creating an empty replacement scene', async () => {
  const env = environment();
  env.store.list = async () => { throw new Error('storage disabled'); };
  await expect(env.openReadingSession()).rejects.toThrow('storage disabled');
  await expect(env.listReadingSessions()).rejects.toThrow('storage disabled');
  expect(env.records.size).toBe(0);
  expect(env.owners.size).toBe(0);
});

test('a previous owner final commit between lookup and lock acquisition is hydrated before automatic saving', async () => {
  let record: unknown = { id: 'same', updatedAt: 1, activeAt: 1, snapshot: snapshot('old') };
  let released = false;
  const manager = createReadingSessionManager({
    store: {
      get: async () => structuredClone(record),
      list: async () => [structuredClone(record)],
      put: async next => { record = structuredClone(next); },
    },
    supportsOwnership: true,
    claim: async () => {
      // Model the former owner's final durable write and release after our first read.
      record = { id: 'same', updatedAt: 2, activeAt: 2, snapshot: snapshot('newest') };
      return () => { released = true; };
    },
    newId: () => 'copy',
    now: () => 3,
  });
  const session = await manager.openReadingSession('same');
  expect(session.snapshot?.workspace.panes[0].active).toBe('newest');
  await session.save(session.snapshot!);
  expect((record as any).snapshot.workspace.panes[0].active).toBe('newest');
  session.close();
  await Promise.resolve();
  expect(released).toBe(true);
});

test('corruption or read failure discovered after lock acquisition releases ownership without writing', async () => {
  for (const failRead of [false, true]) {
    let claimed = false, released = false, writes = 0;
    const good = { id: 'same', updatedAt: 1, activeAt: 1, snapshot: snapshot('good') };
    const manager = createReadingSessionManager({
      store: {
        get: async () => {
          if (claimed && failRead) throw new Error('read failure');
          return claimed ? { ...good, snapshot: {} } : good;
        },
        list: async () => [good],
        put: async () => { writes++; },
      },
      supportsOwnership: true,
      claim: async () => { claimed = true; return () => { released = true; }; },
      newId: () => 'copy',
      now: () => 3,
    });
    await expect(manager.openReadingSession('same')).rejects.toThrow(failRead ? 'read failure' : '原记录已保留');
    expect(released).toBe(true);
    expect(writes).toBe(0);
  }
});

