import { buildApp, type Tetra } from '../src/app.js';
import { type Env, loadConfig } from '../src/config.js';

export function captureLogs() {
  const lines: string[] = [];
  return { lines, write: (s: string) => void lines.push(s), parsed: () => lines.map((l) => JSON.parse(l)) };
}

export async function build(env: Env = {}): Promise<Tetra & { logs: ReturnType<typeof captureLogs> }> {
  const logs = captureLogs();
  const tetra = buildApp(loadConfig(env), { env, logStream: logs });
  await tetra.app.ready();
  return { ...tetra, logs };
}

/** Start on an ephemeral port for tests that need a real socket (streams). */
export async function listen(env: Env = {}) {
  const tetra = await build(env);
  const address = await tetra.app.listen({ port: 0, host: '127.0.0.1' });
  return {
    ...tetra,
    base: address,
    async close() {
      tetra.closeStreams();
      await tetra.app.close();
    },
  };
}
