import { useEffect, useState } from 'react';
import type { FileStatusResult } from '../shared/fileOperations.js';
import { parseFileReference } from '../shared/model.js';
import { api } from './api.js';

/** One batch per visible list; hidden lists retain their last result without polling. */
export function useEntryAvailability(ids: string[], visible: boolean, revision: string) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = JSON.stringify([...new Set(ids.filter(id => parseFileReference(id)))]);
  useEffect(() => {
    if (!visible) return;
    const entries = JSON.parse(key) as string[];
    let disposed = false;
    let checking = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let controller: AbortController | undefined;
    async function check() {
      if (checking || disposed || document.visibilityState !== 'visible') return;
      checking = true;
      const request = new AbortController();
      controller = request;
      const next: Record<string, string> = {};
      try {
        for (let start = 0; start < entries.length; start += 200) {
          const result = await api<FileStatusResult>('/api/entries/status', 'POST', { ids: entries.slice(start, start + 200) }, { signal: request.signal });
          if (disposed || request.signal.aborted) return;
          for (const item of result.items) if (item.status === 'error') next[item.id] = item.error?.message || '文件不可用';
        }
        setErrors(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      } catch (error) {
        if (!disposed && !request.signal.aborted) {
          for (const id of entries) next[id] = (error as Error).message;
          setErrors(next);
        }
      } finally {
        checking = false;
      }
    }
    function visibilityChanged() {
      clearInterval(timer);
      if (document.visibilityState !== 'visible') { controller?.abort(); return; }
      void check();
      timer = setInterval(() => void check(), 4000);
    }
    visibilityChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      disposed = true;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [key, visible, revision]);
  return errors;
}
