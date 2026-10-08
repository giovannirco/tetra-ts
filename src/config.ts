// Runtime settings from the environment. Every setting has a default.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  port: number;
  logLevel: LogLevel;
  drainDelayMs: number;
  shutdownTimeoutMs: number;
  maxLiveStreams: number;
}

export type Env = Record<string, string | undefined>;

function intVar(env: Env, name: string, def: number, min: number, max: number): number {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!/^-?\d+$/.test(v) || n < min || n > max) {
    throw new Error(`${name}: ${JSON.stringify(v)} must be an integer between ${min} and ${max}`);
  }
  return n;
}

const isLevel = (v: string): v is LogLevel => (LOG_LEVELS as readonly string[]).includes(v);

export function loadConfig(env: Env = process.env): Config {
  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!isLevel(logLevel)) {
    throw new Error(`LOG_LEVEL: ${JSON.stringify(env.LOG_LEVEL)} is not one of ${LOG_LEVELS.join(', ')}`);
  }
  return {
    port: intVar(env, 'PORT', 8000, 1, 65535),
    logLevel,
    drainDelayMs: intVar(env, 'DRAIN_DELAY_SECONDS', 5, 0, 300) * 1000,
    shutdownTimeoutMs: intVar(env, 'SHUTDOWN_TIMEOUT_SECONDS', 10, 1, 300) * 1000,
    maxLiveStreams: intVar(env, 'MAX_LIVE_STREAMS', 100, 0, 10000),
  };
}
