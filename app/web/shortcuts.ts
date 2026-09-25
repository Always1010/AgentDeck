export type Shortcut = 'immersive' | 'sidebar' | 'search' | 'help' | 'escape' | 'back' | 'forward' | 'split-rows' | 'split-columns' | 'maximize' | 'toggle-keep-tab' | 'close-tab' | 'close-pane';
type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'repeat' | 'defaultPrevented' | 'keyCode'>;

/** Navigation claims only exact Alt+arrows; other browser/OS combinations remain untouched. */
export function shortcutFor(event: KeyInput, editing: boolean, enabled: boolean, navigation = false): Shortcut | undefined {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey) return;
  if (navigation && event.altKey && !event.shiftKey) {
    if (event.key === 'ArrowLeft') return 'back';
    if (event.key === 'ArrowRight') return 'forward';
  }
  if (event.repeat || event.altKey) return;
  if (event.key === 'Escape' && !event.shiftKey) return 'escape';
  if (!enabled || editing) return;
  if (!event.shiftKey) {
    if (event.key.toLowerCase() === 'o') return 'split-rows';
    if (event.key.toLowerCase() === 'e') return 'split-columns';
    if (event.key.toLowerCase() === 'x') return 'maximize';
    if (event.key.toLowerCase() === 'p') return 'toggle-keep-tab';
    if (event.key.toLowerCase() === 'w') return 'close-tab';
    if (event.key.toLowerCase() === 'q') return 'close-pane';
  }
  if (event.key.toLowerCase() === 'b' && !event.shiftKey) return 'sidebar';
  if (event.key.toLowerCase() === 'f' && !event.shiftKey) return 'immersive';
  if (event.key === '/' && !event.shiftKey) return 'search';
  if (event.key === '?') return 'help';
}

export function isEditing(target: EventTarget | null, path: EventTarget[] = []) {
  return [target, ...path].some(node => node instanceof Element && Boolean(node.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="slider"],[role="listbox"],[role="spinbutton"],.monaco-editor,.cm-editor,.CodeMirror')));
}

export function restoreFocus(element: HTMLElement | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const target = element?.isConnected && element.getClientRects().length ? element : fallback;
    target?.focus({ preventScroll: true });
  });
}
