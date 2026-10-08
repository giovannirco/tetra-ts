// The /api routes: the four calculations and the catalogue.
//
// This module knows nothing about metrics, the live stream or the UI; they
// observe calculations through the onEvent callback.

import type { FastifyInstance } from 'fastify';
import { CalcError, MAX_INT64, MIN_INT64, OPERATIONS, type Outcome } from './calc.js';
import { sendError, sendJSON, sendRawJSON } from './http.js';

const MAX_ECHO = 32;
const INTEGER = /^[+-]?\d+$/;

export interface CalcEvent {
  operation: string;
  term_one: string;
  term_two: string;
  result: string | null; // a string, so 64-bit values survive JavaScript clients
  status: number;
  outcome: Outcome;
  error?: string;
  duration_ms?: number;
  request_id: string;
  time: string;
}

export interface ApiOptions {
  info: { service: string; implementation: string; version: string };
  onEvent?: (event: CalcEvent) => void;
}

export const truncate = (s: string) => (s.length <= MAX_ECHO ? s : `${s.slice(0, MAX_ECHO)}…`);

/** Parse a base-10 int64 with an optional sign. */
export function parseTerm(query: URLSearchParams, name: string): bigint {
  const raw = query.get(name) ?? '';
  if (raw === '') throw new CalcError(`missing query parameter ${name}`, 'invalid_input');
  if (!INTEGER.test(raw)) {
    throw new CalcError(`${name} must be an integer, got ${JSON.stringify(truncate(raw))}`, 'invalid_input');
  }
  const value = BigInt(raw);
  if (value > MAX_INT64 || value < MIN_INT64) {
    throw new CalcError(`${name} is outside the 64-bit integer range`, 'invalid_input');
  }
  return value;
}

export function registerApi(app: FastifyInstance, { info, onEvent }: ApiOptions): void {
  const catalogue = {
    ...info,
    operations: OPERATIONS.map(({ name, symbol, label }) => ({ name, symbol, label, path: `/api/${name}` })),
  };
  app.get('/api', (req, reply) => sendJSON(reply, 200, catalogue));

  for (const op of OPERATIONS) {
    app.get(`/api/${op.name}`, (req, reply) => {
      const started = process.hrtime.bigint();
      // Read the raw query: the first value wins, as in the other implementations.
      const q = new URL(req.url, 'http://localhost').searchParams;
      const event: CalcEvent = {
        operation: op.name,
        term_one: truncate(q.get('term_one') ?? ''),
        term_two: truncate(q.get('term_two') ?? ''),
        result: null,
        status: 200,
        outcome: 'ok',
        request_id: req.id,
        time: new Date().toISOString(),
      };
      try {
        const result = op.apply(parseTerm(q, 'term_one'), parseTerm(q, 'term_two'));
        event.result = result.toString();
        // Written by hand: JSON.stringify cannot serialize a bigint.
        sendRawJSON(reply, 200, `{"result":${result}}`);
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        Object.assign(event, { status: 400, outcome: err.outcome, error: err.message });
        sendError(reply, 400, err.message);
      }
      if (onEvent) {
        event.duration_ms = Number(process.hrtime.bigint() - started) / 1e6;
        onEvent(event);
      }
      return reply;
    });
  }
}
