// Response helpers shared by the routes.

import type { FastifyReply } from 'fastify';

/** Sends an already-serialized JSON body. */
export function sendRawJSON(reply: FastifyReply, status: number, body: string): FastifyReply {
  return reply
    .code(status)
    .type('application/json; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(body + '\n');
}

export const sendJSON = (reply: FastifyReply, status: number, value: unknown) =>
  sendRawJSON(reply, status, JSON.stringify(value));

export const sendError = (reply: FastifyReply, status: number, message: string) =>
  sendJSON(reply, status, { error: message });

export const methodNotAllowed = (reply: FastifyReply) =>
  sendError(reply.header('Allow', 'GET, HEAD'), 405, 'method not allowed');
