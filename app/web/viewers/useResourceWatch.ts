import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../../shared/model.js';
import type { ResourceVersionResult } from '../../shared/fileOperations.js';
import { api } from '../api.js';

/** An opt-in metadata check of direct siblings, never a dependency crawler. */
export function useResourceWatch({ entry, enabled, active, generation }: { entry?: Entry; enabled: boolean; active: boolean; generation: number }) {
  const baseline = useRef<{ key: string; version: string } | undefined>(undefined);
  const latest = useRef<ResourceVersionResult | undefined>(undefined);
  const [change, setChange] = useState<ResourceVersionResult>();
  const [error, setError] = useState('');
  const key = entry ? `${entry.id}:${generation}` : '';
  useEffect(() => {
    if (!enabled || !entry || !/^html?$/.test(entry.format)) {
      baseline.current = undefined; latest.current = undefined; setChange(undefined); setError(''); return;
    }
    if (baseline.current?.key !== key) {
      baseline.current = undefined; latest.current = undefined; setChange(undefined); setError('');
    }
    if (!active) return;
    const controller = new AbortController();
    let checking = false;
    async function check() {
      if (checking || controller.signal.aborted || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const result = await api<ResourceVersionResult>(`/api/mounts/${entry!.mountId}/resource-version?path=${encodeURIComponent(entry!.relativePath)}`, 'GET', undefined, { signal: controller.signal });
        if (controller.signal.aborted) return;
        latest.current = result;
        if (!baseline.current) baseline.current = { key, version: result.version };
        else if (baseline.current.version !== result.version) setChange(result);
        else setChange(undefined);
        setError('');
      } catch (error) { if (!controller.signal.aborted) setError(`同目录资源检查暂不可用：${(error as Error).message}`); }
      finally { checking = false; }
    }
    void check();
    const timer = setInterval(() => void check(), 4000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [enabled, active, key]);
  return { change, error, dismiss: () => {
    if (latest.current) baseline.current = { key, version: latest.current.version };
    setChange(undefined);
  } };
}
