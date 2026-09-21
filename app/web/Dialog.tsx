import { useEffect, useRef, type ReactNode } from 'react';
import { restoreFocus, shortcutFor } from './shortcuts.js';

const focusable = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';

export function Dialog({ label, close, children, wide = false, nested = false }: { label: string; close: () => void; children: ReactNode; wide?: boolean; nested?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const topmost = () => Array.from(document.querySelectorAll('[data-workbench-dialog]')).at(-1) === dialog;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter(el => el.getClientRects().length > 0);
    function focusFirst() { (dialog.querySelector<HTMLElement>('[data-autofocus]') || controls()[0] || dialog).focus(); }
    focusFirst();
    function keydown(event: KeyboardEvent) {
      if (!topmost()) return;
      if (shortcutFor(event, false, false) === 'escape') {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current();
      } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const items = controls();
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last!.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    function focusin(event: FocusEvent) {
      if (topmost() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    }
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      restoreFocus(previous, document.querySelector<HTMLElement>('.immersion-toggle'));
    };
  }, []);
  return <div className={`overlay ${nested ? 'nested' : ''}`}><section ref={ref} role="dialog" aria-modal="true" aria-label={label} data-workbench-dialog tabIndex={-1} className={`dialog ${wide ? 'wide' : ''}`}>{children}</section></div>;
}
