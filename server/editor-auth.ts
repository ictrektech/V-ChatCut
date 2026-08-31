import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { EditorBootstrapInfo } from '../shared/editor-auth-transport.ts';
import { isLoopbackAddress } from './loopback-address.ts';
import { loadOrCreateMcpToken } from './mcp-token.ts';
import { runtimeProfile } from './runtime-profile.ts';
import { currentVOSUser, vosAuthEnabled, type VOSUserContext } from './vos-user-context.ts';

export const EDITOR_BOOTSTRAP_HEADER = 'x-openchatcut-editor-bootstrap';

/** Lazy so tests and the env override never touch the filesystem. */
const persistentMcpTokens = new Map<string, string>();
const vosMcpOwners = new Map<string, VOSUserContext>();

function resolvePersistentMcpToken(): string {
  const profile = runtimeProfile();
  const cached = persistentMcpTokens.get(profile.rootDir);
  if (cached) return cached;
  {
    const result = loadOrCreateMcpToken(
      profile.mode === 'isolated-dev'
        ? { profileId: profile.id }
        : profile.mode === 'vos-user' ? { rootDir: profile.rootDir } : {},
    );
    if (!result.persisted) {
      // The MCP guide promises a stable token; when the filesystem breaks that
      // promise the user deserves one line saying so and how to pin it.
      console.warn('[mcp] token could not be persisted and will change on restart; set OPENCHATCUT_MCP_TOKEN to pin it');
    }
    persistentMcpTokens.set(profile.rootDir, result.token);
    return result.token;
  }
}
const LOCAL_EDITOR_HOSTS: Readonly<Record<string, true>> = {
  localhost: true,
  '127.0.0.1': true,
  '[::1]': true,
};

export function externalMcpToken(): string {
  const token = (!vosAuthEnabled() ? process.env.OPENCHATCUT_MCP_TOKEN?.trim() : '') || resolvePersistentMcpToken();
  const user = currentVOSUser();
  if (user) vosMcpOwners.set(token, user);
  return token;
}

export function externalMcpVOSUser(req: IncomingMessage): VOSUserContext | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return vosMcpOwners.get(authorization.slice('Bearer '.length));
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function externalMcpAuthorized(req: IncomingMessage): boolean {
  return secretMatches(req.headers.authorization, `Bearer ${externalMcpToken()}`);
}

export function headerValue(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value ? value : null;
}

export function configuredEditorOrigin(): string | null {
  const configured = process.env.OPENCHATCUT_EDITOR_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function requestEditorOrigin(req: IncomingMessage): string | null {
  const host = headerValue(req, 'host');
  if (!host || /[/\\@?#,\s]/.test(host)) return null;
  const configured = process.env.OPENCHATCUT_EDITOR_URL?.trim();
  const expected = configuredEditorOrigin();
  if (configured && !expected) return null;
  const trustProxy = /^(?:1|true|yes)$/i.test(process.env.OPENCHATCUT_TRUST_PROXY ?? '');
  const forwardedProtocol = trustProxy ? headerValue(req, 'x-forwarded-proto')?.split(',')[0]?.trim() : null;
  const protocol = expected
    ? new URL(expected).protocol
    : forwardedProtocol === 'https' || forwardedProtocol === 'http'
      ? `${forwardedProtocol}:`
      : req.socket instanceof TLSSocket ? 'https:' : 'http:';
  try {
    const actual = new URL(`${protocol}//${host}`);
    if (expected) return actual.origin === expected ? expected : null;
    // VOS serves the editor through its own trusted reverse proxy and the
    // public host is installation-specific. The VOS session middleware runs
    // before editor routes, so accepting that proxy-provided origin here does
    // not restore the old unauthenticated remote-editor trust model.
    if (vosAuthEnabled() && trustProxy) return actual.origin;
    return LOCAL_EDITOR_HOSTS[actual.hostname.toLowerCase()] === true ? actual.origin : null;
  } catch {
    return null;
  }
}

export function trustedEditorRequest(req: IncomingMessage, requireOrigin: boolean): boolean {
  const trustProxy = /^(?:1|true|yes)$/i.test(process.env.OPENCHATCUT_TRUST_PROXY ?? '');
  if (!isLoopbackAddress(req.socket.remoteAddress) && !trustProxy) return false;
  const expected = requestEditorOrigin(req);
  if (!expected) return false;
  const origin = headerValue(req, 'origin');
  if (!origin) return !requireOrigin;
  try {
    return new URL(origin).origin === origin && origin === expected;
  } catch {
    return false;
  }
}

/** Editor-capable endpoints (uploads, model packs, external-agent bridge) are
 *  authorized purely by the loopback + Origin request shape: any page served
 *  from the local editor may call them. No credential handshake is needed. */
export function editorCredentialAuthorized(req: IncomingMessage, requireOrigin: boolean): boolean {
  return trustedEditorRequest(req, requireOrigin);
}

export function editorBootstrapPayload(): EditorBootstrapInfo {
  return { mcpToken: externalMcpToken() };
}
