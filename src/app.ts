// Builds the Fastify application.
//
// Request path: request ID → security headers → telemetry → routes, with a
// not-found handler that gives /api/* JSON 404/405 answers.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { registerApi } from './api.js';
import { lookup } from './calc.js';
import type { Config, Env } from './config.js';
import { methodNotAllowed, sendError, sendJSON } from './http.js';
import { Broker } from './live.js';
import { staticFiles } from './static.js';
import { createTelemetry } from './telemetry.js';
import { type VersionInfo, versionInfo } from './version.js';

const WEB_ROOT = fileURLToPath(new URL('../web', import.meta.url));

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Keep a well-formed incoming X-Request-Id (set by a gateway, say), else make one. */
export function requestIdFor(req: Pick<IncomingMessage, 'headers'>): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomBytes(16).toString('hex');
}

export interface Tetra {
  app: FastifyInstance;
  info: VersionInfo;
  /** Fail readiness; called when shutdown starts. */
  drain(): void;
  /** End the live streams so the server can close. */
  closeStreams(): void;
}

export interface BuildOptions {
  env?: Env;
  /** Where JSON log lines go; stdout by default. */
  logStream?: { write(line: string): void };
}

export function buildApp(config: Config, { env = process.env, logStream }: BuildOptions = {}): Tetra {
  const info = versionInfo(env);
  let draining = false;
  const broker = new Broker(config.maxLiveStreams);
  const telemetry = createTelemetry(info, broker);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      base: null,
      // The same keys as the other implementations: time, level, msg.
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      formatters: { level: (label: string) => ({ level: label.toUpperCase() }) },
      ...(logStream ? { stream: logStream } : {}),
    },
    disableRequestLogging: true,
    genReqId: requestIdFor,
    requestTimeout: 10_000,
    keepAliveTimeout: 60_000,
    return503OnClosing: false, // readiness and the drain delay handle the cut-over
  });
  app.decorateRequest('tetraRoute', '');

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id).headers(SECURITY_HEADERS);
    telemetry.track(req, reply, app.log);
  });

  registerApi(app, {
    info: { service: info.service, implementation: info.implementation, version: info.version },
    onEvent: (event) => {
      telemetry.calcOutcome(event.operation, event.outcome);
      broker.publish(event);
    },
  });

  app.get('/healthz', (req, reply) => sendJSON(reply, 200, { status: 'ok' }));
  app.get('/readyz', (req, reply) =>
    draining ? sendJSON(reply, 503, { status: 'draining' }) : sendJSON(reply, 200, { status: 'ready' }),
  );
  app.get('/version', (req, reply) => sendJSON(reply, 200, info));
  app.get('/metrics', async (req, reply) =>
    reply.type(telemetry.registry.contentType).send(await telemetry.registry.metrics()),
  );
  app.get('/events', (req, reply) => {
    if (!broker.accepting) return sendError(reply, 503, 'too many live streams');
    reply.hijack();
    // Hijacked replies bypass Fastify, so carry its headers over to the raw response.
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) reply.raw.setHeader(k, v);
    broker.attach(reply.raw);
    return reply;
  });
  // Any /api/ path no route claimed: 405 for a known operation with the wrong method, 404 otherwise.
  const apiFallback = (req: FastifyRequest, reply: FastifyReply, path: string) => {
    req.tetraRoute = '/api/';
    return lookup(path.slice('/api/'.length)) ? methodNotAllowed(reply) : sendError(reply, 404, 'not found');
  };

  const serveStatic = staticFiles(WEB_ROOT);
  app.get('/*', (req, reply) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    return path.startsWith('/api/') ? apiFallback(req, reply, path) : serveStatic(req, reply);
  });

  app.setNotFoundHandler((req, reply) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) return apiFallback(req, reply, path);
    // GET and HEAD always match /*, so anything that lands here used another method.
    req.tetraRoute = '/';
    return methodNotAllowed(reply);
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error({ request_id: req.id, error: String(err.stack ?? err) }, 'unhandled error');
    return sendError(reply, status, status === 500 ? 'internal error' : err.message);
  });

  return {
    app,
    info,
    drain: () => {
      draining = true;
    },
    closeStreams: () => broker.close(),
  };
}
