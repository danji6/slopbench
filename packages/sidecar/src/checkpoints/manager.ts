import type { ChangePublication } from '@sb/core/types/changes'
import type { FolderWorkspace } from '@sb/core/types/workspace'
import {
  assertPersonalScope,
  selectFileWorkspace,
} from '@sb/core/workspace/personal'

import { isOutside } from '../mcp/workspace/access'
import { requireWorkspace } from '../mcp/workspace/resolve-workspace'
import { changedFiles, publication } from './diff'
import {
  captureRoots,
  collectBlobs,
  createGroup,
  displayFile,
  enrollParticipant,
  overlaps,
} from './group'
import { hasCaptureJobs } from './jobs'
import { recoverCaptures } from './recovery'
import { recoverJournal, restore } from './restore'
import { captureFile, snapshot } from './snapshot'
import { CheckpointStorage } from './storage'
import type {
  BeginCapture,
  CaptureGroup,
  CaptureWaiter,
  Checkpoint,
  FinishCapture,
  RestoreInput,
  RestoreJournal,
} from './types'

/** Coordinates capture groups and restoration across canonical workspace roots. */
export class CheckpointManager {
  private groups = new Map<string, CaptureGroup>()
  private waiters: CaptureWaiter[] = []
  private initialized?: Promise<void>
  private queue = Promise.resolve()

  constructor(readonly storage = new CheckpointStorage()) {}

  serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.initialized ??= this.initialize()
      await this.initialized
      return operation()
    })
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  begin(input: BeginCapture) {
    return this.serial(async () => {
      const requestedRoots = await captureRoots(input)
      const existing = this.groups.get(input.groupId)
      const inheritedJobsRunning =
        existing?.interrupted && (await hasCaptureJobs(existing))
      if (inheritedJobsRunning) return { queued: true }
      const roots = [...new Set([...(existing?.roots ?? []), ...requestedRoots])] // prettier-ignore
      const turn = this.waiters.findIndex((waiter) => waiter.id === input.groupId) // prettier-ignore
      const earlier = this.waiters
        .slice(0, turn < 0 ? undefined : turn)
        .some((waiter) => overlaps(waiter.roots, roots))
      const busy = await this.blocked(roots, input.groupId)

      if (busy || (!existing && earlier)) {
        if (existing)
          throw new Error(
            'Cannot extend a capture reservation into another active workspace',
          )
        if (turn < 0) {
          const waiter = {
            id: input.groupId,
            roots,
            createdAt: Date.now(),
            sessionId: input.sessionId,
          }
          this.waiters.push(waiter)
          await this.storage.save('waiters', waiter.id, waiter)
        }
        return { queued: true }
      }

      this.waiters = this.waiters.filter((waiter) => waiter.id !== input.groupId) // prettier-ignore
      await this.storage.remove('waiters', input.groupId)

      const group = existing ?? createGroup(input, roots)
      if (group.released) throw new Error('Capture group has already ended')

      const addedRoots = roots.filter((root) => !group.roots.includes(root))

      if (!existing || addedRoots.length) {
        const captured = await snapshot(
          this.storage,
          existing ? addedRoots : roots,
        )
        Object.assign(group.baseline, captured.files)
        group.issues.push(...captured.issues)
        group.excluded.push(...captured.excluded)
      }
      group.roots = roots
      enrollParticipant(group, input)
      if (group.interrupted) {
        group.interrupted = false
        group.shellPids = []
      }
      this.groups.set(group.id, group)
      await this.saveGroup(group)
      return { queued: false }
    })
  }

  /** Holds capture transitions against native writes and shell dispatch. */
  write<T>(
    sessionId: string,
    workspace: FolderWorkspace | undefined,
    fn: () => Promise<T>,
  ) {
    return this.serial(async () => {
      const group = this.forSession(sessionId)
      if (workspace) {
        const selected = workspace.agentOnly
          ? selectFileWorkspace(workspace, 'agent://')
          : workspace
        const resolved = await requireWorkspace(
          sessionId,
          selected.workspaceId,
          selected,
        )
        if (await this.blocked(resolved.roots, group?.id))
          throw new Error('Workspace is reserved by another agent turn')
      }
      if (group?.interrupted)
        throw new Error(
          'Workspace capture was interrupted; wait for reconciliation',
        )
      return fn()
    })
  }

  /** Captures an explicit target before its first write, including ignored files. */
  async trackFile(
    sessionId: string,
    target: string,
    workspace?: FolderWorkspace,
  ) {
    if (!isOutside(this.storage.root, target)) {
      throw new Error('Cannot edit the checkpoint store')
    }

    const group = this.forSession(sessionId)
    if (await this.blocked([target], group?.id)) {
      throw new Error('File is reserved by another agent turn')
    }
    if (!group || group.explicit.includes(target)) {
      return
    }

    assertPersonalScope(workspace, target)

    if (!group.roots.some((root) => !isOutside(root, target)))
      group.roots.push(target)
    const previouslyExcluded = group.excluded.some(
      (entry) => !isOutside(entry, target),
    )

    const previouslyCovered = group.participants.some((participant) => {
      const roots =
        participant.workspace.sources?.map((source) => source.path) ?? []
      if (participant.workspace.agentHome)
        roots.push(participant.workspace.agentHome.path)
      return roots.some((root) => !isOutside(root, target))
    })

    if (!previouslyCovered || previouslyExcluded) {
      const state = await captureFile(this.storage, target)
      if (!group.baseline[target] && state) group.baseline[target] = state
    }

    group.explicit.push(target)
    await this.saveGroup(group)
  }

  finish(input: FinishCapture) {
    return this.serial(async () => {
      const saved = await this.storage.read<Checkpoint>(
        'checkpoints',
        input.checkpointId,
      )
      if (saved) {
        const group = this.groups.get(input.groupId)
        if (group) {
          await this.tryRelease(group)
          await this.saveGroup(group)
        }
        return {
          publication: saved.publication,
          released: group?.released ?? true,
        }
      }

      const group = this.groups.get(input.groupId)
      if (!group) {
        this.waiters = this.waiters.filter(
          (waiter) => waiter.id !== input.groupId,
        )
        await this.storage.remove('waiters', input.groupId)
        return { released: true }
      }
      if (group.released) return { released: true }

      for (const id of input.pendingParticipants ?? []) {
        if (!group.participants.some((item) => item.id === id)) {
          const first = group.participants[0]!
          group.participants.push({ ...first, id, finished: false })
        }
      }

      const participant = group.participants.find(
        (item) => item.id === input.participantId,
      )
      if (participant?.completedCheckpoint === input.checkpointId)
        return { released: group.released }
      if (participant) participant.finished = true

      let result: ChangePublication | undefined
      const shouldSeal = input.root || group.sealed
      if (input.root) group.sealed = true
      if (shouldSeal) result = await this.seal(group, input.checkpointId)
      if (participant) participant.completedCheckpoint = input.checkpointId

      const released = await this.tryRelease(group)
      await this.saveGroup(group)

      return { publication: result, released }
    })
  }

  async read(checkpointId: string) {
    return this.serial(() =>
      this.storage.read<Checkpoint>('checkpoints', checkpointId),
    )
  }

  restore(input: RestoreInput) {
    return this.serial(async () => {
      const checkpoint = await this.storage.read<Checkpoint>(
        'checkpoints',
        input.checkpointId,
      )
      if (!checkpoint || checkpoint.sessionId !== input.sessionId)
        throw new Error('Checkpoint not found')

      const journal = await this.storage.read<RestoreJournal>(
        'journals',
        checkpoint.id,
      )
      if (journal) await recoverJournal(this.storage, journal)
      if (await this.blocked(checkpoint.roots)) {
        throw new Error(
          'Wait for workspace writers to finish before restoring changes',
        )
      }
      return restore(this.storage, checkpoint, input)
    })
  }

  /** Checks lingering jobs after their turn has ended and seals only their new delta. */
  settle(groupId: string, checkpointId: string) {
    return this.serial(async () => {
      const saved = await this.storage.read<Checkpoint>(
        'checkpoints',
        checkpointId,
      )
      if (saved) {
        const group = this.groups.get(groupId)
        if (group) {
          await this.tryRelease(group)
          await this.saveGroup(group)
        }
        return {
          publication: saved.publication,
          released: group?.released ?? true,
        }
      }

      const group = this.groups.get(groupId)
      if (!group || group.released) return { released: true }
      const pending = group.participants.some((participant) => !participant.finished) // prettier-ignore
      if (pending || (await hasCaptureJobs(group))) return { released: false }

      const result = group.sealed
        ? await this.seal(group, checkpointId)
        : undefined

      const released = await this.tryRelease(group)
      await this.saveGroup(group)

      return { publication: result, released }
    })
  }

  async removeSession(sessionId: string) {
    return this.serial(async () => {
      const cancelled = this.waiters.filter(
        (waiter) => waiter.sessionId === sessionId,
      )
      for (const waiter of cancelled) {
        await this.storage.remove('waiters', waiter.id)
      }
      this.waiters = this.waiters.filter(
        (waiter) => waiter.sessionId !== sessionId,
      )

      for (const group of this.groups.values()) {
        if (group.sessionId !== sessionId) continue
        if (await hasCaptureJobs(group))
          throw new Error('Waiting for background jobs to stop')
        group.released = true
        await this.storage.remove('groups', group.id)
        this.groups.delete(group.id)
      }

      for (const group of await this.storage.records<CaptureGroup>('groups')) {
        if (group.sessionId === sessionId)
          await this.storage.remove('groups', group.id)
      }

      const checkpoints = this.storage.records<Checkpoint>('checkpoints')
      for (const item of await checkpoints) {
        if (item.sessionId === sessionId)
          await this.storage.remove('checkpoints', item.id)
      }

      await collectBlobs(this.storage, this.groups.values())
    })
  }

  async assertAvailable(sessionId: string, roots: string[]) {
    if (await this.blocked(roots, this.forSession(sessionId)?.id))
      throw new Error('Workspace is reserved by another agent turn')
  }

  async trackJob(sessionId: string, pid: number | undefined) {
    const group = this.forSession(sessionId)
    if (!group || !pid) return
    group.shellPids = [...new Set([...(group.shellPids ?? []), pid])]
    await this.saveGroup(group)
  }

  finishJob(sessionId: string, pid: number | undefined) {
    return this.serial(async () => {
      for (const group of this.groups.values()) {
        const ownsJob = group.participants.some(
          (item) => item.sessionId === sessionId,
        )
        if (!ownsJob || !pid || !group.shellPids?.includes(pid)) continue
        group.shellPids = group.shellPids.filter((item) => item !== pid)
        await this.saveGroup(group)
      }
    })
  }

  homeReserved(homeId: string) {
    return this.serial(async () =>
      [...this.groups.values()].some(
        (group) =>
          !group.released &&
          group.participants.some((item) => {
            const home = item.workspace.agentHome
            return (home?.homeId ?? home?.agentId) === homeId
          }),
      ),
    )
  }

  reserved(sessionId: string) {
    return this.serial(async () =>
      [...this.groups.values()].some(
        (group) =>
          !group.released &&
          group.participants.some((item) => item.sessionId === sessionId),
      ),
    )
  }

  private forSession(sessionId: string) {
    return [...this.groups.values()].find(
      (group) =>
        !group.released &&
        group.participants.some(
          (item) => item.sessionId === sessionId && !item.finished,
        ),
    )
  }

  private async initialize() {
    const recovered = await recoverCaptures(this.storage)
    this.waiters = recovered.waiters
    this.groups = recovered.groups
  }

  private async blocked(roots: string[], except?: string) {
    const { hasRunningWorkspaceJobs } = await import('../shell/registry')

    const ownerSessions = except
      ? (this.groups.get(except)?.participants.map((item) => item.sessionId) ?? []) // prettier-ignore
      : []
    if (hasRunningWorkspaceJobs(roots, ownerSessions)) return true

    const busy = [...this.groups.values()].some(
      (group) =>
        !group.released && group.id !== except && overlaps(group.roots, roots),
    )
    if (busy) return true

    return (await this.storage.records<RestoreJournal>('journals')).some(
      (journal) => overlaps(journal.roots, roots),
    )
  }

  private async seal(group: CaptureGroup, id: string) {
    group.pendingCheckpoint = id
    await this.saveGroup(group)
    const directoryRoots = group.roots.filter(
      (root) => !group.explicit.includes(root),
    )
    const captured = await snapshot(this.storage, directoryRoots, [
      ...group.explicit,
      ...Object.keys(group.baseline),
    ])
    for (const target of captured.unavailable) {
      if (group.baseline[target])
        captured.files[target] = group.baseline[target]
    }

    const files = changedFiles(group.baseline, captured.files)
    for (const file of files) file.path = displayFile(group, file.target)

    const issues = [...new Set([...group.issues, ...captured.issues])]
    const display = await publication(this.storage, id, files, issues)

    const checkpoint: Checkpoint = {
      version: 1,
      id,
      sessionId: group.sessionId,
      groupId: group.id,
      roots: group.roots,
      files,
      publication: display,
    }

    await this.storage.save('checkpoints', id, checkpoint)
    group.baseline = captured.files
    group.pendingCheckpoint = undefined
    group.issues = issues
    await this.saveGroup(group)

    return display
  }

  private async tryRelease(group: CaptureGroup) {
    const finished = group.participants.every(
      (participant) => participant.finished,
    )
    if (finished && !(await hasCaptureJobs(group))) group.released = true
    return group.released
  }

  private saveGroup(group: CaptureGroup) {
    return this.storage.save('groups', group.id, group)
  }
}

let manager: CheckpointManager | undefined
export function checkpoints() {
  return (manager ??= new CheckpointManager())
}

export async function finishCheckpointJob(sessionId: string, pid?: number) {
  await manager?.finishJob(sessionId, pid)
}
