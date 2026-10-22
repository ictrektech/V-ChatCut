// Language status + t(): The original Chinese text is the key (no additional key namespace is created),
// if the active-language dictionary cannot be found, it will fall back to Chinese.
// Never go blank. Switch persistence localStorage('cc.locale'), subscription rerendering (useSyncExternalStore).
// Rules: Use useT() (subscription switching) in React components; pure helper modules can directly import { t }
//  — As long as the component that renders its output calls useT(), it will be recalculated when switching languages.
// LLM interface (systemPrompt/tool ​​description/skill content) and persistent dynamic history tags do not enter i18n.
// Default language: the saved choice wins; otherwise the VOS platform language when embedded,
// otherwise the system language (zh/ru), and English for everything else.
import { useSyncExternalStore } from 'react';
import { ensureLocaleDict, localeDictReady, localeDicts } from './dictRegistry';

export { ensureLocaleDict } from './dictRegistry';

export type Locale = 'zh' | 'en' | 'it' | 'ru';

export const ALL_LOCALES: readonly Locale[] = ['zh', 'en', 'it', 'ru'];

const STORAGE_KEY = 'cc.locale';
const DOCUMENT_LANG: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
  it: 'it',
  ru: 'ru',
};

function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en' || value === 'it' || value === 'ru';
}

function readStored(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Private mode / storage disabled → system language below.
    return null;
  }
}

function systemLocale(): Locale {
  try {
    const tag = String(navigator.language ?? '').toLowerCase();
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('it')) return 'it';
    if (tag.startsWith('ru')) return 'ru';
    return 'en';
  } catch {
    return 'en';
  }
}

// An in-app choice outranks the platform: the top-bar toggle is how a user says
// "this app, this language" while VOS keeps its own.
const storedAtStartup = readStored();
let explicitChoice = storedAtStartup !== null;
let current: Locale = storedAtStartup ?? systemLocale();
if (typeof document !== 'undefined') document.documentElement.lang = DOCUMENT_LANG[current];
const subscribers = new Set<() => void>();

interface PlatformLocaleState { locale?: unknown }
interface PlatformLocaleBridge {
  broadcast?: {
    on?: (event: 'locale-change', handler: (payload: PlatformLocaleState | null) => void) => unknown;
  };
  getState?: () => Promise<PlatformLocaleState | null>;
}

function platformBridge(): PlatformLocaleBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { vos_platform?: PlatformLocaleBridge }).vos_platform ?? null;
}

/** VOS broadcasts BCP-47 tags (zh-CN, en-US); a language without a dictionary lands on English. */
function platformLocale(value: unknown): Locale | null {
  const tag = typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : '';
  if (!tag) return null;
  if (tag.startsWith('zh')) return 'zh';
  if (tag.startsWith('it')) return 'it';
  if (tag.startsWith('ru')) return 'ru';
  return 'en';
}

function acceptPlatformLocale(value: unknown): void {
  if (explicitChoice) return;
  const next = platformLocale(value);
  if (next) setLocale(next, false);
}

/**
 * Follow the VOS platform language. Subscribe to `locale-change` first, then
 * align with `getState()`, so a switch made while this app starts is not lost.
 * Resolves after the snapshot is applied; no-op outside VOS or on bridges
 * older than 0.2.0 (no broadcast / getState).
 */
export async function alignWithPlatformLocale(waitMs = 1_500): Promise<void> {
  let bridge = platformBridge();
  if (!bridge && typeof window !== 'undefined' && window.parent !== window) {
    const started = Date.now();
    while (!bridge && Date.now() - started < waitMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      bridge = platformBridge();
    }
  }
  if (!bridge) return;
  let events = 0;
  try {
    bridge.broadcast?.on?.('locale-change', (payload) => {
      events += 1;
      acceptPlatformLocale(payload?.locale);
    });
  } catch {
    // Older bridge without event broadcast: the snapshot below still applies.
  }
  const beforeSnapshot = events;
  try {
    const state = await bridge.getState?.();
    if (events === beforeSnapshot) acceptPlatformLocale(state?.locale);
  } catch {
    // getState is optional; keep the browser/system language instead.
  }
}

export function getLocale(): Locale {
  return current;
}

/**
 * Re-read the saved choice. VOS installs the per-user storage partition after
 * this module loads, so the startup read only sees the unpartitioned store; a
 * choice found there belongs to another scope and must not outrank the platform.
 */
export function refreshStoredLocale(): void {
  const stored = readStored();
  explicitChoice = stored !== null;
  const next = stored ?? systemLocale();
  if (next !== current) setLocale(next, false);
}

/** Subscribe to locale switches; returns the unsubscribe function. */
export function subscribeLocale(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => { subscribers.delete(onChange); };
}

export function localeLanguageName(locale: Locale): 'Chinese' | 'English' | 'Italian' | 'Russian' {
  if (locale === 'zh') return 'Chinese';
  if (locale === 'it') return 'Italian';
  if (locale === 'ru') return 'Russian';
  return 'English';
}

export function localizedCatalogText(
  english: string,
  chinese: string,
  locale: Locale = current,
): string {
  return locale === 'zh' ? chinese : english;
}

function notifySubscribers(): void {
  subscribers.forEach((notify) => notify());
}

export function setLocale(next: Locale, persist = true): void {
  if (persist) explicitChoice = true;
  if (next === current) return;
  const alreadyLoaded = localeDictReady(next);
  current = next;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* If the private mode cannot be saved, it will only affect this session */ }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = DOCUMENT_LANG[next];
  }
  // Switch the UI now — an unloaded dictionary renders the Chinese original
  // rather than nothing — then re-render once the dictionary lands. In practice
  // prefetchLocaleDicts() has already loaded it and no second pass happens.
  notifySubscribers();
  if (!alreadyLoaded) void ensureLocaleDict(next).then(notifySubscribers);
}

/**
 * Warm the dictionaries the user has not selected, so switching language is
 * instant. Call after the first paint — never before, it competes with it.
 */
export function prefetchLocaleDicts(): void {
  for (const locale of ALL_LOCALES) {
    if (locale !== current) void ensureLocaleDict(locale);
  }
}

/** t('Selected {n}', { n: 3 }) - The Chinese original text is the key; the placeholder {name} has the same name in both languages. */
export function t(zh: string, params?: Record<string, string | number>): string {
  const { ui, uiFallback } = localeDicts(current);
  const raw = ui[zh] ?? uiFallback[zh] ?? zh;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/** Two-way data localization: **data** names (template names, etc.) are displayed according to the current language in the table lookup. If not found, they are returned as they are.
 * English key data (211 built-in items) zh state walking ZH_DATA; Chinese key data (self-made package) en state walking EN_DATA.
 * It is only used for display and does not change the data itself (the name is also a reference key). */
export function tData(text: string): string {
  const { data, dataFallback } = localeDicts(current);
  return data[text] ?? dataFallback[text] ?? text;
}

/** Get t in the component: subscribe to language switching, trigger rerendering of this component when switching. */
export function useT(): typeof t {
  useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    () => current,
    () => current,
  );
  return t;
}
