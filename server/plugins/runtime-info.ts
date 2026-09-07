import type { Plugin } from 'vite';

export function runtimeAppVersion(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.VOS_APP_VERSION?.trim() || null;
}

export function runtimeInfoPlugin(): Plugin {
  return {
    name: 'openchatcut-runtime-info',
    configureServer(server) {
      server.middlewares.use('/api/runtime-info', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET');
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ version: runtimeAppVersion() }));
      });
    },
  };
}
