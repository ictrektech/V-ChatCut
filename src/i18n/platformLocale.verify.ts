import assert from 'node:assert/strict';

const documentElement = { lang: 'en' };
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { documentElement },
});

type LocaleEvent = { locale?: string } | null;
const listeners: ((payload: LocaleEvent) => void)[] = [];
const platformState = { locale: 'zh-CN' };
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    parent: {},
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    vos_platform: {
      broadcast: {
        on: (_event: string, handler: (payload: LocaleEvent) => void) => {
          listeners.push(handler);
          return () => { listeners.splice(listeners.indexOf(handler), 1); };
        },
      },
      getState: async () => ({ ...platformState }),
    },
  },
});

const { alignWithPlatformLocale, getLocale, setLocale } = await import('./locale');
const emit = (payload: LocaleEvent): void => { for (const listener of listeners) listener(payload); };

// No saved choice: the platform language wins over the browser language.
await alignWithPlatformLocale();
assert.equal(getLocale(), 'zh', 'the VOS platform locale must be the default');
assert.equal(documentElement.lang, 'zh-CN');

// A later platform switch reaches the app.
assert.equal(listeners.length, 1, 'locale-change must be subscribed');
emit({ locale: 'en-US' });
assert.equal(getLocale(), 'en');

// An explicit in-app choice outranks later platform switches.
setLocale('it');
emit({ locale: 'zh-CN' });
assert.equal(getLocale(), 'it', 'the app-level choice must survive a platform change');

console.log('platformLocale.verify: the app follows VOS language unless the user picked one');
