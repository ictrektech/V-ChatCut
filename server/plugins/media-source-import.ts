import { createReadStream } from 'node:fs';
import { mkdir, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type {
  ImportedMediaSource,
  MediaSourceId,
  MediaSourceItem,
  MediaSourceListResult,
  MediaSourceProvider,
} from '../../shared/media-source.ts';
import { editorCredentialAuthorized } from '../editor-auth.ts';
import { sanitizeFileName } from '../file-name.ts';
import { enqueueUploadMutation, mimeFor, uploadDir } from '../media-dir.ts';
import { maxUploadBytes, readBody, sendError, sendJson } from './upload-route-http.ts';
import { streamUploadToFile } from './upload-stream.ts';
import { getKey, type KeyName } from '../keystore.ts';
import { vosAuthEnabled } from '../vos-user-context.ts';

const API_PREFIX = '/api/media-sources';
const MAX_LIST_ITEMS = 500;
const MAX_IMPORT_ITEMS = 100;
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.heic', '.heif',
]);

interface ImportCandidate {
  name: string;
  mime?: string;
  modifiedAt?: number;
  stream: NodeJS.ReadableStream;
}

function configured(name: string): string {
  if (name === 'OPENCHATCUT_VOS_EXPOSED_ROOT') return process.env[name]?.trim() ?? '';
  return getKey(name as KeyName).trim();
}

function isMediaName(name: string): boolean {
  return MEDIA_EXTENSIONS.has(extname(name).toLowerCase());
}

function normalizedRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('invalid media source path');
  }
  return parts.join('/');
}

function parentPath(value: string): string | undefined {
  if (!value) return undefined;
  const index = value.lastIndexOf('/');
  return index < 0 ? '' : value.slice(0, index);
}

