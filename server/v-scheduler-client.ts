import { currentVOSUser, vosAuthEnabled } from './vos-user-context.ts';

export const V_SCHEDULER_BASE_URL = 'http://v-scheduler:8080';

export function vSchedulerAccessToken(): string {
  if (!vosAuthEnabled()) return '';
  return currentVOSUser()?.accessToken?.trim() ?? '';
}

export function requireVSchedulerAccessToken(): string {
  const token = vSchedulerAccessToken();
  if (!token) throw new Error('V-Scheduler requires the current VOS login');
  return token;
}

export function vSchedulerHeaders(): Record<string, string> {
  const token = requireVSchedulerAccessToken();
  return { Authorization: `Bearer ${token}` };
}

export function vSchedulerApiBaseUrl(): string {
  return `${V_SCHEDULER_BASE_URL}/v1`;
}

export function vSchedulerModelCatalogUrl(): string {
  return `${V_SCHEDULER_BASE_URL}/api/v1/models`;
}

export function vSchedulerVoicesUrl(model: string): string {
  const params = new URLSearchParams({ model });
  return `${vSchedulerApiBaseUrl()}/audio/voices?${params.toString()}`;
}
