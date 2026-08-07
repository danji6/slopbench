import {
  type InstallInfo,
  installBlockReason,
  resolveInstall,
} from '@sb/core/update/install'
import {
  type ReleaseInfo,
  fetchLatestRelease,
  parseChecksums,
  selectArchiveAsset,
  selectChecksumAsset,
} from '@sb/core/update/source'
import { isNewer } from '@sb/core/update/version'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { extractArchive } from './archive'
import { invalidateFrontendBuild } from './build-cache'
import { bunShortfall } from './bun-pin'
import type { RunnerConfig } from './config'
import { invalidateDependencies } from './deps'

/** Whether startup can continue or needs a restart. */
export type UpdateOutcome = 'continue' | 'relaunch'

/** Entries a swap must never touch. */
const PROTECTED_ENTRIES = new Set([
  '.data',
  '.env',
  '.env.local',
  '.git',
  'bin',
  'node_modules',
])

/** Convex state a rollback can't rebuild and therefore needs to be backed up. */
const STATE_FILES = ['convex.sqlite3', 'convex.sqlite3-wal', 'convex.sqlite3-shm'] // prettier-ignore

type UpdatePaths = {
  root: string
  backup: string
  /** Pre-update copy of {@link STATE_FILES}. */
  state: string
  /** Where a rollback moves the database it is about to replace. */
  replaced: string
  download: string
  staged: string
}

export async function readInstall(config: RunnerConfig): Promise<InstallInfo> {
  return await Promise.all([
    maybeRead(join(config.projectRoot, 'release.json')),
    maybeRead(join(config.projectRoot, 'package.json')),
  ]).then(([release, packageJson]) =>
    resolveInstall({
      hasGit: existsSync(join(config.projectRoot, '.git')),
      packageJson,
      release,
    }),
  )
}

/**
 * Installs a newer release before any service starts, so nothing holds the
 * tree open and the normal startup path redeploys and rebuilds afterwards.
 */
export async function applyUpdateIfRequested(
  config: RunnerConfig,
  options: { enabled: boolean },
): Promise<UpdateOutcome> {
  if (!options.enabled || config.mode !== 'start') return 'continue'

  const install = await readInstall(config)
  if (!install.updatable) {
    await reportBlockedUpdate(install)
    return 'continue'
  }

  const release = await fetchLatestRelease()
  if (!release || !isNewer(install.version, release.version)) return 'continue'

  if (!(await confirmUpdate(install, release))) return 'continue'

  try {
    await applyRelease(config, release)
    console.log(`Updated to v${release.version}.`)
    return reportRequiredBun(config, release.version) ? 'relaunch' : 'continue'
  } catch (error) {
    console.error(
      `Update to v${release.version} failed: ${message(error)}\n` +
        `Continuing on v${install.version}.`,
    )
    return 'continue'
  }
}

/** Reports whether a newer Bun is required to continue. */
function reportRequiredBun(config: RunnerConfig, version: string) {
  const shortfall = bunShortfall(config)
  if (!shortfall) return false

  console.log(
    `v${version} needs Bun ${shortfall.minimum}, and this launch is on ` +
      `${shortfall.running}. Start it again to finish updating.`,
  )
  return true
}

/** Restores the tree and database saved by the last successful update. */
export async function rollbackUpdate(config: RunnerConfig) {
  const paths = updatePaths(config)
  const state = await maybeRead(join(paths.root, 'backup.json'))
  if (!state || !existsSync(paths.backup)) {
    console.error('No update backup to roll back to.')
    return
  }

  const { version } = JSON.parse(state) as { version?: string }
  await restoreTree(config, paths)
  await restoreState(config, paths)
  await invalidateCaches(config)

  console.log(`Rolled back to v${version ?? 'previous'}.`)
  if (existsSync(paths.replaced)) {
    console.log(`The database it replaced is kept in ${paths.replaced}.`)
  }
}

async function applyRelease(config: RunnerConfig, release: ReleaseInfo) {
  const paths = updatePaths(config)
  const archive = await download(paths, release)

  await rm(paths.staged, { force: true, recursive: true })
  await mkdir(paths.staged, { recursive: true })
  await extractArchive(archive, paths.staged, config.projectRoot)

  const source = await stagedRoot(paths.staged)
  await verifyStagedTree(source, release)

  const install = await readInstall(config)
  await backupState(config, paths)
  await swapTree(config, paths, source)
  await writeFile(
    join(paths.root, 'backup.json'),
    `${JSON.stringify({ at: new Date().toISOString(), version: install.version }, null, 2)}\n`,
  )

  await invalidateCaches(config)
  await rm(paths.download, { force: true, recursive: true })
  await rm(paths.staged, { force: true, recursive: true })
}

async function download(paths: UpdatePaths, release: ReleaseInfo) {
  const asset = selectArchiveAsset(release)
  if (!asset) {
    throw new Error(`Release v${release.version} has no archive for this platform`) // prettier-ignore
  }

  await rm(paths.download, { force: true, recursive: true })
  await mkdir(paths.download, { recursive: true })

  console.log(`Downloading ${asset.name}...`)
  const archivePath = join(paths.download, asset.name)
  await writeFile(archivePath, await fetchBytes(asset.url))

  const checksums = selectChecksumAsset(release)
  if (checksums) {
    const expected = parseChecksums(
      new TextDecoder().decode(await fetchBytes(checksums.url)),
    ).get(asset.name)
    if (!expected) throw new Error(`No checksum published for ${asset.name}`)
    await verifyChecksum(archivePath, expected)
  }

  return archivePath
}

