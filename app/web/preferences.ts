import { useState } from 'react';

/** Browser storage is optional; preferences must not prevent opening the workbench. */
export function usePreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || 'null');
      return valid(stored) ? stored : fallback;
    } catch { return fallback; }
  });
  function update(next: T) {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session-only preference. */ }
  }
  return [value, update] as const;
}
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
