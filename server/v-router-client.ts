import { currentVOSUser, vosAuthEnabled } from './vos-user-context.ts';

export const V_ROUTER_BASE_URL = 'http://v-router:8080';

export function vRouterAccessToken(): string {
  if (!vosAuthEnabled()) return '';
  return currentVOSUser()?.accessToken?.trim() ?? '';
}

export function requireVRouterAccessToken(): string {
  const token = vRouterAccessToken();
  if (!token) throw new Error('V-Router requires the current VOS login');
  return token;
}

export function vRouterHeaders(): Record<string, string> {
  const token = requireVRouterAccessToken();
  return { Authorization: `Bearer ${token}` };
}

export function vRouterApiBaseUrl(): string {
  return `${V_ROUTER_BASE_URL}/v1`;
}

export function vRouterModelCatalogUrl(): string {
  return `${V_ROUTER_BASE_URL}/api/v1/models`;
}

export function vRouterVoicesUrl(model: string): string {
  const params = new URLSearchParams({ model });
  return `${vRouterApiBaseUrl()}/audio/voices?${params.toString()}`;
}
