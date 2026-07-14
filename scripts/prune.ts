import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { ensureConvexBinaries } from './runner/binaries'
import {
  type RunnerConfig,
  defaultEnvFile,
  getConfig,
  projectRoot,
} from './runner/config'
import { deriveAdminKey } from './runner/convex'
import { loadEnvFile } from './runner/env-file'
import { output } from './runner/processes'

// This script prunes Convex's old data accumulated after every push. The flow:
// - Export a snapshot from the current `.data` folder
// - Rename `.data` to `.data.bak(-1,2..)`
// - In a fresh `.data`, deploy functions once (a single current module set)
// - Import the snapshot

const READY_TIMEOUT_MS = 60_000
const DOWN_TIMEOUT_MS = 30_000

export async function pruneDeployment(args: string[]) {
  const skipConfirm = args.includes('--yes') || args.includes('-y')

  await loadEnvFile(defaultEnvFile)
  const config = getConfig('dev')
  process.env.RUST_LOG = 'error'
  await ensureConvexBinaries(config)

  if (!existsSync(config.dataDir)) {
    throw new Error(`No data directory at ${rel(config.dataDir)}; nothing to compact.`) // prettier-ignore
  }
  if (!config.instanceSecret) {
    throw new Error(
      'INSTANCE_SECRET is missing from the environment/.env.local.',
    )
  }
  if (await isBackendUp(config.convexSelfHostedUrl)) {
    throw new Error(
      `A Convex backend is already running at ${config.convexSelfHostedUrl}. Stop the app before pruning.`,
    )
  }

  const adminKey = config.convexSelfHostedAdminKey ?? (await deriveAdminKey(config, config.instanceSecret)) // prettier-ignore
  const before = await dirSize(join(config.dataDir, 'storage'))
  const beforeModules = await dirSize(
    join(config.dataDir, 'storage', 'modules'),
  )

  console.log(
    `Storage before: ${formatBytes(before)} total, ${formatBytes(beforeModules)} in modules.`,
  )
  if (!(await confirm(skipConfirm))) {
    console.log('Aborted.')
    return
  }

  const tmp = await mkdtemp(join(tmpdir(), 'chat-prune-'))
  const snapshot = join(tmp, 'snapshot.zip')
  try {
    await exportSnapshot(config, adminKey, snapshot)
    await rebuildFromSnapshot(config, adminKey, snapshot)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }

  const after = await dirSize(join(config.dataDir, 'storage'))
  console.log(
    `\nDone. Storage: ${formatBytes(before)} -> ${formatBytes(after)} ` +
      `(reclaimed ${formatBytes(before - after)}).`,
  )
}

async function exportSnapshot(
  config: RunnerConfig,
  adminKey: string,
  snapshot: string,
) {
  console.log('\nExporting snapshot...')
  await withBackend(config, async () => {
    await runConvex(config, adminKey, [
      'export',
      '--include-file-storage',
      '--path',
      snapshot,
    ])
  })
}

async function rebuildFromSnapshot(
  config: RunnerConfig,
  adminKey: string,
  snapshot: string,
) {
  const backup = nextBackupPath(config.dataDir)
  await rename(config.dataDir, backup)
  console.log(`\nBacked up ${rel(config.dataDir)} -> ${rel(backup)}`)

  try {
    await withBackend(config, async () => {
      // Deploy first to avoid table number collisions
      console.log('Deploying functions to install schema and components...')
      await runConvex(config, adminKey, ['deploy', '--typecheck', 'disable'])
      console.log('Importing snapshot...')
      await runConvex(config, adminKey, ['import', '--replace-all', '--yes', snapshot]) // prettier-ignore
    })
  } catch (error) {
    console.error('\nRebuild failed, restoring the backup...')
    await rm(config.dataDir, { recursive: true, force: true })
    await rename(backup, config.dataDir)
    console.error(`Restored ${rel(config.dataDir)} from ${rel(backup)}.`)
    throw error
  }
}

async function withBackend(config: RunnerConfig, fn: () => Promise<void>) {
  await mkdir(join(config.dataDir, 'storage'), { recursive: true })
  const backend = Bun.spawn({
    cmd: [
      config.convexBinary,
      '--instance-name',
      config.convexInstanceName,
      '--instance-secret',
      config.instanceSecret!,
      '--local-storage',
      join(config.dataDir, 'storage'),
      join(config.dataDir, 'convex.sqlite3'),
    ],
    cwd: config.projectRoot,
    env: {
      ...process.env,
      DOCUMENT_RETENTION_DELAY: config.convexDocumentRetentionDelay,
    },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  try {
    await waitForBackend(config.convexSelfHostedUrl, true, READY_TIMEOUT_MS)
    await fn()
  } finally {
    backend.kill()
    await backend.exited
    // Wait for the sqlite lock to release before the caller touches `.data`
    await waitForBackend(config.convexSelfHostedUrl, false, DOWN_TIMEOUT_MS)
  }
}

async function runConvex(
  config: RunnerConfig,
  adminKey: string,
  convexArgs: string[],
) {
  const proc = Bun.spawn({
    cmd: [
      'bunx',
      'convex',
      ...convexArgs,
      '--url',
      config.convexSelfHostedUrl,
      '--admin-key',
      adminKey,
    ],
    cwd: config.convexRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`convex ${convexArgs[0]} exited with code ${code}`)
  }
}

function nextBackupPath(dataDir: string) {
  const base = `${dataDir}.bak`
  if (!existsSync(base)) return base
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}`
    if (!existsSync(candidate)) return candidate
  }
}

async function isBackendUp(url: string) {
  try {
    return (await fetch(`${url}/version`)).ok
  } catch {
    return false
  }
}

async function waitForBackend(url: string, wantUp: boolean, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if ((await isBackendUp(url)) === wantUp) return
    await Bun.sleep(500)
  }
  throw new Error(
    `Timed out waiting for backend at ${url} to be ${wantUp ? 'ready' : 'stopped'}.`, // prettier-ignore
  )
}

async function confirm(skip: boolean) {
  if (skip) return true
  if (!process.stdin.isTTY) {
    throw new Error('Refusing to run non-interactively without --yes.')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question('Proceed with prune? [y/N] ')
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
    // readline keeps stdin referenced. Unref so it can't hold the loop open.
    process.stdin.unref()
  }
}

async function dirSize(path: string) {
  if (!existsSync(path)) return 0
  const out = await output(['du', '-sb', path], { cwd: projectRoot })
  return Number(out.split(/\s/)[0]) || 0
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const sign = bytes < 0 ? '-' : ''
  return `${sign}${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function rel(path: string) {
  return relative(projectRoot, path) || path
}

try {
  await pruneDeployment(process.argv.slice(2))
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
