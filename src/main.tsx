import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadProjectFonts } from './fonts/googleFonts';
import { hydratePlugins } from './plugins/store';
import { initSkins } from './skins';
import { bootstrapVOSSession } from './vos/auth';
import { installVOSStoragePartition } from './vos/storagePartition';

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
}

void start().catch((error) => {
  const message = error instanceof Error ? error.message : 'VOS 用户验证失败';
  root.textContent = `V-ChatCut 无法启动：${message}`;
});
