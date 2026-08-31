// xAI subscription session for the built-in Agent, managed server-side.
//
// Login itself is owned by the official Grok CLI (`grok login`, OAuth at
// auth.x.ai) and persisted by it in ~/.grok/auth.json. This module imports
// that session on explicit user action, keeps its own copy under the active
// runtime profile, refreshes it through the first-party token endpoint before
// expiry, and mirrors the current access token into the keystore so the llm
// proxy, the connection test, and model selection all read it through the
// normal provider path. Secrets never leave the server.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setKeys } from './keystore.ts';
import { proxyDispatcher } from './outbound-proxy.ts';
import { runtimeProfile } from './runtime-profile.ts';

export const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
const TOKEN_ENDPOINT = `${XAI_OAUTH_ISSUER}/oauth2/token`;
const CLI_AUTH_JSON = join(homedir(), '.grok', 'auth.json');
const sessionFile = () => join(runtimeProfile().rootDir, 'xai-oauth-session.json');
const ACCESS_KEY = 'LLM_XAI_OAUTH_API_KEY';
// The Grok CLI keys its session by "<issuer>::<client id>"; accept the
// first-party issuer with any UUID-shaped public client id so a future CLI
// client rotation still imports.
const OUTER_KEY = /^https:\/\/auth\.x\.ai::([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const REFRESH_SKEW_MS = 120_000;
const TOKEN_TIMEOUT_MS = 15_000;
const DEFAULT_EXPIRES_SECONDS = 3600;
const MAX_FIELD_LENGTH = 4096;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface XaiOauthStatus {
  readonly found: boolean;
  readonly email: string;
  readonly expiresAt: number;
  readonly error: string;
}

interface XaiSession {
  readonly access: string;
  readonly refresh: string;
  readonly expiresAt: number;
  readonly clientId: string;
  readonly email: string;
}

type FetchInit = Parameters<typeof fetch>[1] & { dispatcher?: unknown };

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH
    ? value
    : '';
}

function finitePositive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse the official CLI session file; returns null on any shape violation. */
export function parseGrokAuthJson(text: string): XaiSession | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  for (const [key, value] of Object.entries(doc)) {
    const match = OUTER_KEY.exec(key);
    if (!match || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const access = nonEmptyString(entry.key);
    const refresh = nonEmptyString(entry.refresh_token);
    if (!access || !refresh) continue;
    return {
      access,
      refresh,
      expiresAt: finitePositive(entry.expires_at),
      clientId: match[1],
      email: typeof entry.email === 'string' ? entry.email.slice(0, 200) : '',
    };
  }
  return null;
}

function validSession(value: unknown): XaiSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const access = nonEmptyString(entry.access);
  const refresh = nonEmptyString(entry.refresh);
  const clientId = nonEmptyString(entry.clientId);
  if (!access || !refresh || !clientId) return null;
  return {
    access,
    refresh,
    expiresAt: finitePositive(entry.expiresAt),
    clientId,
    email: typeof entry.email === 'string' ? entry.email.slice(0, 200) : '',
  };
}

export function readSessionFile(): XaiSession | null {
  try {
    return validSession(JSON.parse(readFileSync(sessionFile(), 'utf8')));
  } catch {
    return null;
  }
}

