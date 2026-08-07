import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createFingerprint,
  invalidateCache,
  isCacheFresh,
  writeCacheState,
} from './cache'
import type { RunnerConfig } from './config'
import { type ProcessManager, bun } from './processes'

const cacheVersion = 1

export function dependencyCachePath(config: RunnerConfig) {
  return join(config.dataDir, 'runner/dependencies.json')
}

/** Forces a reinstall on the next start, e.g. after applying an update. */
export function invalidateDependencies(config: RunnerConfig) {
  return invalidateCache(dependencyCachePath(config))
}

/**
 * Installs dependencies, but only when the manifests actually changed. Gated on
 * a fingerprint of the lockfile and every workspace manifest.
 */
export async function ensureDependencies(
  manager: ProcessManager,
  config: RunnerConfig,
  options: { enabled: boolean },
) {
  if (!options.enabled) return

  const cachePath = dependencyCachePath(config)
  const fingerprint = await createDependencyFingerprint(config)

  if (
    existsSync(join(config.projectRoot, 'node_modules')) &&
    (await isCacheFresh(cachePath, fingerprint, cacheVersion))
  ) {
    return
  }

  console.log('Installing dependencies...')
  await install(manager, config)
  await writeCacheState(cachePath, fingerprint, cacheVersion)
}

async function install(manager: ProcessManager, config: RunnerConfig) {
  try {
    // `--frozen-lockfile` to prevent side effects
    await manager.run('bun-install', bun('install', '--frozen-lockfile'), {
      cwd: config.projectRoot,
    })
  } catch {
    console.log('Lockfile does not match the manifests; resolving...')
    await manager.run('bun-install', bun('install'), {
      cwd: config.projectRoot,
    })
  }
}

async function createDependencyFingerprint(config: RunnerConfig) {
  return await manifestFiles(config.projectRoot).then((files) =>
    createFingerprint(
      config.projectRoot,
      { directories: ['patches'], files },
      cacheVersion,
    ),
  )
}

async function manifestFiles(root: string) {
  const files = ['bun.lock', 'package.json', 'bunfig.toml']
  const packagesDir = join(root, 'packages')
  if (!existsSync(packagesDir)) return files

  const entries = await readdir(packagesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(join('packages', entry.name, 'package.json'))
    }
  }

  return files
}
