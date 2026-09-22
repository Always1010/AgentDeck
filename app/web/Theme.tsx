import { useEffect } from 'react';
import { usePreference } from './preferences.js';

export type ThemeChoice = 'system' | 'light' | 'dark';
const isTheme = (value: unknown): value is ThemeChoice => value === 'system' || value === 'light' || value === 'dark';

export function ThemePicker() {
  const [choice, setChoice] = usePreference<ThemeChoice>('theme', 'system', isTheme);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    function apply() {
      const theme = choice === 'system' ? system.matches ? 'dark' : 'light' : choice;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }
    apply(); system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [choice]);
  return <label className="theme-picker"><span>主题</span><select aria-label="界面主题" title="界面主题：跟随系统、浅色或深色" value={choice} onChange={e => setChoice(e.target.value as ThemeChoice)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>;
}
