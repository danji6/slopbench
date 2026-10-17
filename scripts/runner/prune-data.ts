import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

const CONVEX_STATE = new Set([
  'storage',
  'convex.sqlite3',
  'convex.sqlite3-wal',
  'convex.sqlite3-shm',
  'convex.sqlite3-journal',
])

/** Rebuilds Convex state while retaining other application files and a full backup. */
export async function rebuildDataDirectory(
  dataDir: string,
  rebuild: () => Promise<void>,
) {
  const backup = nextBackupPath(dataDir)
  await rename(dataDir, backup)
  try {
    await mkdir(dataDir)
    for (const entry of await readdir(backup)) {
      if (CONVEX_STATE.has(entry)) continue
      await cp(join(backup, entry), join(dataDir, entry), {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        force: false,
        errorOnExist: true,
      })
    }
    await rebuild()
    return backup
  } catch (error) {
    await rm(dataDir, { recursive: true, force: true })
    await rename(backup, dataDir)
    throw error
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
