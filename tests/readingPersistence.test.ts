import { afterEach, expect, test, vi } from 'vitest';
import { createReadingPersistenceController } from '../app/web/useReadingPersistence.js';
import { initialWorkspace } from '../app/web/workspace.js';
import type { ReadingSnapshot } from '../app/web/readingSessions.js';

afterEach(() => vi.useRealTimers());
function state(): ReadingSnapshot {
  return { version: 1, workspace: initialWorkspace('report'), positions: { report: { x: 0, y: 0 } }, expanded: {}, view: { immersive: false, collapsed: false, width: 280, openedExpanded: true, view: 'files', query: '' } };
}

test('programmatic position changes save the latest position without recording activity even while visible', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const snapshot = state();
  const writes: { activity: boolean | number | undefined; y: number }[] = [];
  const controller = createReadingPersistenceController({ capture: () => snapshot, save: async (next, activity) => { writes.push({ activity, y: next.positions.report.y }); }, foreground: () => true, now: () => Date.now() });
  await controller.flush();
  await vi.advanceTimersByTimeAsync(100);
  controller.markActivity(); await controller.flush();
  snapshot.positions.report.y = 300;
  controller.schedulePositionSave();
  await vi.advanceTimersByTimeAsync(250);
  expect(writes).toEqual([{ activity: 1000, y: 0 }, { activity: 1100, y: 0 }, { activity: false, y: 300 }]);
});

test('foreground input retains its event time through idle delay and a hidden-page flush', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let foreground = false;
  const save = vi.fn(async (_snapshot: ReadingSnapshot, _activity?: boolean | number) => undefined);
  const controller = createReadingPersistenceController({ capture: state, save, foreground: () => foreground, now: () => Date.now() });
  foreground = true;
  controller.markActivity();
  await vi.advanceTimersByTimeAsync(100);
  foreground = false;
  controller.schedulePositionSave();
  await controller.flush();
  expect(save.mock.calls[0][1]).toBe(1000);
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(1);
});

test('a failed save retries the old input time and preserves newer input received during the write', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let reject!: (error: Error) => void;
  const first = new Promise<void>((_, fail) => { reject = fail; });
  const save = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
  const controller = createReadingPersistenceController({ capture: state, save, foreground: () => true, now: () => Date.now() });
  const writing = controller.flush();
  const failure = expect(writing).rejects.toThrow('quota');
  await vi.advanceTimersByTimeAsync(100);
  controller.markActivity();
  reject(new Error('quota')); await failure;
  await vi.advanceTimersByTimeAsync(250);
  expect(save.mock.calls[0][1]).toBe(1000);
  expect(save.mock.calls[1][1]).toBe(1100);
});
