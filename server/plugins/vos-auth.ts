import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { editorCredentialAuthorized, externalMcpVOSUser } from '../editor-auth.ts';
import { importTokenVOSUser } from '../external-agent/import-token.ts';
import { hydrateKeystoreForCurrentProfile } from '../keystore.ts';
import { resolveRuntimeProfile } from '../runtime-profile.ts';
import {
  runAsVOSUser,
  vosAuthEnabled,
  type VOSUserContext,
} from '../vos-user-context.ts';

const COOKIE_NAME = 'v_chatcut_session';
const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const sessions = new Map<string, { user: VOSUserContext; accessToken: string; expiresAt: number }>();

function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required');
  return parsed as Record<string, unknown>;
}

function claim(claims: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function identityFromPayload(payload: unknown): VOSUserContext {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid VOS userinfo response');
  const outer = payload as Record<string, unknown>;
  if (typeof outer.code === 'number' && outer.code !== 0) throw new Error(`VOS rejected token (code ${outer.code})`);
  const nested = outer.data;
  const claims = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : outer;
  const subject = claim(claims, 'sub', 'id', 'user_id');
  const username = claim(claims, 'preferred_username', 'username', 'name', 'nickname', 'email');
  if (!subject) throw new Error('VOS userinfo is missing immutable subject');
  if (!username) throw new Error('VOS userinfo is missing username');
  const rawRoles = claims.roles;
  const roles = Array.isArray(rawRoles) ? rawRoles.map(String) : [claim(claims, 'role')].filter(Boolean);
  const admin = claims.is_admin === true || roles.some((role) => role.toLowerCase() === 'admin')
    || username.toLowerCase() === 'admin';
  const namespace = createHash('sha256').update(`vos-oidc\0${subject}`).digest('hex').slice(0, 40);
  return Object.freeze({ provider: 'vos-oidc', subject, username, admin, namespace });
}

async function verifyOIDCToken(accessToken: string): Promise<VOSUserContext> {
  const endpoint = process.env.OPENCHATCUT_VOS_OIDC_USERINFO_URL?.trim()
    || 'http://172.17.0.1:8105/v1000/oauth2/userinfo';
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`VOS userinfo failed (${response.status})`);
  return identityFromPayload(await response.json());
}

function cookies(req: IncomingMessage): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    result.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
  }
  return result;
}

function session(req: IncomingMessage): { token: string; user: VOSUserContext; accessToken: string } | null {
  const token = cookies(req).get(COOKIE_NAME) ?? '';
  const found = sessions.get(token);
  if (!found) return null;
  if (found.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  found.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, user: found.user, accessToken: found.accessToken };
}

function secureRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return protocol?.trim().toLowerCase() === 'https';
}

