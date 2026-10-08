import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { start } from '../src/server.js';
import { captureLogs } from './helpers.js';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

describe('server lifecycle', () => {
  it('serves, then drains and closes on stop', async () => {
    const logs = captureLogs();
    const port = await freePort();
    const running = await start({ env: { PORT: String(port), DRAIN_DELAY_SECONDS: '0' }, logStream: logs });
    expect(running.port).toBe(port);

    const res = await fetch(`http://127.0.0.1:${port}/api/sum?term_one=2&term_two=3`);
    expect(await res.json()).toEqual({ result: 5 });

    await Promise.all([running.stop(), running.stop()]);
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
    const msgs = logs.parsed().map((e) => e.msg);
    expect(msgs).toEqual(expect.arrayContaining(['listening', 'shutting down', 'stopped']));
  });

  it('fails on a port in use and on bad config', async () => {
    const port = await freePort();
    const first = await start({ env: { PORT: String(port), DRAIN_DELAY_SECONDS: '0' }, logStream: captureLogs() });
    await expect(start({ env: { PORT: String(port) }, logStream: captureLogs() })).rejects.toThrow(/EADDRINUSE/);
    await first.stop();
    await expect(start({ env: { PORT: 'nope' } })).rejects.toThrow(/PORT/);
  });
});

describe('config', () => {
  it('has defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 8000,
      logLevel: 'info',
      drainDelayMs: 5000,
      shutdownTimeoutMs: 10000,
      maxLiveStreams: 100,
    });
  });

  it('reads overrides', () => {
    expect(
      loadConfig({
        PORT: '9000',
        LOG_LEVEL: 'DEBUG',
        DRAIN_DELAY_SECONDS: '0',
        SHUTDOWN_TIMEOUT_SECONDS: '30',
        MAX_LIVE_STREAMS: '5',
      }),
    ).toEqual({ port: 9000, logLevel: 'debug', drainDelayMs: 0, shutdownTimeoutMs: 30000, maxLiveStreams: 5 });
  });

  it.each([
    { PORT: 'eighty' },
    { PORT: '70000' },
    { LOG_LEVEL: 'loud' },
    { DRAIN_DELAY_SECONDS: '-1' },
    { SHUTDOWN_TIMEOUT_SECONDS: '0' },
    { MAX_LIVE_STREAMS: '1.5' },
  ])('rejects %o', (env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