export function persistSession(session: XaiSession): void {
  const file = sessionFile();
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function dropSessionFile(): void {
  rmSync(sessionFile(), { force: true });
}

interface OAuthState {
  current: XaiSession | null;
  statusError: string;
  timer: NodeJS.Timeout | null;
  initStarted: boolean;
  retryDelayMs: number;
  lifecycleQueue: Promise<void>;
}
const states = new Map<string, OAuthState>();
function oauthState(): OAuthState {
  const root = runtimeProfile().rootDir;
  let state = states.get(root);
  if (!state) {
    state = { current: null, statusError: '', timer: null, initStarted: false,
      retryDelayMs: RETRY_MIN_MS, lifecycleQueue: Promise.resolve() };
    states.set(root, state);
  }
  return state;
}

function serializeLifecycle<T>(work: () => Promise<T>): Promise<T> {
  const state = oauthState();
  const result = state.lifecycleQueue.then(work, work);
  state.lifecycleQueue = result.then(() => undefined, () => undefined);
  return result;
}

function clearTimer(state = oauthState()): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function armTimer(delayOverride?: number): void {
  const state = oauthState();
  clearTimer(state);
  if (!state.current || state.current.expiresAt <= 0) return;
  const delay = delayOverride
    ?? Math.max(1_000, state.current.expiresAt - Date.now() - REFRESH_SKEW_MS);
  state.timer = setTimeout(() => {
    void ensureFreshXaiOauth().catch(() => {});
  }, delay);
  state.timer.unref();
}

async function commitSession(next: XaiSession, previous: XaiSession | null): Promise<void> {
  await setKeys({ [ACCESS_KEY]: next.access });
  try {
    persistSession(next);
  } catch (error) {
    await setKeys({ [ACCESS_KEY]: previous?.access ?? '' }).catch(() => undefined);
    throw error;
  }
  oauthState().current = next;
}

export async function refreshTokens(session: XaiSession): Promise<XaiSession> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refresh,
    client_id: session.clientId,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    dispatcher: proxyDispatcher(),
  } as FetchInit);
  if (!response.ok) {
    let code = '';
    try {
      const payload = (await response.json()) as { error?: unknown };
      code = typeof payload.error === 'string' ? payload.error : '';
    } catch {
      // Non-JSON failure keeps the status only.
    }
    throw new Error(`refresh HTTP ${response.status}${code ? ` · ${code.slice(0, 60)}` : ''}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const access = nonEmptyString(payload.access_token);
  if (!access) throw new Error('refresh response missing access_token');
  const expiresIn = finitePositive(payload.expires_in) || DEFAULT_EXPIRES_SECONDS;
  const rotated = nonEmptyString(payload.refresh_token);
  return {
    ...session,
    access,
    refresh: rotated || session.refresh,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function invalidateSession(): Promise<void> {
  const state = oauthState();
  clearTimer(state);
  state.current = null;
  state.statusError = '登录会话已失效，请重新导入。';
  dropSessionFile();
  state.retryDelayMs = RETRY_MIN_MS;
  await setKeys({ [ACCESS_KEY]: '' });
}

async function ensureFreshNow(): Promise<void> {
  const state = oauthState();
  if (!state.current) return;
  clearTimer(state);
  if (state.current.expiresAt - Date.now() > REFRESH_SKEW_MS) {
    armTimer();
    return;
  }
  try {
    const previous = state.current;
    const next = await refreshTokens(previous);
    await commitSession(next, previous);
    state.statusError = '';
    state.retryDelayMs = RETRY_MIN_MS;
    armTimer();
  } catch (error) {
    const message = messageOf(error);
    if (message.includes('invalid_grant')) {
      await invalidateSession();
      return;
    }
    state.statusError = message.slice(0, 160);
    const delay = state.retryDelayMs;
    state.retryDelayMs = Math.min(RETRY_MAX_MS, state.retryDelayMs * 2);
    armTimer(delay);
  }
}

/** Refresh before expiry; a revoked grant invalidates the local session. */
export function ensureFreshXaiOauth(): Promise<void> {
  return serializeLifecycle(ensureFreshNow);
}

/** Load the persisted session and re-arm the refresh timer (server start). */
export function initXaiOauth(): Promise<void> {
  return serializeLifecycle(async () => {
    const state = oauthState();
    if (state.initStarted) return;
    const stored = readSessionFile();
    if (stored) {
      state.current = stored;
      await setKeys({ [ACCESS_KEY]: stored.access });
      await ensureFreshNow();
    } else {
      await setKeys({ [ACCESS_KEY]: '' });
    }
    state.initStarted = true;
  });
}

/** Sync accessor for the llm proxy: the freshest token or an empty string. */
export function xaiOauthAccessToken(): string {
  return oauthState().current?.access ?? '';
}

export function xaiOauthStatus(): XaiOauthStatus {
  const state = oauthState();
  return state.current
    ? { found: true, email: state.current.email, expiresAt: state.current.expiresAt, error: state.statusError }
    : { found: false, email: '', expiresAt: 0, error: state.statusError };
}

/** Adopt the official CLI session on explicit user action. */
export function importXaiOauthFromCli(): Promise<XaiOauthStatus> {
  return serializeLifecycle(async () => {
    const state = oauthState();
    let text: string;
    try {
      text = readFileSync(CLI_AUTH_JSON, 'utf8');
    } catch {
      throw new Error('未找到 ~/.grok/auth.json。请先在终端运行官方 Grok CLI 登录：grok login，完成后回来点击导入。');
    }
    const parsed = parseGrokAuthJson(text);
    if (!parsed) {
      throw new Error('无法解析 ~/.grok/auth.json 中的登录会话。请先在终端运行 grok login 完成登录。');
    }
    const previous = state.current;
    try {
      const next = parsed.expiresAt - Date.now() > REFRESH_SKEW_MS
        ? parsed
        : await refreshTokens(parsed);
      await commitSession(next, previous);
      state.statusError = '';
      state.retryDelayMs = RETRY_MIN_MS;
      armTimer();
      return xaiOauthStatus();
    } catch (error) {
      state.current = previous;
      state.statusError = messageOf(error).slice(0, 160);
      armTimer();
      throw new Error(`登录会话已读取但刷新失败：${messageOf(error)}`);
    }
  });
}

export function logoutXaiOauth(): Promise<void> {
  return serializeLifecycle(async () => {
    const state = oauthState();
    clearTimer(state);
    state.current = null;
    state.statusError = '';
    state.retryDelayMs = RETRY_MIN_MS;
    dropSessionFile();
    await setKeys({ [ACCESS_KEY]: '' });
  });
}
