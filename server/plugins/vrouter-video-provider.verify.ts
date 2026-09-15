import assert from 'node:assert/strict';
import { runAsVOSUser } from '../vos-user-context.ts';
import { generateVRouterVideo } from './vrouter-video-provider.ts';
import { validateVideoRequest } from './video-validation.ts';

process.env.OPENCHATCUT_VOS_AUTH_ENABLED = 'true';
const user = { provider: 'vos-oidc' as const, subject: 'user-1', username: 'user', admin: false, namespace: 'user-1', accessToken: 'vos-token' };
const input = validateVideoRequest({ model: 'vrouter', prompt: 'paper airplane', durationSeconds: 5, ratio: '16:9', resolution: '720p' });
const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; method?: string; headers: Headers; body?: string }> = [];
let step = 0;
globalThis.fetch = async (url, init) => {
  const headers = new Headers(init?.headers);
  calls.push({ url: String(url), method: init?.method, headers, body: typeof init?.body === 'string' ? init.body : undefined });
  if (step++ === 0) {
    return new Response(JSON.stringify({ id: 'task/1', status: 'queued' }), { status: 202, headers: { 'X-VRouter-Upstream': 'image-studio' } });
  }
  return new Response(JSON.stringify({ status: 'completed', output: [{ video_url: 'https://media.invalid/result.mp4' }] }), { status: 200 });
};
try {
  const registered: string[] = [];
  const result = await runAsVOSUser(user, () => generateVRouterVideo(
    input,
    { vrouterVideoModel: 'image-studio/wan21' },
    async (provider, id) => { registered.push(`${provider}:${id}`); },
  ));
  assert.equal(result, 'https://media.invalid/result.mp4');
  assert.equal(calls[0].url, 'http://v-router:8080/v1/videos/generations');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer vos-token');
  assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
    model: 'image-studio/wan21', prompt: 'paper airplane', duration: 5, aspect_ratio: '16:9', resolution: '720p',
  });
  assert.equal(calls[1].url, 'http://v-router:8080/v1/videos/task%2F1');
  assert.equal(calls[1].headers.get('X-VRouter-Upstream'), 'image-studio');
  assert.equal(registered.length, 1);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('vrouter-video-provider.verify: routed submit and pinned polling passed');
