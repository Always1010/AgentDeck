import { useEffect, useState } from 'react';

/** Browser storage is optional; preferences must not prevent opening the workbench. */
export function usePreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || 'null');
      return valid(stored) ? stored : fallback;
    } catch { return fallback; }
  });
  useEffect(() => {
    function changed(event: Event) {
      if (event instanceof CustomEvent && event.detail.key === key && valid(event.detail.value)) setValue(event.detail.value);
      if (event instanceof StorageEvent && event.key === key) {
        try { const value: unknown = JSON.parse(event.newValue || 'null'); setValue(valid(value) ? value : fallback); } catch { /* Ignore malformed external changes. */ }
      }
    }
    window.addEventListener('workbench-preference', changed);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('workbench-preference', changed); window.removeEventListener('storage', changed); };
  }, [key]);
  function update(next: T) {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session-only preference. */ }
    window.dispatchEvent(new CustomEvent('workbench-preference', { detail: { key, value: next } }));
  }
  return [value, update] as const;
}
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
