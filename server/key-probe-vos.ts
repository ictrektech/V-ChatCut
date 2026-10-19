import { classifyStatus } from './key-probe-result.ts';
import { vSchedulerHeaders, vSchedulerModelCatalogUrl, vSchedulerVoicesUrl } from './v-scheduler-client.ts';
import type { KeyName } from './keystore.ts';
import type { ProbeDef } from './key-probes.ts';
import { currentVOSUser, vosAuthEnabled } from './vos-user-context.ts';
import { PROBE_TIMEOUT_MS } from './key-probe-local.ts';
import { fetchWithProxy } from './key-probe-url.ts';

type Get = (name: KeyName) => string;
const t = (): AbortSignal => AbortSignal.timeout(PROBE_TIMEOUT_MS);

// Mirrors the unified gateway's registry::supports fallback for models whose
// native backend supplies capabilities but no explicit endpoint list.
const SCHEDULER_ENDPOINT_CAPABILITIES: Record<string, readonly string[]> = {
  chat_completions: ['chat', 'completion', 'completions', 'generate', 'generation', 'tools', 'thinking'],
  'images/generations': ['image', 'images', 'image_generation'],
  'videos/generations': ['video', 'videos', 'video_generation'],
  'audio/speech': ['tts', 'speech'],
  'audio/transcriptions': ['asr', 'transcription', 'transcriptions'],
  'audio/music/generations': ['music', 'text-to-music', 'instrumental'],
};

