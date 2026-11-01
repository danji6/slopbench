import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

import { assertPlainPath } from '../agent-files/storage'
import { isFilePermissionError } from './errors'
import { captureFile, sameFile } from './snapshot'
import type { CheckpointStorage } from './storage'
import type { CheckpointFile, FileState, RestoreJournal } from './types'

/** Replaces an entry atomically without following a symlink at the destination. */
export async function installFile(
  storage: CheckpointStorage,
  target: string,
  state?: FileState,
) {
  await assertPlainPath(path.dirname(target))

  if (!state) {
    await rm(target, { force: true })
    return
  }

  const bytes = await storage.bytes(state.hash)
  await mkdir(path.dirname(target), { recursive: true })
  await assertPlainPath(path.dirname(target))
  const temporary = `${target}.checkpoint-${randomUUID()}.tmp`
  try {
    await writeTemporary(temporary, bytes, state)
    await assertPlainPath(path.dirname(target))
    await rename(temporary, target)
    const directory = await open(path.dirname(target), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

async function writeTemporary(target: string, bytes: Buffer, state: FileState) {
  if (state.symlink) {
    await symlink(bytes.toString(), target)
    return
  }
  const file = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    state.mode,
  )
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
  await chmod(target, state.mode)
}

/** Applies independent file writes and returns only the entries that succeeded. */
export async function restoreFiles(
  storage: CheckpointStorage,
  files: CheckpointFile[],
  journal: RestoreJournal,
  issues: string[],
) {
  const restored = new Set<string>()
  for (const file of files) {
    try {
      const current = await captureFile(storage, file.target)
      if (!sameFile(current, file.before))
        throw new Error(`File changed during restore: ${file.path}`)
    } catch (error) {
      if (!isFilePermissionError(error)) throw error
      issues.push(`${file.path}: ${String(error)}`)
      continue
    }
    journal.original.push(file)
    await storage.save('journals', journal.checkpointId, journal)
    try {
      await installFile(storage, file.target, file.after)
      restored.add(file.target)
    } catch (error) {
      if (!isFilePermissionError(error)) throw error
      // A failed install may have completed its rename before directory sync.
      const current = await captureFile(storage, file.target)
      if (!sameFile(current, file.before)) throw error
      journal.original.pop()
      await storage.save('journals', journal.checkpointId, journal)
      issues.push(`${file.path}: ${String(error)}`)
    }
  }
  return restored
}
