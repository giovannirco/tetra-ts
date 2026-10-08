// RED metrics for every request, calculation outcomes, and one structured
// log line per request. Names and labels match the other Tetra
// implementations, so one dashboard and one rule file cover all of them.

import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import client from 'prom-client';
import type { VersionInfo } from './version.js';

const STREAM_ROUTE = '/events';
const QUIET_ROUTES = new Set(['/healthz', '/readyz', '/metrics']);
const BUCKETS = [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

export interface LiveStats {
  readonly subscribers: number;
  readonly dropped: number;
}

/** The route label: the matched template, so its values stay bounded. */
export function routeLabel(req: FastifyRequest): string {
  if (req.tetraRoute) return req.tetraRoute;
  const url = req.routeOptions.url;
  if (!url) return 'unmatched';
  return url === '/*' ? '/' : url;
}

export function createTelemetry(info: VersionInfo, live: LiveStats) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const requests = new client.Counter({
    name: 'tetra_http_requests_total',
    help: 'HTTP requests by method, route and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'tetra_http_request_duration_seconds',
    help: 'HTTP request latency by method and route.',
    labelNames: ['method', 'route'] as const,
    buckets: BUCKETS,
    registers: [registry],
  });
  const inFlight = new client.Gauge({
    name: 'tetra_http_requests_in_flight',
    help: 'HTTP requests currently being served, live streams included.',
    registers: [registry],
  });
  const calcOps = new client.Counter({
    name: 'tetra_calc_operations_total',
    help: 'Calculations by operation and outcome (ok, invalid_input, division_by_zero, overflow).',
    labelNames: ['operation', 'outcome'] as const,
    registers: [registry],
  });
  new client.Gauge({
    name: 'tetra_build_info',
    help: 'Always 1; labels identify the running build.',
    labelNames: ['implementation', 'version', 'commit', 'runtime'] as const,
    registers: [registry],
  }).set({ implementation: info.implementation, version: info.version, commit: info.commit, runtime: info.runtime }, 1);
  new client.Gauge({
    name: 'tetra_live_subscribers',
    help: 'Open Server-Sent Events streams.',
    registers: [registry],
    collect() {
      this.set(live.subscribers);
    },
  });
  new client.Counter({
    name: 'tetra_live_events_dropped_total',
    help: 'Live events dropped because a subscriber was too slow.',
    registers: [registry],
    collect() {
      this.reset();
      this.inc(live.dropped);
    },
  });

  return {
    registry,

    calcOutcome(operation: string, outcome: string): void {
      calcOps.inc({ operation, outcome });
    },

    /**
     * Measures a request from the raw response's finish/close events, so
     * hijacked replies (the live stream) are measured like any other.
     */
    track(req: FastifyRequest, reply: FastifyReply, logger: FastifyBaseLogger): void {
      const started = process.hrtime.bigint();
      inFlight.inc();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        inFlight.dec();
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const route = routeLabel(req);
        const status = reply.raw.statusCode;
        requests.inc({ method: req.method, route, status: String(status) });
        if (route !== STREAM_ROUTE) duration.observe({ method: req.method, route }, seconds);

        const length = reply.raw.getHeader('content-length');
        const fields = {
          method: req.method,
          path: req.url.split('?')[0],
          route,
          status,
          bytes: length === undefined ? undefined : Number(length),
          duration_ms: Math.round(seconds * 1e6) / 1e3,
          request_id: req.id,
          remote_addr: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
          user_agent: req.headers['user-agent'] ?? '',
        };
        if (QUIET_ROUTES.has(route) && status < 400) logger.debug(fields, 'request');
        else logger.info(fields, 'request');
      };
      reply.raw.on('finish', finish);
      reply.raw.on('close', finish);
    },
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Route label set by handlers that answer outside a registered route. */
    tetraRoute: string;
  }
}
