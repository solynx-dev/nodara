import type { ThemePreference } from '@nodara/shared';

const KEY = 'nodara.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (media().matches ? 'dark' : 'light') : pref;
}

export function applyTheme(pref: ThemePreference) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {}
  const t = resolvedTheme(pref);
  document.documentElement.dataset.theme = t;
  window.dispatchEvent(new CustomEvent('nodara:theme', { detail: t }));
}

export function storedTheme(): ThemePreference {
  try {
    return (localStorage.getItem(KEY) as ThemePreference) || 'system';
  } catch {
    return 'system';
  }
}

media().addEventListener('change', () => {
  if (storedTheme() === 'system') applyTheme('system');
});

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
