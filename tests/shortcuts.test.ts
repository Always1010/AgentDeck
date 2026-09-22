import { describe, expect, it, vi } from 'vitest';
import { isEditing, shortcutFor } from '../app/web/shortcuts.js';

const key = (value: string, options = {}) => ({ key: value, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, keyCode: 0, ...options });
describe('workbench shortcut ownership', () => {
  it('uses single keys and lets Escape work independently of the single-key preference', () => {
    expect(shortcutFor(key('b'), false, true)).toBe('sidebar');
    expect(shortcutFor(key('B'), false, true)).toBe('sidebar');
    expect(shortcutFor(key('f'), false, true)).toBe('immersive');
    expect(shortcutFor(key('F'), false, true)).toBe('immersive');
    expect(shortcutFor(key('/'), false, true)).toBe('search');
    expect(shortcutFor(key('?', { shiftKey: true }), false, true)).toBe('help');
    expect(shortcutFor(key('Escape'), true, false)).toBe('escape');
    for (const value of ['o', 'e', 'x', 'w', 'b', 'f', '/', '?']) {
      expect(shortcutFor(key(value), true, true)).toBeUndefined();
      expect(shortcutFor(key(value), false, false)).toBeUndefined();
    }
  });
  it('maps the four reading actions to unmodified single keys, including Caps Lock', () => {
    for (const [value, action] of [['o', 'split-rows'], ['e', 'split-columns'], ['x', 'maximize'], ['w', 'close-tab']]) {
      expect(shortcutFor(key(value), false, true)).toBe(action);
      expect(shortcutFor(key(value.toUpperCase()), false, true)).toBe(action);
      expect(shortcutFor(key(value.toUpperCase(), { shiftKey: true }), false, true)).toBeUndefined();
    }
  });
  it('never claims browser and operating system modifier combinations', () => {
    for (const value of ['o', 'e', 'x', 'w', 'b', 'f', 'k', 'l', 'j', '/', '?', 'Escape', 'F11', 'r', 'd', 'Tab']) {
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
        expect(shortcutFor(key(value, { [modifier]: true }), false, true)).toBeUndefined();
        expect(shortcutFor(key(value, { [modifier]: true, shiftKey: true }), false, true)).toBeUndefined();
      }
    }
    expect(shortcutFor(key('F11'), false, true)).toBeUndefined();
  });
  it('ignores composition, legacy IME events, repeats and events owned by another control', () => {
    for (const value of ['o', 'e', 'x', 'w', 'b', 'f', '/', '?', 'Escape']) {
      for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) {
        expect(shortcutFor(key(value, options), false, true)).toBeUndefined();
      }
    }
  });
  it('keeps exact Alt arrows independent of the single-key setting and editor focus', () => {
    expect(shortcutFor(key('ArrowLeft', { altKey: true }), true, false, true)).toBe('back');
    expect(shortcutFor(key('ArrowRight', { altKey: true }), true, false, true)).toBe('forward');
    expect(shortcutFor(key('ArrowLeft', { altKey: true }), false, true, false)).toBeUndefined();
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      expect(shortcutFor(key('ArrowLeft', { altKey: true, [modifier]: true }), false, true, true)).toBeUndefined();
    }
  });
  it('protects editors inside a composed event path and recognized custom editor containers', () => {
    class ElementStub {
      constructor(private selector = '') {}
      closest(selectors: string) { return selectors.split(',').includes(this.selector) ? this : null; }
    }
    vi.stubGlobal('Element', ElementStub);
    try {
      const host = new ElementStub() as unknown as EventTarget;
      for (const selector of ['input', 'textarea', 'select', '[role="searchbox"]', '[role="textbox"]', '.monaco-editor', '.cm-editor', '.CodeMirror']) {
        const editor = new ElementStub(selector) as unknown as EventTarget;
        expect(isEditing(editor)).toBe(true);
        expect(isEditing(host, [host, editor])).toBe(true);
      }
      expect(isEditing(host)).toBe(false);
      expect(isEditing(null)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
