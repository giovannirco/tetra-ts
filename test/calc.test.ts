import { describe, expect, it } from 'vitest';
import { CalcError, MAX_INT64, MIN_INT64, OPERATIONS, lookup } from '../src/calc.js';

const apply = (name: string, a: bigint, b: bigint) => lookup(name)!.apply(a, b);

describe('operations', () => {
  it.each([
    ['sum', 4n, 1n, 5n],
    ['sum', -4n, -6n, -10n],
    ['sum', MAX_INT64 - 1n, 1n, MAX_INT64],
    ['sub', 4n, 1n, 3n],
    ['sub', 1n, 4n, -3n],
    ['sub', MIN_INT64 + 1n, 1n, MIN_INT64],
    ['mul', 6n, 7n, 42n],
    ['mul', MAX_INT64, 0n, 0n],
    ['mul', -3n, 5n, -15n],
    ['mul', MIN_INT64, 1n, MIN_INT64],
    ['div', 8n, 2n, 4n],
    ['div', 7n, 2n, 3n],
    ['div', -7n, 2n, -3n],
  ])('%s(%d, %d) = %d', (name, a, b, want) => {
    expect(apply(name, a, b)).toBe(want);
  });

  it.each([
    ['sum', MAX_INT64, 1n, 'overflow'],
    ['sum', MIN_INT64, -1n, 'overflow'],
    ['sub', MAX_INT64, -1n, 'overflow'],
    ['sub', MIN_INT64, 1n, 'overflow'],
    ['mul', MAX_INT64, 2n, 'overflow'],
    ['mul', MIN_INT64, -1n, 'overflow'],
    ['mul', 1n << 32n, 1n << 32n, 'overflow'],
    ['div', 1n, 0n, 'division_by_zero'],
    ['div', 0n, 0n, 'division_by_zero'],
    ['div', MIN_INT64, -1n, 'overflow'],
  ])('%s(%d, %d) fails with %s', (name, a, b, outcome) => {
    expect(() => apply(name, a, b)).toThrow(CalcError);
    try {
      apply(name, a, b);
    } catch (err) {
      expect((err as CalcError).outcome).toBe(outcome);
    }
  });
});

describe('registry', () => {
  it('lists the four operations in order and is frozen', () => {
    expect(OPERATIONS.map((o) => o.name)).toEqual(['sum', 'sub', 'mul', 'div']);
    for (const o of OPERATIONS) expect(o.symbol && o.label).toBeTruthy();
    expect(Object.isFrozen(OPERATIONS)).toBe(true);
    expect(lookup('pow')).toBeUndefined();
  });
});
