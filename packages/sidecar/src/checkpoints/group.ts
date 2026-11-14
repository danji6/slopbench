import { selectFileWorkspace } from '@cv/core/workspace/personal'
import path from 'node:path'

import { isOutside } from '../mcp/workspace/access'
import { requireWorkspace } from '../mcp/workspace/resolve-workspace'
import {
  ensureSessionDirectory,
  sessionDirectory,
} from '../session-files/storage'
import type { CheckpointStorage } from './storage'
import type {
  BeginCapture,
  CaptureGroup,
  Checkpoint,
  RestoreJournal,
} from './types'

export const overlaps = (left: string[], right: string[]) =>
  left.some((a) => right.some((b) => !isOutside(a, b) || !isOutside(b, a)))

export async function captureRoots(input: BeginCapture) {
  const selected = input.workspace.agentOnly
    ? selectFileWorkspace(input.workspace, 'agent://')
    : input.workspace
  const workspace = await requireWorkspace(
    input.sessionId,
    selected.workspaceId,
    selected,
  )
  if (input.workspace.agentHome && !input.workspace.agentOnly) {
    const personal = selectFileWorkspace(input.workspace, 'agent://')
    const home = await requireWorkspace(
      input.sessionId,
      personal.workspaceId,
      personal,
    )
    workspace.roots.push(...home.roots)
  }
  if (input.workspace.sessionFiles)
    workspace.roots.push(await ensureSessionDirectory(input.sessionId))
  return [...new Set(workspace.roots)]
}

export function createGroup(
  input: BeginCapture,
  roots: string[],
): CaptureGroup {
  return {
    version: 1,
    id: input.groupId,
    sessionId: input.sessionId,
    roots,
    participants: [],
    baseline: {},
    explicit: [],
    excluded: [],
    issues: [],
    sealed: input.root === false,
    released: false,
  }
}

export function enrollParticipant(group: CaptureGroup, input: BeginCapture) {
  const participant = group.participants.find(
    (item) => item.id === input.participantId,
  )
  if (participant) {
    participant.workspace = input.workspace
  } else {
    group.participants.push({
      id: input.participantId,
      sessionId: input.sessionId,
      workspace: input.workspace,
      finished: false,
    })
  }
}

export function displayFile(group: CaptureGroup, target: string) {
  for (const participant of group.participants) {
    if (participant.workspace.sessionFiles) {
      const root = sessionDirectory(participant.sessionId)
      if (!isOutside(root, target))
        return `session://${path.relative(root, target).split(path.sep).join('/')}`
    }
    const home = participant.workspace.agentHome
    if (home && !isOutside(home.path, target))
      return `agent://${path.relative(home.path, target).split(path.sep).join('/')}`
  }
  const root = group.participants[0]?.workspace.path
  return root && !isOutside(root, target)
    ? path.relative(root, target).split(path.sep).join('/')
    : target
}

/** Removes only blobs that no checkpoint, live capture, or recovery journal references. */
export async function collectBlobs(
  storage: CheckpointStorage,
  groups: Iterable<CaptureGroup>,
) {
  const referenced = new Set<string>()
  for (const checkpoint of await storage.records<Checkpoint>('checkpoints')) {
    for (const file of checkpoint.files) {
      if (file.before) referenced.add(file.before.hash)
      if (file.after) referenced.add(file.after.hash)
    }
  }
  for (const group of groups) {
    for (const file of Object.values(group.baseline)) referenced.add(file.hash)
  }
  for (const journal of await storage.records<RestoreJournal>('journals')) {
    for (const file of journal.original) {
      if (file.before) referenced.add(file.before.hash)
      if (file.after) referenced.add(file.after.hash)
    }
  }
  await storage.collectBlobs(referenced)
}
