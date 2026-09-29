import { useEffect, useRef, useState } from 'react';
import type { ReadingSession, ReadingSnapshot } from './readingSessions.js';
import { createPersistenceScheduler } from './persistenceScheduler.js';

/** Structural changes save immediately; idle activity only updates foreground recency. */
export function useReadingPersistence(session: ReadingSession | null, snapshot: ReadingSnapshot, options: { capture?: () => ReadingSnapshot } = {}) {
  const latest = useRef({ snapshot, capture: options.capture }); latest.current = { snapshot, capture: options.capture };
  const activity = useRef(document.visibilityState === 'visible');
  const [saveError, setSaveError] = useState('');
  const save = useRef(async () => {});
  save.current = async () => {
    if (!session) return;
    const foreground = activity.current; activity.current = false;
    try {
      await session.save(latest.current.capture?.() || latest.current.snapshot, foreground);
      setSaveError('');
    } catch (error) {
      activity.current ||= foreground;
      setSaveError(`当前更改未能保存：${(error as Error).message}`);
      throw error;
    }
  };
  const scheduler = useRef<ReturnType<typeof createPersistenceScheduler> | null>(null);
  scheduler.current ||= createPersistenceScheduler(() => save.current());
  function markActivity() {
    if (document.visibilityState !== 'visible') return;
    activity.current = true;
    scheduler.current!.schedule();
  }
  function schedulePositionSave() {
    if (document.visibilityState === 'visible') activity.current = true;
    scheduler.current!.schedule();
  }
  useEffect(() => { void scheduler.current!.flush().catch(() => undefined); }, [session, snapshot]);
  useEffect(() => {
    const mark = () => markActivity();
    const hide = () => { void scheduler.current!.flush().catch(() => undefined); };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); };
    // Ownership remains with this document, including BFCache; destruction releases Web Locks.
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('keydown', mark, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    return () => {
      scheduler.current!.cancel();
      document.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('keydown', mark, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
    };
  }, [session]);
  return { saveError, retrySave: () => { void scheduler.current!.flush().catch(() => undefined); }, markActivity,
    flush: () => scheduler.current!.flush(), schedulePositionSave };
}