async function vosRoot(): Promise<string | null> {
  // VOS exposes an application-wide reconciled view. In a multi-user process
  // it is safe only when the administrator explicitly declares it a shared
  // source (typically a public directory); imported copies are still private.
  if (vosAuthEnabled() && !/^(?:1|true|yes)$/i.test(process.env.OPENCHATCUT_VOS_SHARED_EXPOSED_ENABLED ?? '')) {
    return null;
  }
  const configuredRoot = configured('OPENCHATCUT_VOS_EXPOSED_ROOT') || '/exposed';
  try {
    const root = await realpath(configuredRoot);
    return (await stat(root)).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

async function resolveVosPath(rawPath: string, requireFile?: boolean): Promise<{ root: string; path: string; relativePath: string }> {
  const root = await vosRoot();
  if (!root) throw new Error('VOS 尚未向应用授权存储目录');
  const relativePath = normalizedRelativePath(rawPath);
  const candidate = await realpath(resolve(root, relativePath));
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error('path is outside the VOS exposed root');
  const info = await stat(candidate);
  if (requireFile && !info.isFile()) throw new Error('selected VOS item is not a file');
  if (!requireFile && !info.isDirectory()) throw new Error('selected VOS path is not a directory');
  return { root, path: candidate, relativePath };
}

async function listVos(rawPath: string): Promise<MediaSourceListResult> {
  const resolved = await resolveVosPath(rawPath);
  const entries = await readdir(resolved.path, { withFileTypes: true });
  const items: MediaSourceItem[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const itemPath = resolve(resolved.path, entry.name);
    const info = await stat(itemPath).catch(() => null);
    if (!info || (!info.isDirectory() && (!info.isFile() || !isMediaName(entry.name)))) continue;
    const id = relative(resolved.root, await realpath(itemPath)).split(sep).join('/');
    if (!id || id.startsWith('../')) continue;
    items.push({
      id,
      name: entry.name,
      kind: info.isDirectory() ? 'folder' : 'media',
      ...(info.isFile() ? { bytes: info.size, modifiedAt: info.mtimeMs, mime: mimeFor(entry.name) } : {}),
    });
    if (items.length >= MAX_LIST_ITEMS) break;
  }
  items.sort((left, right) => left.kind === right.kind
    ? left.name.localeCompare(right.name, undefined, { numeric: true })
    : left.kind === 'folder' ? -1 : 1);
  return { path: resolved.relativePath, parentPath: parentPath(resolved.relativePath), items };
}

function webdavBase(): URL | null {
  const raw = configured('OPENCHATCUT_WEBDAV_URL');
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('WebDAV URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('WebDAV credentials must use the dedicated settings');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function webdavHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const username = configured('OPENCHATCUT_WEBDAV_USERNAME');
  const password = configured('OPENCHATCUT_WEBDAV_PASSWORD');
  if (username || password) headers.set('authorization', `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  return headers;
}

function webdavUrl(rawPath: string): URL {
  const base = webdavBase();
  if (!base) throw new Error('WebDAV 尚未配置');
  const path = normalizedRelativePath(rawPath);
  return new URL(path.split('/').map(encodeURIComponent).join('/') + (path ? '' : '.'), base);
}

function elementText(element: XmlElement, localName: string): string {
  const matches = element.getElementsByTagNameNS('*', localName);
  return matches.item(0)?.textContent?.trim() ?? '';
}

function webdavRelativePath(href: string, base: URL): string | null {
  const path = decodeURIComponent(new URL(href, base).pathname);
  const root = decodeURIComponent(base.pathname);
  if (!path.startsWith(root)) return null;
  return normalizedRelativePath(path.slice(root.length));
}

async function listWebdav(rawPath: string): Promise<MediaSourceListResult> {
  const base = webdavBase();
  if (!base) throw new Error('WebDAV 尚未配置');
  const path = normalizedRelativePath(rawPath);
  const response = await fetch(webdavUrl(path), {
    method: 'PROPFIND',
    headers: webdavHeaders({ depth: '1', 'content-type': 'application/xml' }),
    body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/><getcontentlength/><getcontenttype/><getlastmodified/></prop></propfind>',
  });
  if (!response.ok && response.status !== 207) throw new Error(`WebDAV list failed (${response.status})`);
  const document = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const rows = document.getElementsByTagNameNS('*', 'response');
  const items: MediaSourceItem[] = [];
  for (let index = 0; index < rows.length && items.length < MAX_LIST_ITEMS; index += 1) {
    const row = rows.item(index);
    if (!row) continue;
    const id = webdavRelativePath(elementText(row, 'href'), base);
    if (id == null || id === path) continue;
    const collection = row.getElementsByTagNameNS('*', 'collection').length > 0;
    const name = elementText(row, 'displayname') || decodeURIComponent(id.split('/').pop() ?? '');
    if (!collection && !isMediaName(name)) continue;
    const bytes = Number(elementText(row, 'getcontentlength'));
    const modified = Date.parse(elementText(row, 'getlastmodified'));
    items.push({
      id,
      name,
      kind: collection ? 'folder' : 'media',
      ...(!collection && Number.isFinite(bytes) ? { bytes } : {}),
      ...(!collection && Number.isFinite(modified) ? { modifiedAt: modified } : {}),
      ...(!collection ? { mime: elementText(row, 'getcontenttype') || mimeFor(name) } : {}),
    });
  }
  items.sort((left, right) => left.kind === right.kind
    ? left.name.localeCompare(right.name, undefined, { numeric: true })
    : left.kind === 'folder' ? -1 : 1);
  return { path, parentPath: parentPath(path), items };
}

function immichApiBase(): URL | null {
  const raw = configured('OPENCHATCUT_IMMICH_URL');
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('AI 相册 URL must use HTTP or HTTPS');
  url.pathname = `${url.pathname.replace(/\/$/, '')}${url.pathname.endsWith('/api') ? '' : '/api'}/`;
  return url;
}

function immichHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const apiKey = configured('OPENCHATCUT_IMMICH_API_KEY');
  if (apiKey) headers.set('x-api-key', apiKey);
  return headers;
}

async function immichRequest(path: string, init?: RequestInit): Promise<Response> {
  const base = immichApiBase();
  if (!base || !configured('OPENCHATCUT_IMMICH_API_KEY')) throw new Error('AI 相册尚未配置');
  const response = await fetch(new URL(path.replace(/^\//, ''), base), {
    ...init,
    headers: immichHeaders(init?.headers),
  });
  if (!response.ok) throw new Error(`AI 相册请求失败 (${response.status})`);
  return response;
}

interface ImmichAsset {
  id?: unknown;
  originalFileName?: unknown;
  originalMimeType?: unknown;
  fileModifiedAt?: unknown;
}

function immichItems(value: unknown): ImmichAsset[] {
  if (!value || typeof value !== 'object') return [];
  const assets = (value as { assets?: unknown }).assets;
  if (!assets || typeof assets !== 'object') return [];
  const items = (assets as { items?: unknown }).items;
  return Array.isArray(items) ? items as ImmichAsset[] : [];
}

async function listImmich(query: string): Promise<MediaSourceListResult> {
  const trimmed = query.trim().slice(0, 200);
  const response = await immichRequest(trimmed ? 'search/smart' : 'search/metadata', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(trimmed
      ? { query: trimmed, size: 100, page: 1 }
      : { size: 100, page: 1, order: 'desc', withDeleted: false }),
  });
  const items = immichItems(await response.json()).flatMap<MediaSourceItem>((asset) => {
    if (typeof asset.id !== 'string' || typeof asset.originalFileName !== 'string' || !isMediaName(asset.originalFileName)) return [];
    const modified = typeof asset.fileModifiedAt === 'string' ? Date.parse(asset.fileModifiedAt) : Number.NaN;
    return [{
      id: asset.id,
      name: asset.originalFileName,
      kind: 'media',
      mime: typeof asset.originalMimeType === 'string' ? asset.originalMimeType : mimeFor(asset.originalFileName),
      ...(Number.isFinite(modified) ? { modifiedAt: modified } : {}),
    }];
  });
  return { path: trimmed, items };
}

async function providers(): Promise<MediaSourceProvider[]> {
  const root = await vosRoot();
  let webdav: URL | null = null;
  let webdavError = '';
  let immich: URL | null = null;
  let immichError = '';
  try { webdav = webdavBase(); } catch (error) { webdavError = error instanceof Error ? error.message : String(error); }
  try { immich = immichApiBase(); } catch (error) { immichError = error instanceof Error ? error.message : String(error); }
  return [
    { id: 'vos', label: 'VOS 存储', available: root !== null, detail: root ? '可浏览已授权目录' : '尚未授权目录' },
    { id: 'webdav', label: 'WebDAV', available: webdav !== null, detail: webdav ? webdav.host : webdavError || '尚未配置' },
    {
      id: 'immich', label: 'AI 相册', searchable: true,
      available: immich !== null && !!configured('OPENCHATCUT_IMMICH_API_KEY'),
      detail: immich ? immich.host : immichError || '尚未配置',
    },
  ];
}

async function localCandidate(id: string): Promise<ImportCandidate> {
  const resolved = await resolveVosPath(id, true);
  const info = await stat(resolved.path);
  const name = basename(resolved.path);
  if (!isMediaName(name)) throw new Error('unsupported media file');
  return { name, mime: mimeFor(name), modifiedAt: info.mtimeMs, stream: createReadStream(resolved.path) };
}

async function responseCandidate(response: Response, fallbackName: string, modifiedAt?: number): Promise<ImportCandidate> {
  if (!response.body) throw new Error('media source returned an empty body');
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1];
  const name = sanitizeFileName(encoded ? decodeURIComponent(encoded) : quoted || fallbackName, 'media.bin');
  if (!isMediaName(name)) throw new Error('unsupported media file');
  return {
    name,
    mime: response.headers.get('content-type')?.split(';')[0] || mimeFor(name),
    modifiedAt,
    stream: Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
  };
}

async function remoteCandidate(source: MediaSourceId, id: string): Promise<ImportCandidate> {
  if (source === 'vos') return localCandidate(id);
  if (source === 'webdav') {
    const response = await fetch(webdavUrl(id), { headers: webdavHeaders() });
    if (!response.ok) throw new Error(`WebDAV download failed (${response.status})`);
    return responseCandidate(response, decodeURIComponent(id.split('/').pop() ?? 'media.bin'));
  }
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('invalid AI album asset id');
  const detailResponse = await immichRequest(`assets/${encodeURIComponent(id)}`);
  const detail = await detailResponse.json() as ImmichAsset;
  const fallbackName = typeof detail.originalFileName === 'string' ? detail.originalFileName : `${id}.bin`;
  const modified = typeof detail.fileModifiedAt === 'string' ? Date.parse(detail.fileModifiedAt) : Number.NaN;
  return responseCandidate(
    await immichRequest(`assets/${encodeURIComponent(id)}/original`),
    fallbackName,
    Number.isFinite(modified) ? modified : undefined,
  );
}

async function publishCandidate(candidate: ImportCandidate): Promise<ImportedMediaSource> {
  const directory = uploadDir();
  await mkdir(directory, { recursive: true });
  const extension = extname(candidate.name).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const storedName = `${randomUUID()}${extension}`;
  const part = resolve(directory, `.${storedName}.${randomUUID()}.part`);
  const destination = resolve(directory, storedName);
  try {
    const { bytes, contentHash } = await streamUploadToFile(candidate.stream, part, maxUploadBytes());
    if (bytes <= 0) throw new Error('media source returned an empty file');
    await enqueueUploadMutation(storedName, () => rename(part, destination));
    return {
      name: candidate.name,
      src: `/media/uploads/${storedName}`,
      mime: candidate.mime || mimeFor(candidate.name),
      bytes,
      modifiedAt: candidate.modifiedAt ?? Date.now(),
      contentHash,
    };
  } catch (error) {
    await unlink(part).catch(() => undefined);
    throw error;
  }
}

function sourceId(value: unknown): MediaSourceId | null {
  return value === 'vos' || value === 'webdav' || value === 'immich' ? value : null;
}

async function handleList(url: URL, res: ServerResponse): Promise<void> {
  const source = sourceId(url.searchParams.get('source'));
  if (!source) { sendError(res, 400, 'invalid media source'); return; }
  const path = url.searchParams.get('path') ?? '';
  const result = source === 'vos' ? await listVos(path)
    : source === 'webdav' ? await listWebdav(path)
      : await listImmich(url.searchParams.get('query') ?? '');
  sendJson(res, 200, result);
}

async function handleImport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse((await readBody(req)).toString('utf8')) as { source?: unknown; ids?: unknown };
  const source = sourceId(body.source);
  if (!source || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_IMPORT_ITEMS
    || body.ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 2048)) {
    sendError(res, 400, 'invalid media import request');
    return;
  }
  const imported: ImportedMediaSource[] = [];
  for (const id of [...new Set(body.ids as string[])]) imported.push(await publishCandidate(await remoteCandidate(source, id)));
  sendJson(res, 200, { imported });
}

export function mediaSourceImportPlugin(): Plugin {
  return {
    name: 'openchatcut-media-source-import',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith(API_PREFIX)) { next(); return; }
        const write = req.method !== 'GET';
        if (!editorCredentialAuthorized(req, write)) { sendError(res, 403, 'forbidden'); return; }
        try {
          if (req.method === 'GET' && url.pathname === `${API_PREFIX}/providers`) {
            sendJson(res, 200, { providers: await providers() });
          } else if (req.method === 'GET' && url.pathname === `${API_PREFIX}/list`) {
            await handleList(url, res);
          } else if (req.method === 'POST' && url.pathname === `${API_PREFIX}/import`) {
            await handleImport(req, res);
          } else {
            next();
          }
        } catch (error) {
          server.config.logger.warn(`[media-source-import] ${error instanceof Error ? error.message : String(error)}`);
          sendError(res, 500, error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}
