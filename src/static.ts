// Serves the UI from web/. Files are read once at startup, so a request
// can never reach outside the directory and serving needs no disk I/O.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};

function walk(dir: string, root: string, files: Map<string, Buffer>): Map<string, Buffer> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, root, files);
    else if (TYPES[extname(name)] || name === 'LICENSE' || name === 'VERSION') {
      files.set(`/${relative(root, full).split(sep).join('/')}`, readFileSync(full));
    }
  }
  return files;
}

/** Returns a handler for GET /* that serves files under root. */
export function staticFiles(root: string) {
  const files = walk(root, root, new Map());
  return (req: FastifyRequest, reply: FastifyReply) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = pathname === '/' ? '/index.html' : pathname;
    const body = files.get(path);
    if (!body) return reply.code(404).type('text/plain; charset=utf-8').send('404 page not found\n');
    return (
      reply
        .type(TYPES[extname(path)] ?? 'text/plain; charset=utf-8')
        // Vendored libraries are immutable per release; the app's files are revalidated.
        .header('Cache-Control', path.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache')
        .send(body)
    );
  };
}
