import { useCallback, useEffect, useState } from 'react';

/** Discover through the authenticated server, never through a browser-held key. */
export function useSchedulerVisionModels(enabled: boolean) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setModels([]);
    void fetch('/api/keys/test', { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'llm/vrouter' }) })
      .then(async (response) => {
        const body = await response.json() as {
          ok?: boolean; message?: string; fieldOptions?: { V_SCHEDULER_VISION_MODELS?: string[] };
        };
        if (!response.ok || !body.ok) throw new Error(body.message || `HTTP ${response.status}`);
        if (!controller.signal.aborted) setModels(body.fieldOptions?.V_SCHEDULER_VISION_MODELS ?? []);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [enabled, revision]);
  return { models, error, busy, refresh };
}
