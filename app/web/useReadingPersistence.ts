import { useEffect, useRef, useState } from 'react';
import type { ReadingSession, ReadingSnapshot } from './readingSessions.js';
import { createPersistenceScheduler } from './persistenceScheduler.js';

/** Position changes can come from scripts or restoration; only explicit foreground input affects recency. */
export function createReadingPersistenceController(options: {
  capture: () => ReadingSnapshot;
  save: ReadingSession['save'];
  foreground: () => boolean;
  now: () => number;
  saved?: () => void;
  failed?: (error: unknown) => void;
}) {
  let activityAt = options.foreground() ? options.now() : 0;
  const scheduler = createPersistenceScheduler(async () => {
    const capturedActivity = activityAt; activityAt = 0;
    try {
      await options.save(options.capture(), capturedActivity || false);
      options.saved?.();
    } catch (error) {
      // Retry the original event time, never promote an old event to the later retry time.
      activityAt = Math.max(activityAt, capturedActivity);
      options.failed?.(error);
      throw error;
    }
  });
  function markActivity() {
    if (!options.foreground()) return;
    activityAt = Math.max(activityAt, options.now());
    scheduler.schedule();
  }
  return { markActivity, schedulePositionSave: scheduler.schedule, flush: scheduler.flush, cancel: scheduler.cancel };
}

/** Structural changes save immediately; idle activity only updates foreground recency. */
export function useReadingPersistence(session: ReadingSession | null, snapshot: ReadingSnapshot, options: { capture?: () => ReadingSnapshot } = {}) {
  const latest = useRef({ session, snapshot, capture: options.capture }); latest.current = { session, snapshot, capture: options.capture };
  const [saveError, setSaveError] = useState('');
  const scheduler = useRef<ReturnType<typeof createReadingPersistenceController> | null>(null);
  scheduler.current ||= createReadingPersistenceController({
    capture: () => latest.current.capture?.() || latest.current.snapshot,
    save: (value, activity) => latest.current.session?.save(value, activity) || Promise.resolve(),
    foreground: () => document.visibilityState === 'visible',
    now: () => Date.now(),
    saved: () => setSaveError(''),
    failed: error => setSaveError(`当前更改未能保存：${(error as Error).message}`),
  });
  const { markActivity, schedulePositionSave } = scheduler.current;
  useEffect(() => { void scheduler.current!.flush().catch(() => undefined); }, [session, snapshot]);
  useEffect(() => {
    const mark = (event: Event) => { if (event.isTrusted) markActivity(); };
    const hide = () => { void scheduler.current!.flush().catch(() => undefined); };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); };
    // Ownership remains with this document, including BFCache; destruction releases Web Locks.
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('keydown', mark, true);
    document.addEventListener('wheel', mark, { capture: true, passive: true });
    document.addEventListener('touchmove', mark, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    return () => {
      scheduler.current!.cancel();
      document.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('keydown', mark, true);
      document.removeEventListener('wheel', mark, true);
      document.removeEventListener('touchmove', mark, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
    };
  }, [session]);
  return { saveError, retrySave: () => { void scheduler.current!.flush().catch(() => undefined); }, markActivity,
    flush: () => scheduler.current!.flush(), schedulePositionSave };
}
