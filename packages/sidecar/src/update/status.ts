import {
  type InstallInfo,
  installBlockReason,
  resolveInstall,
} from '@sb/core/update/install'
import { fetchLatestRelease } from '@sb/core/update/source'
import { isNewer } from '@sb/core/update/version'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export type UpdateStatus = {
  current: string
  latest?: string
  notes?: string
  publishedAt?: string
  url?: string
  /** Whether a newer release exists for this install. */
  available: boolean
  reason?: string
}

/** Walks up from the bundle until a workspace root shows up. */
function findProjectRoot(): string {
  let dir = resolve(process.cwd())

  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(dir, 'convex.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return resolve(process.cwd())
}

export async function readInstall(
  root = findProjectRoot(),
): Promise<InstallInfo> {
  const [release, packageJson] = await Promise.all([
    readMaybe(join(root, 'release.json')),
    readMaybe(join(root, 'package.json')),
  ])

  return resolveInstall({
    hasGit: existsSync(join(root, '.git')),
    packageJson,
    release,
  })
}

export async function updateStatus(): Promise<UpdateStatus> {
  const install = await readInstall()
  const release = await fetchLatestRelease()

  if (!release) {
    return {
      available: false,
      current: install.version,
      reason: 'Could not reach the release feed.',
    }
  }

  const newer = isNewer(install.version, release.version)
  return {
    available: newer && install.updatable,
    current: install.version,
    latest: release.version,
    notes: release.notes,
    publishedAt: release.publishedAt,
    reason: newer ? installBlockReason(install.kind) : undefined,
    url: release.url,
  }
}

async function readMaybe(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
