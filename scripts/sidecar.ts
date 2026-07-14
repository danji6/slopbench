import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  dataDir,
  defaultNodeBinary,
  projectRoot,
  sidecarDataDir,
} from './runner/config'

const OUT_DIR = resolve(dataDir, 'build/sidecar')
const SIDECAR_ENTRY = resolve(projectRoot, 'packages/sidecar/src/main.ts')

/** Bundles the sidecar to plain JS so it can run under Node. */
export async function buildSidecar(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [SIDECAR_ENTRY],
    external: [
      '@hono/node-server',
      '@modelcontextprotocol/sdk',
      '@mozilla/readability',
      'hono',
      'linkedom',
      'node-pty',
      'png-chunks-encode',
      'png-chunks-extract',
      'sharp',
      'tinyglobby',
      'turndown',
      'zod',
    ],
    format: 'esm',
    outdir: OUT_DIR,
    sourcemap: 'linked',
    target: 'node',
  })
  if (!result.success) {
    throw new AggregateError(result.logs, 'Sidecar build failed')
  }
  return join(OUT_DIR, 'main.js')
}

/** The embedded Node downloaded by the runner, or the system one. */
export function resolveNodeBinary(): string {
  if (process.env.NODE_BINARY) return process.env.NODE_BINARY
  const embedded = defaultNodeBinary(resolve(projectRoot, 'bin'))
  return existsSync(embedded) ? embedded : 'node'
}

if (import.meta.main) {
  const entry = await buildSidecar()
  const child = Bun.spawn({
    cmd: [resolveNodeBinary(), entry],
    cwd: projectRoot,
    env: { ...process.env, CHAT_SIDECAR_DATA_DIR: sidecarDataDir },
    stderr: 'inherit',
    stdin: 'ignore',
    stdout: 'inherit',
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal))
  }
  process.exit(await child.exited)
}
