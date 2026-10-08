import { describe, expect, it } from 'vitest';
import { buildApp, requestIdFor } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { build, captureLogs, listen } from './helpers.js';

describe('operations endpoints', () => {
  it('serves probes, version, metrics, headers and the request log', async () => {
    const tetra = await build({ VERSION: 'v9.9.9', COMMIT: 'abc1234' });
    const { app } = tetra;

    const res = await app.inject({ url: '/api/sub?term_one=4&term_two=1' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');

    expect((await app.inject({ url: '/healthz' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ url: '/readyz' })).json()).toEqual({ status: 'ready' });
    const version = (await app.inject({ url: '/version' })).json();
    expect(version).toMatchObject({ implementation: 'typescript', version: 'v9.9.9', commit: 'abc1234' });
    expect(version.hostname).toBeTruthy();

    await app.inject({ url: '/nowhere-at-all' });
    await app.inject({ method: 'PUT', url: '/healthz' });
    const metrics = (await app.inject({ url: '/metrics' })).body;
    for (const want of [
      'tetra_http_requests_total{method="GET",route="/api/sub",status="200"} 1',
      'tetra_http_requests_total{method="GET",route="/",status="404"} 1',
      'tetra_http_requests_total{method="PUT",route="/",status="405"} 1',
      'tetra_http_request_duration_seconds_count{method="GET",route="/api/sub"} 1',
      'tetra_calc_operations_total{operation="sub",outcome="ok"} 1',
      'tetra_build_info{implementation="typescript",version="v9.9.9",commit="abc1234",runtime="node',
      'tetra_live_subscribers 0',
      'tetra_live_events_dropped_total 0',
      'process_resident_memory_bytes',
    ]) {
      expect(metrics).toContain(want);
    }

    const entry = tetra.logs.parsed().find((e) => e.route === '/api/sub');
    expect(entry).toMatchObject({ msg: 'request', level: 'INFO', status: 200, method: 'GET' });
    expect(entry.request_id).toBeTruthy();
    expect(entry.time).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(tetra.logs.parsed().some((e) => e.route === '/healthz' && e.status === 200)).toBe(false);
    await app.close();
  });

  it('keeps a valid incoming request id and replaces anything else', async () => {
    expect(requestIdFor({ headers: { 'x-request-id': 'gw-1234.abc_DEF' } })).toBe('gw-1234.abc_DEF');
    for (const bad of [undefined, '', 'bad id', 'a'.repeat(65)]) {
      expect(requestIdFor({ headers: { 'x-request-id': bad } })).toMatch(/^[0-9a-f]{32}$/);
    }
    const tetra = await build();
    const res = await tetra.app.inject({ url: '/healthz', headers: { 'x-request-id': 'trace-42' } });
    expect(res.headers['x-request-id']).toBe('trace-42');
    await tetra.app.close();
  });

  it('maps unexpected errors to 500 and keeps 4xx framework errors', async () => {
    const logs = captureLogs();
    const tetra = buildApp(loadConfig({}), { logStream: logs }); // routes can only be added before ready()
    tetra.app.get('/boom', () => {
      throw new Error('boom');
    });
    const res = await tetra.app.inject({ url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal error' });
    expect(logs.parsed().some((e) => e.msg === 'unhandled error')).toBe(true);
    await tetra.app.close();
  });
});

describe('static UI', () => {
  it('serves the page and vendored files with cache headers', async () => {
    const { app } = await build();
    const index = await app.inject({ url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.body).toContain('<canvas id="scene"');

    const vendor = await app.inject({ url: '/vendor/three/build/three.module.min.js' });
    expect(vendor.statusCode).toBe(200);
    expect(vendor.headers['cache-control']).toBe('public, max-age=86400');
    expect(vendor.headers['content-type']).toMatch(/^text\/javascript/);

    expect((await app.inject({ url: '/nope.js' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/../package.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/' })).statusCode).toBe(405);
    await app.close();
  });
});

describe('drain and live stream', () => {
  it('streams calculation events and fails readiness once draining', async () => {
    const srv = await listen();
    try {
      const stream = await fetch(`${srv.base}/events`);
      expect(stream.headers.get('content-type')).toBe('text/event-stream');
      expect(stream.headers.get('x-request-id')).toBeTruthy();
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let text = decoder.decode((await reader.read()).value);
      expect(text).toMatch(/^retry: 3000/);

      await fetch(`${srv.base}/api/mul?term_one=6&term_two=7`);
      while (!text.includes('data: ')) text += decoder.decode((await reader.read()).value);
      const event = JSON.parse(text.split('data: ')[1]!.split('\n')[0]!);
      expect(event).toMatchObject({ operation: 'mul', result: '42', outcome: 'ok', status: 200 });

      srv.drain();
      const ready = await fetch(`${srv.base}/readyz`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: 'draining' });
      await reader.cancel();
    } finally {
      await srv.close();
    }
  });

  it('refuses streams beyond the limit', async () => {
    const srv = await listen({ MAX_LIVE_STREAMS: '0' });
    try {
      const res = await fetch(`${srv.base}/events`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'too many live streams' });
    } finally {
      await srv.close();
    }
  });
});
