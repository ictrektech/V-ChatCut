import type {
  ImportedMediaSource,
  MediaSourceId,
  MediaSourceListResult,
  MediaSourceProvider,
} from '../../shared/media-source';

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`);
  if (!value) throw new Error('媒体来源返回了无效响应');
  return value;
}

export async function listMediaSourceProviders(): Promise<MediaSourceProvider[]> {
  const result = await responseJson<{ providers: MediaSourceProvider[] }>(
    await fetch('/api/media-sources/providers'),
  );
  return result.providers;
}

export async function listMediaSource(
  source: MediaSourceId,
  path = '',
  query = '',
): Promise<MediaSourceListResult> {
  const params = new URLSearchParams({ source });
  if (path) params.set('path', path);
  if (query) params.set('query', query);
  return responseJson<MediaSourceListResult>(await fetch(`/api/media-sources/list?${params}`));
}

export async function importMediaSourceItems(
  source: MediaSourceId,
  ids: readonly string[],
): Promise<ImportedMediaSource[]> {
  const result = await responseJson<{ imported: ImportedMediaSource[] }>(await fetch('/api/media-sources/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, ids }),
  }));
  return result.imported;
}
