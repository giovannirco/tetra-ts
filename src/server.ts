// Entry point: serves the Tetra API and UI on port 8000 and shuts down
// gracefully on SIGTERM (fail readiness, drain, close).

import { pathToFileURL } from 'node:url';
import { buildApp, type BuildOptions } from './app.js';
import { type Env, loadConfig } from './config.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Running {
  port: number;
  /** Runs the SIGTERM shutdown sequence; safe to call more than once. */
  stop(): Promise<void>;
}

export async function start({ env = process.env, logStream }: { env?: Env } & Pick<BuildOptions, 'logStream'> = {}) {
  const config = loadConfig(env);
  const tetra = buildApp(config, { env, logStream });
  const { app } = tetra;

  await app.listen({
    port: config.port,
    host: '0.0.0.0',
    listenTextResolver: (address) => `server bound to ${address}`,
  });
  app.server.headersTimeout = 5_000;
  app.log.info({ addr: `:${config.port}`, version: tetra.info.version }, 'listening');

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      app.log.info({ drain_delay: `${config.drainDelayMs / 1000}s` }, 'shutting down');
      // Keep serving while endpoints and load balancers stop routing here.
      tetra.drain();
      await sleep(config.drainDelayMs);
      tetra.closeStreams();
      // Connections still open after the timeout are cut.
      const force = setTimeout(() => app.server.closeAllConnections(), config.shutdownTimeoutMs);
      await app.close();
      clearTimeout(force);
      app.log.info('stopped');
    })();
    return stopping;
  };

  const address = app.server.address();
  return { port: typeof address === 'object' && address ? address.port : config.port, stop } satisfies Running;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { stop } = await start();
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => void stop().then(() => process.exit(0)));
    }
  } catch (err) {
    console.error('tetra:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
