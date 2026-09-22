import { useEffect, useRef, useState } from 'react';
import { BRIDGE_MARKER, BRIDGE_VERSION, type BridgeAction, type BridgeConfig } from '../shared/bridge.js';

export type ScrollPosition = { x: number; y: number };
export type HtmlKeyMode = 'web' | 'workbench';
export const isHtmlKeyMode = (value: unknown): value is HtmlKeyMode => value === 'web' || value === 'workbench';
const actions = new Set<BridgeAction>(['back', 'forward', 'sidebar', 'immersive', 'search', 'help', 'escape', 'split-rows', 'split-columns', 'maximize', 'close-tab']);

export function useHtmlBridge({ url, version, config, action, focus, position, positionChanged }: {
  url?: string; version: number; config: BridgeConfig; action?: (action: BridgeAction) => void; focus?: () => void;
  position?: ScrollPosition; positionChanged?: (position: ScrollPosition) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef('');
  const loaded = useRef(false);
  const restored = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<'waiting' | 'ready' | 'unavailable'>('waiting');
  const live = useRef({ config, action, focus, position, positionChanged });
  live.current = { config, action, focus, position, positionChanged };
  const origin = url ? new URL(url).origin : '';
  function post(type: string, fields = {}) {
    if (origin) frame.current?.contentWindow?.postMessage({ marker: BRIDGE_MARKER, version: BRIDGE_VERSION, session: session.current, type, ...fields }, origin);
  }
  function configure() { if (session.current) post('config', { config: live.current.config }); }
  function probe() {
    session.current = ''; setStatus('waiting'); clearTimeout(timer.current);
    post('probe');
    timer.current = setTimeout(() => { if (!session.current) setStatus('unavailable'); }, 2000);
  }
  useEffect(() => {
    if (!url) return;
    loaded.current = false; restored.current = false;
    function message(event: MessageEvent) {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.marker !== BRIDGE_MARKER || data.version !== BRIDGE_VERSION || typeof data.session !== 'string' || !data.session || data.session.length > 100) return;
      if (data.type === 'ready') {
        session.current = data.session; clearTimeout(timer.current); setStatus('ready'); configure();
        if (loaded.current && !restored.current && live.current.position) {
          restored.current = true; post('restore-scroll', live.current.position);
        }
        return;
      }
      if (data.session !== session.current || !live.current.config.active) return;
      if (data.type === 'focus') live.current.focus?.();
      if (data.type === 'scroll' && Number.isFinite(data.x) && Number.isFinite(data.y)) live.current.positionChanged?.({ x: data.x, y: data.y });
      if (data.type === 'action' && actions.has(data.action) && live.current.config.mode === 'workbench') {
        const current = live.current.config;
        if ((data.action === 'back' || data.action === 'forward') ? !current.navigation : data.action === 'escape' ? !current.escape : !current.singles) return;
        live.current.focus?.(); live.current.action?.(data.action);
      }
    }
    window.addEventListener('message', message); probe();
    return () => { window.removeEventListener('message', message); clearTimeout(timer.current); session.current = ''; };
  }, [url, version]);
  useEffect(configure, [config.mode, config.singles, config.navigation, config.escape, config.active, url, version]);
  function onLoad() { loaded.current = true; probe(); }
  return { frame, status, onLoad };
}
