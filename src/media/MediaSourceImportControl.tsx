import { useCallback } from 'react';
import type { MediaAsset } from '../editor/types';
import type { ImportedMediaSource } from '../../shared/media-source';
import { MediaSourceImportDialog } from './MediaSourceImportDialog';
import { importedMediaSourceToAsset } from './remoteMediaImport';

interface MediaSourceImportControlProps {
  open: boolean;
  onClose: () => void;
  fps: number;
  folderId?: string;
  onAddAsset: (asset: MediaAsset) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  onOpenSettings?: () => void;
}

export function MediaSourceImportControl({
  open, onClose, fps, folderId, onAddAsset, setBusy, setError, onOpenSettings,
}: MediaSourceImportControlProps) {
  const onImport = useCallback(async (imported: ImportedMediaSource[]) => {
    setBusy(true);
    setError(null);
    try {
      const ready: MediaAsset[] = [];
      for (const source of imported) {
        ready.push(await importedMediaSourceToAsset(source, fps));
      }
      for (const asset of ready) {
        onAddAsset(folderId ? { ...asset, folderId } : asset);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }, [folderId, fps, onAddAsset, setBusy, setError]);

  return open ? <MediaSourceImportDialog onClose={onClose} onImport={onImport} onOpenSettings={onOpenSettings} /> : null;
}
