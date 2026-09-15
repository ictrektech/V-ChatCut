import { proxyDispatcher } from '../outbound-proxy.ts';
import { vRouterAccessToken, vRouterApiBaseUrl } from '../v-router-client.ts';
import type { RegisterGenerationProviderTask } from './generation-jobs.ts';
import type { ValidVideoRequest } from './video-validation.ts';

type FetchInit = Parameters<typeof fetch>[1] & { dispatcher?: unknown };
const fetchWithProxy = (url: RequestInfo | URL, init?: FetchInit): Promise<Response> =>
  fetch(url, { ...init, dispatcher: proxyDispatcher() } as RequestInit);
const SUCCESSES = new Set(['completed', 'succeeded', 'success']);
const FAILURES = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired']);
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

interface VRouterVideoOptions { vrouterVideoModel: string }

async function providerError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { message?: string; error?: { message?: string } };
    return data.error?.message ?? data.message ?? `V-Router video generation failed (${response.status})`;
  } catch {
    return text.slice(0, 300) || `V-Router video generation failed (${response.status})`;
  }
}

function firstVideoUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstVideoUrl(item);
      if (url) return url;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  for (const key of ['video_url', 'url', 'download_url', 'mirror_urls', 'unsigned_urls', 'data', 'output', 'outputs', 'result']) {
    const url = firstVideoUrl(data[key]);
    if (url) return url;
  }
  return undefined;
}

function encodeTask(upstream: string, id: string): string {
  return `${encodeURIComponent(upstream)}:${encodeURIComponent(id)}`;
}

function decodeTask(value: string): { upstream: string; id: string } {
  const separator = value.indexOf(':');
  if (separator < 0) return { upstream: '', id: value };
  return {
    upstream: decodeURIComponent(value.slice(0, separator)),
    id: decodeURIComponent(value.slice(separator + 1)),
  };
}

/** V-Router exposes capability-routed POST /videos/generations. Async provider
 * resources are then pinned to the selected upstream for stable polling. */
export async function generateVRouterVideo(
  input: ValidVideoRequest,
  options: VRouterVideoOptions,
  registerProviderTask: RegisterGenerationProviderTask,
  existingTaskId?: string,
): Promise<string> {
  const token = vRouterAccessToken();
  if (!token || !options.vrouterVideoModel) throw new Error('V-Router video requires a VOS login and selected video model');
  const baseUrl = vRouterApiBaseUrl().replace(/\/$/, '');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let task = existingTaskId ? decodeTask(existingTaskId) : undefined;
  let current: Record<string, unknown>;
  if (!task) {
    const response = await fetchWithProxy(`${baseUrl}/videos/generations`, {
      method: 'POST', headers, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: options.vrouterVideoModel,
        prompt: input.prompt,
        duration: input.durationSeconds,
        aspect_ratio: input.ratio,
        resolution: input.resolution ?? '720p',
      }),
    });
    if (!response.ok) throw new Error(await providerError(response));
    current = await response.json() as Record<string, unknown>;
    const immediate = firstVideoUrl(current);
    if (immediate && SUCCESSES.has(String(current.status ?? 'completed').toLowerCase())) return immediate;
    const id = String(current.id ?? current.task_id ?? '').trim();
    if (!id) throw new Error('V-Router video generation returned neither a video URL nor a task id');
    const upstream = response.headers.get('X-VRouter-Upstream')?.trim() ?? '';
    if (!upstream) throw new Error('V-Router video task did not identify its upstream for polling');
    task = { upstream, id };
    await registerProviderTask('vrouter', encodeTask(upstream, id));
  } else {
    current = {};
  }

  const pollHeaders = { ...headers, 'X-VRouter-Upstream': task.upstream };
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const response = await fetchWithProxy(`${baseUrl}/videos/${encodeURIComponent(task.id)}`, {
      headers: pollHeaders, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(await providerError(response));
    current = await response.json() as Record<string, unknown>;
    const status = String(current.status ?? '').toLowerCase();
    if (SUCCESSES.has(status)) {
      const url = firstVideoUrl(current);
      if (url) return url;
      throw new Error('V-Router video generation succeeded without a video URL');
    }
    if (FAILURES.has(status)) throw new Error(`V-Router video generation ${status}`);
    await wait(3_000);
  }
  throw new Error('V-Router video generation timed out');
}
