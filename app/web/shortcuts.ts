export type Shortcut = 'immersive' | 'search' | 'help' | 'escape';
type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'repeat' | 'defaultPrevented' | 'keyCode'>;

/** No modified browser/OS shortcuts are claimed. Escape remains available in forms. */
export function shortcutFor(event: KeyInput, editing: boolean, enabled: boolean): Shortcut | undefined {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === 'Escape' && !event.shiftKey) return 'escape';
  if (!enabled || editing) return;
  if (event.key.toLowerCase() === 'f' && !event.shiftKey) return 'immersive';
  if (event.key === '/' && !event.shiftKey) return 'search';
  if (event.key === '?') return 'help';
}

export function isEditing(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="listbox"],[role="spinbutton"]'));
}

export function restoreFocus(element: HTMLElement | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const target = element?.isConnected && element.getClientRects().length ? element : fallback;
    target?.focus({ preventScroll: true });
  });
}
