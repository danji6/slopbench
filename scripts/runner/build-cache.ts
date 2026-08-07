import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  createFingerprint,
  invalidateCache,
  isCacheFresh,
  writeCacheState,
} from './cache'
import type { RunnerConfig } from './config'
import type { ProcessManager } from './processes'

const cacheVersion = 1

const inputFiles = [
  'bun.lock',
  'convex.json',
  'package.json',
  'tsconfig.json',
  'packages/client/index.html',
  'packages/client/package.json',
  'packages/client/tsconfig.json',
  'packages/client/vite.config.ts',
  'packages/convex/package.json',
  'packages/core/package.json',
  'packages/core/tsconfig.json',
]

const inputDirectories = [
  'packages/client/public',
  'packages/client/src',
  'packages/convex/src',
  'packages/core/src',
]

const ignoredDirectoryNames = new Set([
  '.git',
  '_deps',
  'dist',
  'node_modules',
  'tmp',
])

const includedExtensions = new Set([
  '.css',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.ts',
  '.tsx',
  '.wasm',
])

export function frontendCachePath(config: RunnerConfig) {
  return join(config.dataDir, 'runner/frontend-build.json')
}

/** Forces a rebuild on the next start, e.g. after applying an update. */
export function invalidateFrontendBuild(config: RunnerConfig) {
  return invalidateCache(frontendCachePath(config))
}

export async function buildFrontendIfNeeded(
  manager: ProcessManager,
  config: RunnerConfig,
  options: { force: boolean },
) {
  const cachePath = frontendCachePath(config)
  const fingerprint = await createFrontendFingerprint(config)
  const distIndexPath = join(config.frontendDist, 'index.html')

  if (
    !options.force &&
    existsSync(distIndexPath) &&
    (await isCacheFresh(cachePath, fingerprint, cacheVersion))
  ) {
    console.log('Frontend build unchanged; reusing existing client dist/.')
    return
  }

  await manager.run('frontend-build', ['bun', 'run', 'build'], {
    cwd: config.clientRoot,
  })
  await writeCacheState(cachePath, fingerprint, cacheVersion)
}

function createFrontendFingerprint(config: RunnerConfig) {
  return createFingerprint(
    config.projectRoot,
    {
      directories: inputDirectories,
      extra: frontendEnvironment(),
      files: inputFiles,
      ignoredDirectoryNames,
      includedExtensions,
    },
    cacheVersion,
  )
}

function frontendEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([key]) => key === 'NODE_ENV' || key.startsWith('VITE_'))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}
