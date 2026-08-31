import { AsyncLocalStorage } from 'node:async_hooks';

export interface VOSUserContext {
  readonly provider: 'vos-oidc';
  readonly subject: string;
  readonly username: string;
  readonly admin: boolean;
  /** Opaque, filesystem-safe identity derived from provider + immutable subject. */
  readonly namespace: string;
}

const storage = new AsyncLocalStorage<VOSUserContext>();

export function vosAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(?:1|true|yes)$/i.test(env.OPENCHATCUT_VOS_AUTH_ENABLED ?? '');
}

export function currentVOSUser(): VOSUserContext | undefined {
  return storage.getStore();
}

export function requireVOSUser(): VOSUserContext {
  const user = currentVOSUser();
  if (!user) throw new Error('VOS user context is required');
  return user;
}

export function runAsVOSUser<T>(user: VOSUserContext, work: () => T): T {
  return storage.run(user, work);
}
