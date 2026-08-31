import type { ImportedMediaSource } from '../../shared/media-source';
import { createMediaSourceRevision } from '../editor/mediaSourceRevision';
import type { MediaAsset } from '../editor/types';
import { normalizeUploadedVideo } from './upload';
import { kindOfDescriptor, probeMediaSource } from './mediaProbe';

function assetId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `remote_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function importedMediaSourceToAsset(
  imported: ImportedMediaSource,
  fps: number,
): Promise<MediaAsset> {
  const kind = kindOfDescriptor(imported.name, imported.mime);
  if (!kind) throw new Error(`不支持的素材类型：${imported.name}`);
  const metadata = await probeMediaSource(imported.src, kind, fps);
  const normalized = kind === 'video'
    ? await normalizeUploadedVideo(imported.src)
    : { src: imported.src };
  const durationInFrames = normalized.durationSeconds && normalized.durationSeconds > 0
    ? Math.max(1, Math.round(normalized.durationSeconds * fps))
    : metadata.durationInFrames;
  const width = normalized.width ?? metadata.width;
  const height = normalized.height ?? metadata.height;
  return {
    id: assetId(),
    name: imported.name,
    sourceFilename: imported.name,
    kind,
    src: normalized.src,
    durationInFrames,
    width,
    height,
    sourceContentHash: imported.contentHash,
    sourceSize: imported.bytes,
    sourceModifiedAt: imported.modifiedAt,
    sourceRevision: createMediaSourceRevision({
      src: imported.src,
      name: imported.name,
      kind,
      sourceContentHash: imported.contentHash,
      sourceSize: imported.bytes,
      sourceModifiedAt: imported.modifiedAt,
      durationInFrames,
      width,
      height,
    }),
  };
}
