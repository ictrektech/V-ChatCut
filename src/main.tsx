import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadProjectFonts } from './fonts/googleFonts';
import { hydratePlugins } from './plugins/store';
import { initSkins } from './skins';
import { bootstrapVOSSession } from './vos/auth';
import { installVOSStoragePartition } from './vos/storagePartition';
import { alignWithPlatformLocale, ensureLocaleDict, getLocale, prefetchLocaleDicts, refreshStoredLocale } from './i18n/locale';

// Kick the active locale's dictionary off FIRST so its fetch overlaps the setup
// below; the render waits on it so no frame renders untranslated copy. Only
// this one language is fetched — the other three cost nothing until switched.
const initialLocale = getLocale();
const localeReady = ensureLocaleDict(initialLocale);

function requireRoot(): HTMLElement {
  const value = document.getElementById('root');
  if (!value) throw new Error('no #root');
  return value;
}

const root = requireRoot();

async function start(): Promise<void> {
  const vosUser = await bootstrapVOSSession();
  if (vosUser) installVOSStoragePartition(vosUser.namespace);

  // Initialize persistence-aware modules only after the VOS storage partition exists.
  initSkins();
  loadProjectFonts();
  void hydratePlugins().catch(() => {});
  // The partition changes which saved language is visible, and VOS owns the
  // language while the app is embedded; settle both before the first frame.
  refreshStoredLocale();
  await alignWithPlatformLocale();
  await localeReady;
  if (getLocale() !== initialLocale) await ensureLocaleDict(getLocale());
  const isTranscriptWindow = new URLSearchParams(window.location.search).has('transcript-window');
  const [{ default: App }, { TranscriptWindowRoot }] = await Promise.all([
    import('./App'),
    import('./media/TranscriptWindowRoot'),
  ]);
  createRoot(root).render(
    <StrictMode>
      {isTranscriptWindow ? <TranscriptWindowRoot /> : <App />}
    </StrictMode>,
  );

  // Warm the other languages only once the first paint is out of the way, so
  // the language switcher stays instant without competing for the boot.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetchLocaleDicts);
  else setTimeout(prefetchLocaleDicts, 2_000);
}

void start().catch((error) => {
  const message = error instanceof Error ? error.message : 'VOS user authentication failed';
  root.textContent = `V-ChatCut 无法启动：${message}`;
});
