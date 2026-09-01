export type MediaSourceId = 'vos' | 'webdav' | 'immich';

export interface MediaSourceProvider {
  id: MediaSourceId;
  label: string;
  available: boolean;
  detail?: string;
  searchable?: boolean;
}

export interface MediaSourceItem {
  id: string;
  name: string;
  kind: 'folder' | 'media';
  bytes?: number;
  modifiedAt?: number;
  mime?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
}

export interface MediaSourceListResult {
  path: string;
  parentPath?: string;
  items: MediaSourceItem[];
}

export interface ImportedMediaSource {
  name: string;
  src: string;
  mime: string;
  bytes: number;
  modifiedAt: number;
  contentHash: string;
}