function sessionCookie(req: IncomingMessage, token: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`
    + (secureRequest(req) ? '; Secure' : '');
}

function protectedPath(pathname: string): boolean {
  return ['/api', '/llm', '/assemblyai', '/media/uploads', '/upload', '/generate', '/e2b', '/export',
    '/render-still', '/render-clip', '/settings'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function persistIdentity(user: VOSUserContext): Promise<void> {
  const base = resolveRuntimeProfile();
  const directory = join(base.rootDir, 'users', user.namespace);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'identity.json'), JSON.stringify({
    version: 1,
    provider: user.provider,
    subject: user.subject,
    username: user.username,
    admin: user.admin,
  }, null, 2), { mode: 0o600 });
}

const LEGACY_ENTRIES = [
  'project-store-v1.json',
  'project-store-v1.json.migrated',
  'project-store-v1',
  'project-store-v1.sqlite3',
  'project-store-v1.sqlite3-shm',
  'project-store-v1.sqlite3-wal',
  'deleted-projects-v1.json',
  'generation-operations-v1.json',
  'media',
  'settings.env',
  'xai-oauth-session.json',
] as const;

async function claimLegacyData(user: VOSUserContext): Promise<string[]> {
  if (!user.admin) throw new Error('only the VOS administrator may claim legacy data');
  const base = resolveRuntimeProfile();
  const targetRoot = join(base.rootDir, 'users', user.namespace);
  const existing = (await readdir(targetRoot).catch(() => [])).filter((name) => name !== 'identity.json');
  if (existing.length === 1 && existing[0] === 'project-store-v1') {
    const generated = await readdir(join(targetRoot, 'project-store-v1')).catch(() => []);
    if (generated.every((name) => name === '.ready')) {
      await rm(join(targetRoot, 'project-store-v1'), { recursive: true });
      existing.length = 0;
    }
  }
  if (existing.length > 0) throw new Error('target user already has data; legacy claim refused');
  const available: string[] = [];
  for (const name of LEGACY_ENTRIES) {
    if (await access(join(base.rootDir, name)).then(() => true, () => false)) available.push(name);
  }
  if (available.length === 0) return [];
  const moved: string[] = [];
  try {
    for (const name of available) {
      await rename(join(base.rootDir, name), join(targetRoot, name));
      moved.push(name);
    }
  } catch (error) {
    for (const name of moved.reverse()) {
      await rename(join(targetRoot, name), join(base.rootDir, name)).catch(() => undefined);
    }
    throw error;
  }
  await writeFile(join(targetRoot, 'legacy-migration.json'), JSON.stringify({
    version: 1,
    claimedAt: new Date().toISOString(),
    entries: available,
  }, null, 2), { mode: 0o600 });
  return available;
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    const found = session(req);
    json(res, found ? 200 : 401, {
      enabled: true,
      authenticated: !!found,
      ...(found ? { user: { username: found.user.username, namespace: found.user.namespace } } : {}),
      clientId: process.env.OPENCHATCUT_VOS_OIDC_CLIENT_ID?.trim() || 'com.ictrek.v-chatcut',
      scope: process.env.OPENCHATCUT_VOS_OIDC_SCOPE?.trim() || 'openid profile email',
    });
    return true;
  }
  if (pathname === '/api/auth/vos-oidc' && req.method === 'POST') {
    if (!editorCredentialAuthorized(req, true)) {
      json(res, 403, { error: 'invalid request origin' });
      return true;
    }
    try {
      const body = await readJson(req);
      const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
      if (!accessToken) throw new Error('access_token is required');
      const user = await verifyOIDCToken(accessToken);
      await persistIdentity(user);
      await runAsVOSUser(user, () => hydrateKeystoreForCurrentProfile());
      const previous = session(req);
      if (previous) sessions.delete(previous.token);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { user, accessToken, expiresAt: Date.now() + SESSION_TTL_MS });
      json(res, 200, {
        authenticated: true,
        user: { username: user.username, namespace: user.namespace },
      }, { 'Set-Cookie': sessionCookie(req, token, Math.floor(SESSION_TTL_MS / 1000)) });
    } catch (error) {
      json(res, 401, { error: error instanceof Error ? error.message : 'VOS authentication failed' });
    }
    return true;
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!editorCredentialAuthorized(req, true)) {
      json(res, 403, { error: 'invalid request origin' });
      return true;
    }
    const found = session(req);
    if (found) sessions.delete(found.token);
    json(res, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    return true;
  }
  if (pathname === '/api/auth/claim-legacy-data' && req.method === 'POST') {
    const found = session(req);
    if (!found) { json(res, 401, { error: 'VOS authentication required' }); return true; }
    if (!editorCredentialAuthorized(req, true)) { json(res, 403, { error: 'invalid request origin' }); return true; }
    try {
      const requestUser = Object.freeze({ ...found.user, accessToken: found.accessToken });
      const moved = await runAsVOSUser(requestUser, () => claimLegacyData(found.user));
      json(res, 200, { moved, restartRequired: moved.length > 0 });
    } catch (error) {
      json(res, 409, { error: error instanceof Error ? error.message : 'legacy migration failed' });
    }
    return true;
  }
  return false;
}

export function vosAuthPlugin(): Plugin {
  return {
    name: 'openchatcut-vos-auth',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use('/', (req: IncomingMessage, res: ServerResponse, next) => {
        if (!vosAuthEnabled()) { next(); return; }
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname.startsWith('/api/auth/')) {
          void handleAuth(req, res, pathname).then((handled) => { if (!handled) next(); })
            .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : 'authentication failed' }));
          return;
        }
        if (!protectedPath(pathname)) { next(); return; }
        const found = session(req);
        if (!found) {
          const externalUser = pathname === '/api/external-mcp/mcp'
            ? externalMcpVOSUser(req)
            : pathname === '/upload'
              ? importTokenVOSUser(new URL(req.url ?? '/', 'http://localhost').searchParams.get('handoff') ?? '')
              : undefined;
          if (externalUser) { runAsVOSUser(externalUser, next); return; }
          req.resume();
          json(res, 401, { error: 'VOS authentication required' });
          return;
        }
        runAsVOSUser(Object.freeze({ ...found.user, accessToken: found.accessToken }), next);
      });
    },
  };
}
