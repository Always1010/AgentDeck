import { describe, expect, it } from 'vitest';
import { shortcutFor } from '../app/web/shortcuts.js';

const key = (value: string, options = {}) => ({ key: value, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, keyCode: 0, ...options });
describe('workbench shortcut ownership', () => {
  it('uses single keys and lets Escape work independently of the single-key preference', () => {
    expect(shortcutFor(key('f'), false, true)).toBe('immersive');
    expect(shortcutFor(key('F'), false, true)).toBe('immersive');
    expect(shortcutFor(key('/'), false, true)).toBe('search');
    expect(shortcutFor(key('?', { shiftKey: true }), false, true)).toBe('help');
    expect(shortcutFor(key('Escape'), true, false)).toBe('escape');
    for (const value of ['f', '/', '?']) {
      expect(shortcutFor(key(value), true, true)).toBeUndefined();
      expect(shortcutFor(key(value), false, false)).toBeUndefined();
    }
  });
  it('never claims browser and operating system modifier combinations', () => {
    for (const value of ['f', 'k', 'l', 'j', '/', '?', 'Escape', 'F11', 'r', 'd', 'Tab']) {
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
        expect(shortcutFor(key(value, { [modifier]: true }), false, true)).toBeUndefined();
        expect(shortcutFor(key(value, { [modifier]: true, shiftKey: true }), false, true)).toBeUndefined();
      }
    }
    expect(shortcutFor(key('F11'), false, true)).toBeUndefined();
  });
  it('ignores composition, legacy IME events, repeats and events owned by another control', () => {
    for (const value of ['f', '/', '?', 'Escape']) {
      for (const options of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) {
        expect(shortcutFor(key(value, options), false, true)).toBeUndefined();
      }
    }
  });
});
