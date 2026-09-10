import { proxyDispatcher } from './outbound-proxy.ts';

type FetchInit = Parameters<typeof fetch>[1] & { dispatcher?: unknown };

// Probes send real stored credentials to user-configurable URLs. Local model
// endpoints remain valid, while metadata and link-local destinations do not.
export function probeUrlError(url: RequestInfo | URL): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return '探测地址不是合法 URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `探测地址协议不支持:${parsed.protocol}`;
  }
  if (parsed.username || parsed.password) return '探测地址不允许携带内嵌凭据';
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || host.startsWith('fe80:')
    || host === 'metadata.google.internal') {
    return '探测地址指向云元数据/链路本地网段,已拒绝';
  }
  return null;
}

export function fetchWithProxy(url: RequestInfo | URL, init?: FetchInit): Promise<Response> {
  const unsafe = probeUrlError(url);
  if (unsafe) return Promise.reject(new Error(unsafe));
  return fetch(url, { ...init, dispatcher: proxyDispatcher() } as RequestInit);
}