async function fetchBytes(url: string) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function verifyChecksum(path: string, expected: string) {
  const actual = createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${path}`)
  }
}

/** `git archive` writes a single prefixed directory; accept either shape. */
async function stagedRoot(staged: string) {
  if (existsSync(join(staged, 'package.json'))) return staged

  const entries = (await readdir(staged, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory(),
  )
  if (entries.length === 1) return join(staged, entries[0].name)

  throw new Error('Downloaded archive does not look like a source tree')
}

async function verifyStagedTree(source: string, release: ReleaseInfo) {
  const packageJson = await maybeRead(join(source, 'package.json'))
  if (!packageJson) throw new Error('Downloaded archive has no package.json')

  const staged = resolveInstall({
    hasGit: false,
    packageJson,
    release: await maybeRead(join(source, 'release.json')),
  })
  if (staged.version !== release.version) {
    throw new Error(
      `Archive reports v${staged.version}, expected v${release.version}`,
    )
  }
}

/** Swaps old files with the new release's, backing them up in the process. */
async function swapTree(
  config: RunnerConfig,
  paths: UpdatePaths,
  source: string,
) {
  const entries = (await readdir(source)).filter(
    (entry) => !PROTECTED_ENTRIES.has(entry),
  )

  await rm(paths.backup, { force: true, recursive: true })
  await mkdir(paths.backup, { recursive: true })

  const moved: string[] = []
  try {
    for (const entry of entries) {
      const current = join(config.projectRoot, entry)
      if (existsSync(current)) {
        await rename(current, join(paths.backup, entry))
        moved.push(entry)
      }
      await rename(join(source, entry), current)
    }
  } catch (error) {
    await undoMoves(config, paths, moved)
    throw error
  }
}

async function undoMoves(
  config: RunnerConfig,
  paths: UpdatePaths,
  moved: string[],
) {
  for (const entry of [...moved].reverse()) {
    const current = join(config.projectRoot, entry)
    await rm(current, { force: true, recursive: true })
    await rename(join(paths.backup, entry), current).catch(() => {})
  }
}

async function restoreTree(config: RunnerConfig, paths: UpdatePaths) {
  for (const entry of await readdir(paths.backup)) {
    if (PROTECTED_ENTRIES.has(entry)) continue

    const current = join(config.projectRoot, entry)
    await rm(current, { force: true, recursive: true })
    await rename(join(paths.backup, entry), current)
  }
}

/** Snapshots the database before the swap. */
async function backupState(config: RunnerConfig, paths: UpdatePaths) {
  await rm(paths.state, { force: true, recursive: true })
  await mkdir(paths.state, { recursive: true })
  await copyState(config.dataDir, paths.state)
}

/** Restores the snapshot, backing up the database it replaces. */
async function restoreState(config: RunnerConfig, paths: UpdatePaths) {
  if (!existsSync(paths.state)) return

  await rm(paths.replaced, { force: true, recursive: true })
  await mkdir(paths.replaced, { recursive: true })
  await copyState(config.dataDir, paths.replaced)

  await copyState(paths.state, config.dataDir)
}

async function copyState(from: string, to: string) {
  for (const file of STATE_FILES) {
    const source = join(from, file)
    if (existsSync(source)) await cp(source, join(to, file))
    else await rm(join(to, file), { force: true })
  }
}

/** Makes the normal startup path reinstall and rebuild for the new tree. */
async function invalidateCaches(config: RunnerConfig) {
  await invalidateDependencies(config)
  await invalidateFrontendBuild(config)
}

async function confirmUpdate(install: InstallInfo, release: ReleaseInfo) {
  const summary = `Update available: v${install.version} -> v${release.version}`
  const auto = process.env.AUTO_UPDATE

  if (auto === 'true') {
    console.log(`${summary}. Installing (AUTO_UPDATE=true).`)
    return true
  }
  if (!process.stdin.isTTY) {
    console.log(`${summary}. Run with a terminal attached to install it.`)
    return false
  }

  console.log(summary)
  if (release.url) console.log(release.url)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question('Install it now? [Y/n] ')
    return !/^n/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

async function reportBlockedUpdate(install: InstallInfo) {
  const release = await fetchLatestRelease()
  if (!release || !isNewer(install.version, release.version)) return

  const reason = installBlockReason(install.kind)
  console.log(
    `Update available: v${install.version} -> v${release.version}. ${reason ?? ''}`.trim(), // prettier-ignore
  )
}

function updatePaths(config: RunnerConfig): UpdatePaths {
  const root = join(config.dataDir, 'update')
  return {
    backup: join(root, 'backup'),
    download: join(root, 'download'),
    replaced: join(root, 'replaced'),
    root,
    staged: join(root, 'staged'),
    state: join(root, 'state'),
  }
}

async function maybeRead(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
