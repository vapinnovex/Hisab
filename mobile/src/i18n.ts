import { useSyncExternalStore } from 'react';
import type { Language } from './types';
import hi from './locales/hi.json';
import mr from './locales/mr.json';

const catalogs: Record<Language, Record<string, string>> = { en: {}, hi, mr };
const listeners = new Set<() => void>();
let active: Language = 'en';
export function getLanguage() {
  return active;
}
export function setLanguage(language: Language) {
  if (active === language) return;
  active = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  listeners.forEach((listener) => listener());
}
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLanguage,
    () => 'en' as Language,
  );
}
export function localeTag() {
  return `${active}-IN`;
}
export function weekdays() {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => t(day));
}
export function roleLabel(role: string) {
  return t(role === 'OWNER' ? 'Owner' : role === 'WORKER' ? 'Worker' : 'Manager');
}
export function countryName(region: string, fallback: string) {
  try {
    return new Intl.DisplayNames([localeTag()], { type: 'region' }).of(region) || fallback;
  } catch {
    return fallback;
  }
}
export function t(source: string, values: unknown[] = [], language = active): string {
  const text = catalogs[language][source] ?? source;
  return text.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
// Keep static label tables reactive without changing enum values or user data.
export function localized<T extends object>(factory: () => T): T {
  return new Proxy(factory(), { get: (_target, key) => Reflect.get(factory(), key) });
}
const keys = {
  home: 'Home',
  attendance: 'Attendance',
  myAttendance: 'My attendance',
  team: 'Team',
  account: 'Account',
  language: 'Language',
  saveLanguage: 'Save language',
  useShopDefault: 'Use shop default',
};
export function translate(language: Language, key: keyof typeof keys) {
  return t(keys[key], [], language);
}
export function original(text: string): string {
  const entries = Object.entries(catalogs[active]);
  const exact = entries.find(([, value]) => value === text);
  if (exact) return exact[0];
  // Dynamic button titles still need their source meaning for icons/validation.
  return (
    entries.find(
      ([, value]) =>
        value.includes('{0}') &&
        new RegExp(
          '^' +
            value
              .split(/\{\d+\}/)
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('.*') +
            '$',
        ).test(text),
    )?.[0] ?? text
  );
}
