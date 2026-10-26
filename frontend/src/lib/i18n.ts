import { useSyncExternalStore } from 'react';
import en from '../../../locales/en.json';
import languageDefinitions from '../../../locales/languages.json';
import { translate, resolveLanguage } from '../../../locales/runtime.mjs';

export const languages: Record<string, { name: string; locale: string; support: string }> = languageDefinitions;
export type Language = string;
export type TranslationKey = keyof typeof en;
const STORAGE_KEY = 'betterilias_language';
const listeners = new Set<() => void>();
const modules = import.meta.glob('../../../locales/*.json', { eager: true, import: 'default' });
const catalogues: Record<string, Record<string, string>> = { en };
for (const code of Object.keys(languages)) {
  catalogues[code] = modules[`../../../locales/${code}.json`] as Record<string, string> || {};
}
let language: Language = initialLanguage();

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return resolveLanguage(stored, languages);
  } catch { /* Storage can be unavailable in private browsing. */ }
  return resolveLanguage(navigator.language, languages);
}

export function getLanguage(): Language { return language; }
export function getLocale(): string { return languages[language].locale; }
export function t(key: TranslationKey, values: Record<string, unknown> = {}): string {
  return translate(catalogues, language, key, values);
}
export function assignmentStatusText(value: string): string {
  // ILIAS's interface language may differ from BetterIlias, including cached data.
  // Only translate known interface messages; dates and lecturer content stay intact.
  switch (value.trim().toLowerCase().replace(/[.!]$/, '')) {
    case 'no deadline specified':
    case 'keine abgabefrist angegeben':
      return t('schedule.no_deadline');
    case 'no deadline':
    case 'kein abgabetermin':
      return t('Kein Abgabetermin');
    case 'time is up':
    case 'zeit abgelaufen':
    case 'abgelaufen':
      return t('schedule.time_up');
    case 'not graded':
    case 'not_graded':
    case 'nicht bewertet':
      return t('Nicht bewertet');
    case 'mandatory':
    case 'pflicht':
    case 'verpflichtend':
      return t('Pflicht');
    case 'optional':
    case 'freiwillig':
      return t('assignment.optional');
    case 'passed':
    case 'bestanden':
      return t('Bestanden');
    case 'failed':
    case 'nicht bestanden':
      return t('Nicht bestanden');
    case 'not submitted':
    case 'not_submitted':
      return t('Noch keine Abgabe');
    case 'upload':
    case 'file upload':
    case 'datei-upload':
      return t('assignment.file_upload');
    case 'team upload':
    case 'team-upload':
      return t('assignment.team_upload');
    default: return value;
  }
}
export function generatedTitle(item: { title?: string; title_key?: string; title_values?: Record<string, unknown> }): string | undefined {
  return item.title_key ? translate(catalogues, language, item.title_key, item.title_values) : item.title;
}
export function setLanguage(value: string): void {
  language = resolveLanguage(value, languages);
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Keep the in-memory preference. */ }
  document.documentElement.lang = language;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, () => 'en');
}
document.documentElement.lang = language;
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) setLanguage(event.newValue || navigator.language);
});
