import { useEffect, useRef, useState } from 'react';
import type { ReadingSession, ReadingSnapshot } from './readingSessions.js';

/** Structural changes save immediately; idle activity only updates foreground recency. */
export function useReadingPersistence(session: ReadingSession | null, snapshot: ReadingSnapshot) {
  const latest = useRef(snapshot); latest.current = snapshot;
  const activity = useRef(document.visibilityState === 'visible');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saveError, setSaveError] = useState('');
  const save = useRef(() => {});
  save.current = () => {
    clearTimeout(timer.current);
    if (!session) return;
    const foreground = activity.current; activity.current = false;
    void session.save(latest.current, foreground).then(() => setSaveError('')).catch(error => setSaveError(`当前更改未能保存：${(error as Error).message}`));
  };
  function markActivity() {
    if (document.visibilityState !== 'visible') return;
    activity.current = true;
    clearTimeout(timer.current); timer.current = setTimeout(() => save.current(), 250);
  }
  useEffect(() => { save.current(); }, [session, snapshot]);
  useEffect(() => {
    const mark = () => markActivity();
    const visibility = () => { if (document.visibilityState === 'hidden') save.current(); };
    const hide = () => save.current();
    // Ownership remains with this document, including BFCache; destruction releases Web Locks.
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('keydown', mark, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('keydown', mark, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
    };
  }, [session]);
  return { saveError, retrySave: () => save.current(), markActivity };
}
