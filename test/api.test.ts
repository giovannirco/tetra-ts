import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tetra } from '../src/app.js';
import { build } from './helpers.js';

let tetra: Tetra;
beforeAll(async () => {
  tetra = await build();
});
afterAll(() => tetra.app.close());

describe('calculations', () => {
  it.each([
    ['/api/sum?term_one=4&term_two=1', 200, '{"result":5}'],
    ['/api/sub?term_one=4&term_two=1', 200, '{"result":3}'],
    ['/api/mul?term_one=4&term_two=1', 200, '{"result":4}'],
    ['/api/div?term_one=4&term_two=1', 200, '{"result":4}'],
    ['/api/div?term_one=7&term_two=2', 200, '{"result":3}'],
    ['/api/sum?term_one=-4&term_two=%2B10', 200, '{"result":6}'],
    ['/api/sum?term_one=9223372036854775807&term_two=0', 200, '{"result":9223372036854775807}'],
    ['/api/sum?term_one=1&term_one=2&term_two=0', 200, '{"result":1}'],
    ['/api/div?term_one=1&term_two=0', 400, '{"error":"division by zero"}'],
    ['/api/mul?term_one=9223372036854775807&term_two=2', 400, '{"error":"result overflows a 64-bit integer"}'],
    ['/api/sum?term_two=1', 400, '{"error":"missing query parameter term_one"}'],
    ['/api/sum?term_one=1', 400, '{"error":"missing query parameter term_two"}'],
    ['/api/sum?term_one=abc&term_two=1', 400, '{"error":"term_one must be an integer, got \\"abc\\""}'],
    ['/api/sum?term_one=1.5&term_two=1', 400, '{"error":"term_one must be an integer, got \\"1.5\\""}'],
    [
      '/api/sum?term_one=1&term_two=99999999999999999999',
      400,
      '{"error":"term_two is outside the 64-bit integer range"}',
    ],
  ])('GET %s → %d %s', async (url, status, body) => {
    const res = await tetra.app.inject({ url });
    expect(res.statusCode).toBe(status);
    expect(res.body.trim()).toBe(body);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('cuts long input in the error message', async () => {
    const res = await tetra.app.inject({ url: `/api/sum?term_one=${'x'.repeat(40)}&term_two=1` });
    expect(res.json().error).toBe(`term_one must be an integer, got "${'x'.repeat(32)}…"`);
  });
});

describe('catalogue and fallback', () => {
  it('lists the operations', async () => {
    const body = (await tetra.app.inject({ url: '/api' })).json();
    expect(body.implementation).toBe('typescript');
    expect(body.operations).toHaveLength(4);
    expect(body.operations[3]).toEqual({ name: 'div', symbol: '÷', label: 'Division', path: '/api/div' });
  });

  it('answers 405 for a known operation with the wrong method, 404 otherwise', async () => {
    const post = await tetra.app.inject({ method: 'POST', url: '/api/sum?term_one=1&term_two=1' });
    expect(post.statusCode).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
    expect(post.json()).toEqual({ error: 'method not allowed' });

    const unknown = await tetra.app.inject({ url: '/api/pow?term_one=2&term_two=8' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'not found' });

    expect((await tetra.app.inject({ method: 'DELETE', url: '/api/pow' })).statusCode).toBe(404);
    expect((await tetra.app.inject({ method: 'HEAD', url: '/api/sum?term_one=1&term_two=1' })).statusCode).toBe(200);
  });
});
