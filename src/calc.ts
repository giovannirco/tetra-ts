// The arithmetic operations exposed by the API.
//
// JavaScript numbers lose precision above 2^53, so terms and results are
// bigint and every result is range-checked against int64, which keeps the
// API identical to the other implementations. To add an operation, append
// it to OPERATIONS: the routes, the catalogue and the UI all read this list.

export const MAX_INT64 = 9223372036854775807n;
export const MIN_INT64 = -9223372036854775808n;

export type Outcome = 'ok' | 'invalid_input' | 'division_by_zero' | 'overflow';

/** An error the API answers with 400; `outcome` labels it in metrics. */
export class CalcError extends Error {
  constructor(
    message: string,
    readonly outcome: Exclude<Outcome, 'ok'>,
  ) {
    super(message);
  }
}

export const divisionByZero = () => new CalcError('division by zero', 'division_by_zero');
export const overflow = () => new CalcError('result overflows a 64-bit integer', 'overflow');

export interface Operation {
  readonly name: string;
  readonly symbol: string;
  readonly label: string;
  readonly apply: (a: bigint, b: bigint) => bigint;
}

function checked(r: bigint): bigint {
  if (r > MAX_INT64 || r < MIN_INT64) throw overflow();
  return r;
}

export const OPERATIONS: readonly Operation[] = Object.freeze([
  { name: 'sum', symbol: '+', label: 'Addition', apply: (a, b) => checked(a + b) },
  { name: 'sub', symbol: '−', label: 'Subtraction', apply: (a, b) => checked(a - b) },
  { name: 'mul', symbol: '×', label: 'Multiplication', apply: (a, b) => checked(a * b) },
  {
    name: 'div',
    symbol: '÷',
    label: 'Division',
    // bigint division truncates toward zero: 7n / 2n === 3n, -7n / 2n === -3n.
    apply: (a, b) => {
      if (b === 0n) throw divisionByZero();
      return checked(a / b);
    },
  },
]);

export function lookup(name: string): Operation | undefined {
  return OPERATIONS.find((op) => op.name === name);
}
