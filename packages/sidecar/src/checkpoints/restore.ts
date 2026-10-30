import { assertPersonalScope } from '@sb/core/workspace/personal'
import { selectFileWorkspace } from '@sb/core/workspace/personal'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import { assertPlainPath } from '../agent-files/storage'
import {
  assertCheckpointTarget,
  isOutside,
  resolveToolPath,
} from '../mcp/workspace/access'
import { requireWorkspace } from '../mcp/workspace/resolve-workspace'
import { captureFile, sameFile } from './snapshot'
import { type CheckpointStorage } from './storage'
import type {
  Checkpoint,
  FileState,
  RestoreInput,
  RestoreJournal,
} from './types'

/** Validates every target before the first write and journals rollback bytes. */
export async function restore(
  storage: CheckpointStorage,
  checkpoint: Checkpoint,
  input: RestoreInput,
) {
  const previous = checkpoint.operation

  if (previous?.id === input.operationId) {
    if (previous.direction !== input.direction)
      throw new Error('Operation identity changed')
    return { summary: checkpoint.publication, conflicts: [] }
  }
  if (checkpoint.publication.revision !== input.revision) {
    throw new Error('Changes state changed; refresh and try again')
  }
  if (checkpoint.publication.issues.length) {
    throw new Error('Checkpoint capture is incomplete')
  }
  const expectedState = input.direction === 'revert' ? 'applied' : 'reverted'
  if (checkpoint.publication.state !== expectedState) {
    throw new Error('Changes are already in the requested state')
  }

  await authorizeTargets(checkpoint, input)

  const conflicts = await conflictPaths(storage, checkpoint, input)
  if (conflicts.length) return { summary: checkpoint.publication, conflicts }

  const reverting = input.direction === 'revert'
  const original = checkpoint.files.map((file) => ({
    ...file,
    before: reverting ? file.after : file.before,
    after: reverting ? file.before : file.after,
  }))
  const journal: RestoreJournal = {
    version: 1,
    checkpointId: checkpoint.id,
    operationId: input.operationId,
    roots: checkpoint.roots,
    original,
    committed: false,
  }

  await storage.save('journals', checkpoint.id, journal)

  try {
    for (const file of original) {
      const current = await captureFile(storage, file.target)
      if (!sameFile(current, file.before))
        throw new Error(`File changed during restore: ${file.path}`)
      await installFile(storage, file.target, file.after)
    }
    checkpoint.publication.state = reverting ? 'reverted' : 'applied'
    checkpoint.publication.revision++
    checkpoint.operation = { id: input.operationId, direction: input.direction }
    await storage.save('checkpoints', checkpoint.id, checkpoint)
  } catch (error) {
    await recoverJournal(storage, journal)
    throw error
  }
  journal.committed = true
  await storage.save('journals', checkpoint.id, journal)
  await storage.remove('journals', checkpoint.id)
  return { summary: checkpoint.publication, conflicts: [] }
}

async function authorizeTargets(checkpoint: Checkpoint, input: RestoreInput) {
  for (const file of checkpoint.files) {
    const personal = input.workspaces?.find(
      (workspace) =>
        workspace.agentHome &&
        !isOutside(workspace.agentHome.path, file.target),
    )
    const source = personal ?? input.workspace
    const selected = selectFileWorkspace(
      source,
      personal
        ? `agent://${path.relative(personal.agentHome!.path, file.target)}`
        : file.target,
    )
    const workspace = await requireWorkspace(
      input.sessionId,
      selected.workspaceId,
      selected,
    )
    assertPersonalScope(selected, file.target)
    await assertCheckpointTarget(
      workspace.root,
      file.target,
      isOutside(workspace.root, file.target),
    )
    await resolveToolPath(
      workspace.root,
      file.target,
      input.allowedPaths,
      workspace.roots,
      workspace.grantRoot,
    )
  }
}

async function conflictPaths(
  storage: CheckpointStorage,
  checkpoint: Checkpoint,
  input: RestoreInput,
) {
  const conflicts: string[] = []
  for (const file of checkpoint.files) {
    const expected = input.direction === 'revert' ? file.after : file.before
    try {
      const current = await captureFile(storage, file.target)
      if (!sameFile(current, expected)) conflicts.push(file.path)
      if (file.before) await storage.bytes(file.before.hash)
      if (file.after) await storage.bytes(file.after.hash)
    } catch {
      conflicts.push(file.path)
    }
  }
  return [...new Set(conflicts)]
}

/** Restores an interrupted transaction without overwriting an unexpected external edit. */
export async function recoverJournal(
  storage: CheckpointStorage,
  journal: RestoreJournal,
) {
  const checkpoint = await storage.read<Checkpoint>(
    'checkpoints',
    journal.checkpointId,
  )
  if (journal.committed || checkpoint?.operation?.id === journal.operationId) {
    await storage.remove('journals', journal.checkpointId)
    return
  }
  const failures: string[] = []
  for (const file of [...journal.original].reverse()) {
    try {
      const current = await captureFile(storage, file.target)
      if (sameFile(current, file.before)) continue
      if (!sameFile(current, file.after))
        throw new Error(`Recovery conflict: ${file.path}`)
      await installFile(storage, file.target, file.before)
    } catch (error) {
      failures.push(String(error))
    }
  }
  if (failures.length) {
    journal.blocked = failures.join('; ')
    await storage.save('journals', journal.checkpointId, journal)
    throw new Error(`Checkpoint recovery needs attention: ${journal.blocked}`)
  }
  await storage.remove('journals', journal.checkpointId)
}

async function installFile(
  storage: CheckpointStorage,
  target: string,
  state?: FileState,
) {
  await assertPlainPath(target)

  if (!state) {
    await rm(target, { force: true })
    return
  }

  const bytes = await storage.bytes(state.hash)
  await mkdir(path.dirname(target), { recursive: true })
  await assertPlainPath(target)
  const temporary = `${target}.checkpoint-${randomUUID()}.tmp`
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    state.mode,
  )

  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await chmod(temporary, state.mode)
    await assertPlainPath(target)
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
