import { installFile, restoreFiles } from './install'
import { planRestore } from './restore-plan'
import { captureFile, sameFile } from './snapshot'
import { type CheckpointStorage } from './storage'
import type { Checkpoint, RestoreInput, RestoreJournal } from './types'

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
  const expectedState = input.direction === 'revert' ? 'applied' : 'reverted'
  if (checkpoint.publication.state !== expectedState) {
    throw new Error('Changes are already in the requested state')
  }

  const reverting = input.direction === 'revert'
  const { original, conflicts, issues } = await planRestore(
    storage,
    checkpoint,
    input,
  )
  if (conflicts.length) return { summary: checkpoint.publication, conflicts }

  const journal: RestoreJournal = {
    version: 1,
    checkpointId: checkpoint.id,
    operationId: input.operationId,
    roots: checkpoint.roots,
    original: [],
    committed: false,
  }

  await storage.save('journals', checkpoint.id, journal)

  try {
    const restored = await restoreFiles(storage, original, journal, issues)
    for (const file of checkpoint.files) {
      file.reverted = restored.has(file.target)
        ? reverting
        : (file.reverted ?? checkpoint.publication.state === 'reverted')
    }
    if (restored.size)
      checkpoint.publication.state = reverting ? 'reverted' : 'applied'
    checkpoint.publication.issues = [
      ...new Set([...checkpoint.publication.issues, ...issues]),
    ]
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
