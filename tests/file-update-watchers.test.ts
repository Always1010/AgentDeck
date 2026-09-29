import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FileUpdates } from '../app/server/updates.js';
import { PathPolicy } from '../app/server/path-policy.js';
import { mountSchema, type Mount } from '../app/shared/model.js';

const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  watch: watchMock,
}));

type ChangeCallback = (event: string, filename: string | Buffer | null) => void;
class FakeWatcher extends EventEmitter {
  closed = false;
  close = vi.fn(() => { this.closed = true; });
  unref = vi.fn(() => this);
  constructor(readonly directory: string, readonly callback: ChangeCallback) { super(); }
}

let temp: string, root: string, nested: string, updates: FileUpdates, mounts: Mount[];
let watchers: FakeWatcher[];
const filter = { mode: 'allow' as const, extensions: ['.md'], custom: [] };
const activeWatcher = (directory: string) => [...watchers].reverse().find(w => w.directory === directory && !w.closed);
async function settle() {
  // Keep filesystem I/O real while advancing only the service's timers.
  for (let attempt = 0; attempt < 1000 && updates.snapshot().busy; attempt++) await delay(5);
  expect(updates.snapshot().busy).toBe(false);
}
async function advance(milliseconds: number) {
  await vi.advanceTimersByTimeAsync(milliseconds);
  await settle();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  watchers = [];
  watchMock.mockReset();
  watchMock.mockImplementation((directory: string, callback: ChangeCallback) => {
    const watcher = new FakeWatcher(directory, callback);
    watchers.push(watcher);
    return watcher;
  });
  temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-watchers-')));
  root = path.join(temp, 'project');
  nested = path.join(root, 'nested');
  await fs.mkdir(path.join(nested, 'leaf'), { recursive: true });
  await fs.writeFile(path.join(nested, 'old.md'), 'old');
  await fs.writeFile(path.join(nested, 'leaf', 'deep.md'), 'deep');
  const state = path.join(temp, 'state');
  await fs.mkdir(state);
  mounts = [mountSchema.parse({ id: 'mount', projectId: 'project', label: '资料', absolutePath: root })];
  updates = new FileUpdates(state, new PathPolicy(state), () => mounts, () => {});
  await updates.configure(filter);
  expect(watchers).toHaveLength(3);
  expect(updates.snapshot().errors).toEqual([]);
});

