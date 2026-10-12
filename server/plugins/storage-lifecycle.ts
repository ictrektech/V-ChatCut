import type { Plugin } from 'vite';
import { initializeSqliteProjectStore } from '../storage/sqlite-store.ts';
import { vosAuthEnabled } from '../vos-user-context.ts';

/** Initialize the sole project store before feature plugins restore persisted state. */
export function storageLifecyclePlugin(): Plugin {
  return {
    name: 'openchatcut-storage-lifecycle',
    async configureServer() {
      if (vosAuthEnabled()) return;
      await initializeSqliteProjectStore();
    },
  };
}
