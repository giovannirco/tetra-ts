// What build is running, and where. VERSION, COMMIT and BUILD_DATE are
// baked into the image as environment variables at build time.

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { Env } from './config.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export interface VersionInfo {
  service: 'tetra';
  implementation: 'typescript';
  version: string;
  commit: string;
  build_date: string;
  runtime: string;
  hostname: string;
  started_at: string;
}

export function versionInfo(env: Env = process.env, startedAt = new Date()): VersionInfo {
  return {
    service: 'tetra',
    implementation: 'typescript',
    version: env.VERSION || `v${pkg.version}`,
    commit: env.COMMIT || 'unknown',
    build_date: env.BUILD_DATE || '',
    runtime: `node${process.versions.node}`,
    hostname: hostname(),
    started_at: startedAt.toISOString(),
  };
}