afterEach(async () => {
  await updates?.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

test.each(['string', 'buffer'] as const)('an anomalous %s filename closes the affected tree, safely reconciles and recovers after cooldown', async encoding => {
  const old = activeWatcher(nested)!;
  const child = activeWatcher(path.join(nested, 'leaf'))!;
  const outside = path.join(temp, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.md'), 'outside');
  await fs.writeFile(path.join(nested, 'new.md'), 'new');
  const read = vi.spyOn(fs, 'readdir');
  old.callback('rename', encoding === 'buffer' ? Buffer.from(outside) : outside);
  expect(old.closed).toBe(true);
  expect(child.closed).toBe(true);
  expect(activeWatcher(root)).toBeDefined();
  await advance(650);
  expect(updates.snapshot().items.map(item => item.relativePath)).toContain('nested/new.md');
  expect(read.mock.calls.some(([directory]) => String(directory) === outside)).toBe(false);
  expect(activeWatcher(nested)).toBeUndefined();
  await updates.reconcile();
  expect(activeWatcher(nested)).toBeUndefined();
  await advance(29_349);
  expect(activeWatcher(nested)).toBeUndefined();
  await advance(1);
  expect(activeWatcher(nested)).toBeUndefined();
  await advance(650);
  expect(activeWatcher(nested)).toBeDefined();
  expect(activeWatcher(nested)).not.toBe(old);
  expect(activeWatcher(path.join(nested, 'leaf'))).toBeDefined();
});

test('callbacks and errors from a closed watcher cannot invalidate its replacement', async () => {
  const old = activeWatcher(nested)!;
  old.callback('rename', nested);
  await advance(30_650);
  const replacement = activeWatcher(nested)!;
  expect(replacement).toBeDefined();
  const pendingTimers = vi.getTimerCount();
  old.callback('rename', nested);
  old.emit('error', new Error('late error from an old handle'));
  expect(replacement.closed).toBe(false);
  expect(activeWatcher(nested)).toBe(replacement);
  expect(vi.getTimerCount()).toBe(pendingTimers);
  await fs.writeFile(path.join(nested, 'replacement.md'), 'reported by the current watcher');
  replacement.callback('rename', 'replacement.md');
  await advance(650);
  expect(updates.snapshot().items.map(item => item.relativePath)).toContain('nested/replacement.md');
});

test.each(['error', 'null rename', 'parent traversal'] as const)('%s retires the watcher and clears the warning after recovery', async trigger => {
  const old = activeWatcher(nested)!;
  if (trigger === 'error') old.emit('error', new Error('native watch failure'));
  else old.callback('rename', trigger === 'null rename' ? null : '../outside');
  expect(old.closed).toBe(true);
  expect(activeWatcher(path.join(nested, 'leaf'))).toBeUndefined();
  expect(updates.snapshot().errors.join(' ')).toContain('30 秒');
  await advance(30_650);
  expect(activeWatcher(nested)).toBeDefined();
  expect(activeWatcher(nested)).not.toBe(old);
  expect(updates.snapshot().errors).toEqual([]);
});

test('reconciliation closes watches for deleted directories even without a deletion notification', async () => {
  const old = activeWatcher(nested)!;
  const child = activeWatcher(path.join(nested, 'leaf'))!;
  await fs.rm(nested, { recursive: true, force: true });
  await updates.reconcile();
  expect(old.closed).toBe(true);
  expect(child.closed).toBe(true);
  expect(activeWatcher(nested)).toBeUndefined();
  expect(activeWatcher(root)).toBeDefined();
  expect(updates.snapshot().errors).toEqual([]);
});

test('reconciliation replaces a watch when a new directory occupies the same path', async () => {
  const old = activeWatcher(nested)!;
  const child = activeWatcher(path.join(nested, 'leaf'))!;
  const before = await fs.stat(nested);
  // Keeping the old directory alive prevents inode reuse from weakening this test.
  await fs.rename(nested, path.join(temp, 'retired-directory'));
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'new.md'), 'new directory');
  const after = await fs.stat(nested);
  expect([after.dev, after.ino, after.birthtimeMs]).not.toEqual([before.dev, before.ino, before.birthtimeMs]);
  await updates.reconcile();
  expect(old.closed).toBe(true);
  expect(child.closed).toBe(true);
  expect(activeWatcher(nested)).toBeDefined();
  expect(activeWatcher(nested)).not.toBe(old);
  expect(updates.snapshot().items.map(item => item.relativePath)).toContain('nested/new.md');
});

test('an event storm closes its watcher and cannot reopen it until the 30-second cooldown', async () => {
  const old = activeWatcher(nested)!;
  for (let count = 0; count < 1024; count++) old.callback('change', 'old.md');
  expect(old.closed).toBe(false);
  old.callback('change', 'old.md');
  expect(old.closed).toBe(true);
  await advance(650);
  await updates.reconcile();
  expect(activeWatcher(nested)).toBeUndefined();
  await advance(29_349);
  expect(activeWatcher(nested)).toBeUndefined();
  await advance(1);
  expect(activeWatcher(nested)).toBeUndefined();
  await advance(650);
  const recovered = activeWatcher(nested)!;
  expect(recovered).toBeDefined();
  await fs.writeFile(path.join(nested, 'after-storm.md'), 'recovered');
  recovered.callback('rename', 'after-storm.md');
  await advance(650);
  expect(updates.snapshot().items.map(item => item.relativePath)).toContain('nested/after-storm.md');
});

test('events spread across separate seconds do not accumulate into a false storm', async () => {
  const watcher = activeWatcher(nested)!;
  for (let count = 0; count < 1024; count++) watcher.callback('change', 'old.md');
  await advance(1001);
  for (let count = 0; count < 1024; count++) watcher.callback('change', 'old.md');
  expect(watcher.closed).toBe(false);
  await advance(650);
  expect(activeWatcher(nested)).toBe(watcher);
});

test('closing the service cancels watcher recovery and ignores already queued callbacks', async () => {
  const old = activeWatcher(nested)!;
  old.callback('rename', nested);
  const total = watchers.length;
  await updates.close();
  old.callback('rename', nested);
  old.emit('error', new Error('closed service'));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(watchers).toHaveLength(total);
  expect(watchers.every(watcher => watcher.closed)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('removing a mount during cooldown cancels recovery and its error state', async () => {
  const old = activeWatcher(nested)!;
  old.callback('rename', nested);
  mounts = [];
  await updates.reconcile();
  const total = watchers.length;
  await advance(30_000);
  expect(watchers).toHaveLength(total);
  expect(watchers.every(watcher => watcher.closed)).toBe(true);
  expect(updates.snapshot().errors).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['disabled', 'excluded'] as const)('a %s directory cannot restore its watcher when an earlier cooldown expires', async change => {
  const old = activeWatcher(nested)!;
  old.callback('rename', nested);
  mounts = mounts.map(mount => change === 'disabled' ? { ...mount, enabled: false } : { ...mount, excludes: ['nested'] });
  await updates.reconcile();
  expect(updates.snapshot().errors).toEqual([]);
  const total = watchers.length;
  await advance(30_650);
  expect(watchers).toHaveLength(total);
  expect(activeWatcher(nested)).toBeUndefined();
  expect(activeWatcher(path.join(nested, 'leaf'))).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  if (change === 'disabled') expect(watchers.every(watcher => watcher.closed)).toBe(true);
  else expect(activeWatcher(root)).toBeDefined();
});
