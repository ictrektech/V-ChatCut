import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

const root = await mkdtemp(join(tmpdir(), 'v-chatcut-vos-isolation-'));
process.env.OPENCHATCUT_VOS_AUTH_ENABLED = 'true';
process.env.OPENCHATCUT_DATA_DIR = root;

const [{ runAsVOSUser }, runtime, keystore, editorAuth, importTokens] = await Promise.all([
  import('./vos-user-context.ts'),
  import('./runtime-profile.ts'),
  import('./keystore.ts'),
  import('./editor-auth.ts'),
  import('./external-agent/import-token.ts'),
]);

const userA = Object.freeze({
  provider: 'vos-oidc' as const,
  subject: 'vos-user-a',
  username: 'alice',
  admin: false,
  namespace: 'a'.repeat(40),
});
const userB = Object.freeze({
  provider: 'vos-oidc' as const,
  subject: 'vos-user-b',
  username: 'bob',
  admin: false,
  namespace: 'b'.repeat(40),
});

try {
  keystore.seedKeystore({
    OPENCHATCUT_WEBDAV_URL: 'https://dav.example.test',
    OPENCHATCUT_WEBDAV_USERNAME: 'shared-user-must-not-leak',
    OPENCHATCUT_WEBDAV_PASSWORD: 'shared-password-must-not-leak',
    OPENCHATCUT_IMMICH_URL: 'https://photos.example.test',
    OPENCHATCUT_IMMICH_API_KEY: 'shared-key-must-not-leak',
  });

  const profileA = await runAsVOSUser(userA, async () => {
    await keystore.hydrateKeystoreForCurrentProfile();
    const profile = runtime.runtimeProfile();
    assert.equal(profile.mode, 'vos-user');
    assert.equal(profile.rootDir, join(root, 'users', userA.namespace));
    assert.equal(profile.mediaDir, join(profile.rootDir, 'media', 'uploads'));
    assert.equal(profile.generationJobStore, join(profile.rootDir, 'generation-operations-v1.json'));
    await mkdir(profile.rootDir, { recursive: true });
    assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_URL'), 'https://dav.example.test');
    assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_USERNAME'), '');
    assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_PASSWORD'), '');
    assert.equal(keystore.getKey('OPENCHATCUT_IMMICH_API_KEY'), '');
    await keystore.setKeys({
      OPENCHATCUT_WEBDAV_USERNAME: 'alice',
      OPENCHATCUT_WEBDAV_PASSWORD: 'alice-secret',
      OPENCHATCUT_IMMICH_API_KEY: 'alice-photo-key',
    });
    return profile;
  });

  const profileB = await runAsVOSUser(userB, async () => {
    await keystore.hydrateKeystoreForCurrentProfile();
    const profile = runtime.runtimeProfile();
    assert.equal(profile.mode, 'vos-user');
    assert.equal(profile.rootDir, join(root, 'users', userB.namespace));
    assert.notEqual(profile.rootDir, profileA.rootDir);
    assert.notEqual(profile.projectStore.directory, profileA.projectStore.directory);
    await mkdir(profile.rootDir, { recursive: true });
    assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_USERNAME'), '');
    assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_PASSWORD'), '');
    assert.equal(keystore.getKey('OPENCHATCUT_IMMICH_API_KEY'), '');
    await keystore.setKeys({
      OPENCHATCUT_WEBDAV_USERNAME: 'bob',
      OPENCHATCUT_WEBDAV_PASSWORD: 'bob-secret',
      OPENCHATCUT_IMMICH_API_KEY: 'bob-photo-key',
    });
    return profile;
  });

  await Promise.all([
    runAsVOSUser(userA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(runtime.runtimeProfile().rootDir, profileA.rootDir);
      assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_USERNAME'), 'alice');
      assert.equal(keystore.getKey('OPENCHATCUT_IMMICH_API_KEY'), 'alice-photo-key');
    }),
    runAsVOSUser(userB, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      assert.equal(runtime.runtimeProfile().rootDir, profileB.rootDir);
      assert.equal(keystore.getKey('OPENCHATCUT_WEBDAV_USERNAME'), 'bob');
      assert.equal(keystore.getKey('OPENCHATCUT_IMMICH_API_KEY'), 'bob-photo-key');
    }),
  ]);

  const settingsA = await readFile(profileA.keystorePath, 'utf8');
  const settingsB = await readFile(profileB.keystorePath, 'utf8');
  assert.match(settingsA, /alice-secret/);
  assert.doesNotMatch(settingsA, /bob-secret/);
  assert.match(settingsB, /bob-secret/);
  assert.doesNotMatch(settingsB, /alice-secret/);

  const mcpA = runAsVOSUser(userA, () => editorAuth.externalMcpToken());
  const mcpB = runAsVOSUser(userB, () => editorAuth.externalMcpToken());
  assert.notEqual(mcpA, mcpB);
  assert.equal(editorAuth.externalMcpVOSUser({
    headers: { authorization: `Bearer ${mcpA}` },
  } as IncomingMessage)?.namespace, userA.namespace);
  assert.equal(editorAuth.externalMcpVOSUser({
    headers: { authorization: `Bearer ${mcpB}` },
  } as IncomingMessage)?.namespace, userB.namespace);

  const handoff = runAsVOSUser(userA, () => importTokens.mintImportToken({
    sessionId: 'session-a',
    assetId: 'asset-a',
    assetType: 'video',
    filename: 'clip.mp4',
    projectId: 'project-a',
    method: 'POST',
    contentType: 'video/mp4',
    expectedBytes: 42,
  }));
  assert.equal(importTokens.importTokenVOSUser(handoff.token)?.namespace, userA.namespace);

  console.log('VOS user isolation verification passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
