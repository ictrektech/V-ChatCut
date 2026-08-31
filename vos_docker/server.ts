import { resolve } from 'node:path';
import { startEmbeddedServer } from '../desktop/embedded-server.ts';

function runtimePort(): number {
  const value = Number(process.env.PORT ?? 5199);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`PORT must be an integer between 1024 and 65535 (got ${process.env.PORT ?? ''})`);
  }
  return value;
}

const host = process.env.OPENCHATCUT_BIND_HOST?.trim() || '0.0.0.0';
const port = runtimePort();
const embedded = await startEmbeddedServer(resolve(process.cwd(), 'dist'), {
  bindHost: host,
  canonicalPort: port,
  strictPort: true,
});

process.stdout.write(`[vos] V-ChatCut listening on ${host}:${embedded.port}\n`);

const shutdown = () => {
  embedded.server.close((error) => {
    if (error) {
      console.error('[vos] shutdown failed', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