export function parseVSchedulerModelCatalog(bodyText: string, endpoint?: string | readonly string[]): string[] {
  try {
    const body = JSON.parse(bodyText) as { models?: Array<{ qualified?: unknown; endpoints?: unknown; capabilities?: unknown }> };
    const wanted = endpoint == null ? null : Array.isArray(endpoint) ? endpoint : [endpoint];
    return [...new Set((body.models ?? []).flatMap((row) => {
      const endpoints = Array.isArray(row.endpoints) ? row.endpoints : [];
      // Explicit endpoints take precedence over capabilities. Never infer
      // support from a model name or an untyped legacy row.
      const normalize = (value: unknown): string => typeof value === 'string'
        ? value.trim().replace(/^\/?v1\//, '').replace(/^\//, '').replace('chat/completions', 'chat_completions') : '';
      const capabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
      if (wanted && !wanted.some((one) => endpoints.length
        ? endpoints.some((value) => normalize(value) === normalize(one))
        : (SCHEDULER_ENDPOINT_CAPABILITIES[normalize(one)] ?? []).some((capability) =>
          capabilities.some((value) => typeof value === 'string' && value.toLowerCase() === capability)))) return [];
      return typeof row.qualified === 'string' && row.qualified.trim() ? [row.qualified.trim()] : [];
    }))].sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

export function schedulerCatalogError(bodyText: string): string | null {
  try {
    const body = JSON.parse(bodyText) as { models?: unknown };
    return Array.isArray(body?.models) ? null : 'V-Scheduler 模型目录格式无效，请检查服务版本';
  } catch {
    return 'V-Scheduler 模型目录格式无效，请检查服务版本';
  }
}

export function parseVSchedulerVisionCatalog(bodyText: string): string[] {
  try {
    const body = JSON.parse(bodyText) as { models: Array<{ qualified: string; capabilities?: string[] }> };
    const chat = new Set(parseVSchedulerModelCatalog(bodyText, 'chat_completions'));
    return [...new Set(body.models.filter((row) => chat.has(row.qualified)
      && row.capabilities?.includes('vision')).map((row) => row.qualified))].sort();
  } catch { return []; }
}

export function parseVSchedulerVoices(bodyText: string): string[] {
  try {
    const body = JSON.parse(bodyText) as { voices?: Array<{ id?: unknown }> };
    return [...new Set((body.voices ?? [])
      .map((voice) => typeof voice.id === 'string' ? voice.id.trim() : '')
      .filter(Boolean))];
  } catch { return []; }
}

function withTrailingSlash(url: URL): URL {
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function webdavProbeBase(get: Get): URL | null {
  const raw = get('OPENCHATCUT_WEBDAV_URL').trim();
  if (!raw) return null;
  const url = withTrailingSlash(new URL(raw));
  if (url.username || url.password) throw new Error('WebDAV 地址不要写用户名密码，请使用单独的用户名/密码字段');
  return url;
}

export const webdavProbe: ProbeDef = {
  needs: [[]],
  run: (get) => {
    const url = webdavProbeBase(get);
    if (!url) return Promise.resolve(new Response('尚未填写 WebDAV 地址', { status: 400 }));
    const headers = new Headers({ depth: '0', 'content-type': 'application/xml' });
    const username = get('OPENCHATCUT_WEBDAV_USERNAME');
    const password = get('OPENCHATCUT_WEBDAV_PASSWORD');
    if (username || password) headers.set('authorization', `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
    return fetchWithProxy(url, {
      method: 'PROPFIND',
      signal: t(),
      headers,
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/></prop></propfind>',
    });
  },
  okText: () => 'WebDAV 连接成功 · 根目录可访问',
};

function immichProbeBase(get: Get): URL | null {
  const raw = get('OPENCHATCUT_IMMICH_URL').trim();
  if (!raw) return null;
  const url = new URL(raw);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${url.pathname.endsWith('/api') ? '' : '/api'}/`;
  return url;
}

function immichAcceptsVOSAccessToken(url: URL | null): boolean {
  return !!url && vosAuthEnabled() && /\/app\/com\.ictrek\.ai-album(?:\/|$)/.test(url.pathname);
}

export const immichProbe: ProbeDef = {
  needs: [[]],
  run: async (get) => {
    const url = immichProbeBase(get);
    if (!url) return new Response('尚未填写 AI 相册地址', { status: 400 });
    const endpoint = new URL('server/about', url);
    const apiKey = get('OPENCHATCUT_IMMICH_API_KEY');
    const vosToken = immichAcceptsVOSAccessToken(url) ? currentVOSUser()?.accessToken?.trim() ?? '' : '';
    if (!apiKey && !vosToken) return new Response('尚未填写 AI 相册 API Key', { status: 401 });
    const request = (headers: HeadersInit): Promise<Response> => fetchWithProxy(endpoint, { signal: t(), headers });
    let response = vosToken ? await request({ authorization: `Bearer ${vosToken}` }) : await request({ 'x-api-key': apiKey });
    if (response.status === 401 && vosToken && apiKey) response = await request({ 'x-api-key': apiKey });
    return response;
  },
  okText: () => 'AI 相册连接成功 · 鉴权通过',
};


export const V_SCHEDULER_MEDIA_PROBES: Record<string, ProbeDef> = {
  'voice/vrouter': {
    needs: [[]],
    run: () => fetch(vSchedulerModelCatalogUrl(), { signal: t(), headers: vSchedulerHeaders() }),
    models: (body) => parseVSchedulerModelCatalog(body, 'audio/speech'),
    postCheck: schedulerCatalogError,
    fieldOptions: async (get, catalog) => {
      const model = get('V_ROUTER_TTS_MODEL');
      // A saved selection may have been removed or become private to another
      // account. Keep its value, but let the user discover and select a new one.
      if (!model || !parseVSchedulerModelCatalog(catalog, 'audio/speech').includes(model)) {
        return { V_ROUTER_TTS_VOICE_ID: [] };
      }
      const response = await fetch(vSchedulerVoicesUrl(model), { signal: t(), headers: vSchedulerHeaders() });
      const body = await response.text().catch(() => '');
      if (!response.ok) throw new Error(classifyStatus(response.status, body).message);
      return { V_ROUTER_TTS_VOICE_ID: parseVSchedulerVoices(body) };
    },
  },
  'image/vrouter': {
    needs: [[]],
    run: () => fetch(vSchedulerModelCatalogUrl(), { signal: t(), headers: vSchedulerHeaders() }),
    models: (body) => parseVSchedulerModelCatalog(body, 'images/generations'),
    postCheck: schedulerCatalogError,
  },
  'transcription/vrouter': {
    needs: [[]],
    run: () => fetch(vSchedulerModelCatalogUrl(), { signal: t(), headers: vSchedulerHeaders() }),
    models: (body) => parseVSchedulerModelCatalog(body, 'audio/transcriptions'),
    postCheck: schedulerCatalogError,
  },
  'video/vrouter': {
    needs: [[]],
    run: () => fetch(vSchedulerModelCatalogUrl(), { signal: t(), headers: vSchedulerHeaders() }),
    models: (body) => parseVSchedulerModelCatalog(body, 'videos/generations'),
    postCheck: schedulerCatalogError,
  },
  'music/vrouter': {
    needs: [[]],
    run: () => fetch(vSchedulerModelCatalogUrl(), { signal: t(), headers: vSchedulerHeaders() }),
    models: (body) => parseVSchedulerModelCatalog(body, 'audio/music/generations'),
    postCheck: schedulerCatalogError,
  },
};
