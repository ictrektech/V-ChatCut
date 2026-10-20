import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = mkdtempSync(join(tmpdir(), 'chatcut-scheduler-'));
process.env.OPENCHATCUT_DATA_DIR = fixture;
process.env.OPENCHATCUT_VOS_AUTH_ENABLED = 'true';
delete process.env.OPENCHATCUT_DEV_PROFILE_ID;
const { runAsVOSUser } = await import('./vos-user-context.ts');
const client = await import('./v-scheduler-client.ts');
const { seedKeystore, getKey } = await import('./keystore.ts');
const { llmHeaders, llmTarget } = await import('./plugins/llm-proxy.ts');
const { PROBES, runProbe } = await import('./key-probes.ts');
const { schedulerCatalogError, parseVSchedulerVisionCatalog } = await import('./key-probe-vos.ts');
const req = { headers: { 'x-openchatcut-provider': 'vrouter' } } as never;
const saved = {
  LLM_PROVIDER: 'vrouter', LLM_VROUTER_MODEL: 'saved/chat',
  V_ROUTER_TTS_MODEL: 'saved/tts', V_ROUTER_TTS_VOICE_ID: 'saved-voice',
  V_ROUTER_IMAGE_MODEL: 'saved/image', V_ROUTER_VIDEO_MODEL: 'saved/video',
  V_ROUTER_TRANSCRIPTION_MODEL: 'saved/asr', V_ROUTER_MUSIC_MODEL: 'saved/music',
};
seedKeystore(saved);
const originalFetch = globalThis.fetch;
try {
  assert.equal(llmTarget(req), 'http://v-scheduler:8080/v1');
  assert.throws(() => llmHeaders(req), /current VOS login/);
  const seen: string[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'http://v-scheduler:8080/api/v1/models');
    seen.push(new Headers(options?.headers).get('Authorization') ?? '');
    return Response.json({ models: [
      { qualified: 'visible/chat', endpoints: ['chat_completions'] },
      { qualified: 'visible/tts', endpoints: ['audio/speech'] },
    ] });
  };
  for (const name of ['alice', 'bob']) {
    await runAsVOSUser({ provider: 'vos-oidc', subject: name, username: name,
      admin: false, namespace: name, accessToken: `${name}-token` }, async () => {
      assert.deepEqual(llmHeaders(req), { authorization: `Bearer ${name}-token` });
      const result = await runProbe('llm/vrouter', {});
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ['visible/chat']);
      const voice = await runProbe('voice/vrouter', {});
      assert.equal(voice.ok, true, 'a removed saved model must not block discovery');
      assert.deepEqual(voice.models, ['visible/tts']);
      assert.deepEqual(voice.fieldOptions, { V_ROUTER_TTS_VOICE_ID: [] });
      for (const [key, value] of Object.entries(saved)) assert.equal(getKey(key as never), value);
    });
  }
  assert.deepEqual(seen, ['Bearer alice-token', 'Bearer alice-token', 'Bearer bob-token', 'Bearer bob-token']);
  assert.equal(schedulerCatalogError('{}') !== null, true);
  assert.equal(schedulerCatalogError('{"models":[]}'), null);
  assert.deepEqual(parseVSchedulerVisionCatalog(JSON.stringify({ models: [
    { qualified: 'vision-chat', endpoints: ['chat_completions'], capabilities: ['vision'] },
    { qualified: 'ocr', endpoints: ['ml/predictions'], capabilities: ['vision'] },
    { qualified: 'text-chat', endpoints: ['chat_completions'] },
  ] })), ['vision-chat']);
  assert.deepEqual(PROBES['video/vrouter'].models?.('{"models":[]}'), []);
  console.log('V-Scheduler identity, legacy settings, discovery and endpoint checks passed');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(fixture, { recursive: true, force: true });
}
