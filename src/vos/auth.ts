export interface VOSSessionUser {
  username: string;
  namespace: string;
}

interface SessionResponse {
  enabled?: boolean;
  authenticated?: boolean;
  user?: VOSSessionUser;
  clientId?: string;
  scope?: string;
}

interface VOSOAuth2 {
  authorize(params: Record<string, unknown>): Promise<{ code: string; state: string }>;
  token(params: Record<string, unknown>): Promise<{ access_token?: string }>;
}

declare global {
  interface Window {
    vos_platform?: { api?: { v1000?: { oauth2?: VOSOAuth2 } } };
  }
}

const bytes = (length = 32): Uint8Array => crypto.getRandomValues(new Uint8Array(length));
const base64url = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function oauth2Bridge(timeoutMs = 3_000): Promise<VOSOAuth2 | null> {
  const current = window.vos_platform?.api?.v1000?.oauth2;
  if (current) return current;
  if (window.parent === window) return null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const bridge = window.vos_platform?.api?.v1000?.oauth2;
    if (bridge) return bridge;
  }
  return null;
}

async function currentSession(): Promise<SessionResponse> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return { enabled: false };
  return response.json() as Promise<SessionResponse>;
}

async function exchangeFastpath(config: SessionResponse, oauth2: VOSOAuth2): Promise<VOSSessionUser> {
  const verifier = base64url(bytes());
  const state = base64url(bytes());
  const nonce = base64url(bytes());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const clientId = config.clientId || 'com.ictrek.v-chatcut';
  const authorized = await oauth2.authorize({
    client_id: clientId,
    response_type: 'code',
    scope: config.scope || 'openid profile email',
    state,
    nonce,
    code_challenge: base64url(digest),
    code_challenge_method: 'S256',
  });
  if (authorized.state !== state) throw new Error('VOS OIDC state mismatch');
  const tokens = await oauth2.token({
    grant_type: 'authorization_code',
    code: authorized.code,
    code_verifier: verifier,
    client_id: clientId,
  });
  if (!tokens.access_token) throw new Error('VOS OIDC did not return an access token');
  const response = await fetch('/api/auth/vos-oidc', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: tokens.access_token }),
  });
  const payload = await response.json() as SessionResponse & { error?: string };
  if (!response.ok || !payload.user) throw new Error(payload.error || 'VOS login failed');
  return payload.user;
}

/** Returns null outside VOS mode. In VOS mode a user is mandatory before any
 * project/cache module is initialized. A fresh Fastpath exchange on page load
 * also detects account switches in the parent VOS shell. */
export async function bootstrapVOSSession(): Promise<VOSSessionUser | null> {
  const config = await currentSession();
  if (!config.enabled) return null;
  const bridge = await oauth2Bridge();
  if (bridge) return exchangeFastpath(config, bridge);
  if (config.authenticated && config.user) return config.user;
  throw new Error('当前 VOS 未提供 OIDC Fastpath，无法验证用户身份');
}
