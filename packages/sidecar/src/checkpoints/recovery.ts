import { recoverJournal } from './restore'
import type { CheckpointStorage } from './storage'
import type {
  CaptureGroup,
  CaptureWaiter,
  Checkpoint,
  RestoreJournal,
} from './types'

/** Reconciles persisted transitions before new filesystem writers can start. */
export async function recoverCaptures(storage: CheckpointStorage) {
  const waiters = (await storage.records<CaptureWaiter>('waiters')).sort(
    (a, b) => a.createdAt - b.createdAt,
  )

  for (const journal of await storage.records<RestoreJournal>('journals')) {
    try {
      await recoverJournal(storage, journal)
    } catch {
      /* Retained journals fence their roots. */
    }
  }

  const groups = new Map<string, CaptureGroup>()
  for (const group of await storage.records<CaptureGroup>('groups')) {
    if (group.version !== 1)
      throw new Error('Unsupported checkpoint group version')
    if (group.released) continue
    await recoverSealedBaseline(storage, group)
    group.interrupted = true
    group.issues.push(
      'Sidecar restarted during capture; changes may be incomplete.',
    )
    groups.set(group.id, group)
    await storage.save('groups', group.id, group)
  }

  return { groups, waiters }
}

async function recoverSealedBaseline(
  storage: CheckpointStorage,
  group: CaptureGroup,
) {
  if (!group.pendingCheckpoint) return
  const checkpoint = await storage.read<Checkpoint>(
    'checkpoints',
    group.pendingCheckpoint,
  )
  if (checkpoint) {
    for (const file of checkpoint.files) {
      if (file.after) group.baseline[file.target] = file.after
      else delete group.baseline[file.target]
    }
  }
  group.pendingCheckpoint = undefined
}
