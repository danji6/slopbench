import {
  assertPersonalScope,
  selectFileWorkspace,
} from '@sb/core/workspace/personal'
import path from 'node:path'

import {
  assertCheckpointTarget,
  isOutside,
  resolveToolPath,
} from '../mcp/workspace/access'
import { requireWorkspace } from '../mcp/workspace/resolve-workspace'
import { isFilePermissionError } from './errors'
import { captureFile, sameFile } from './snapshot'
import type { CheckpointStorage } from './storage'
import type { Checkpoint, CheckpointFile, RestoreInput } from './types'

/** Checks every candidate before any writes, keeping file permissions local. */
export async function planRestore(
  storage: CheckpointStorage,
  checkpoint: Checkpoint,
  input: RestoreInput,
) {
  const reverting = input.direction === 'revert'
  const candidates = checkpoint.files.filter(
    (file) =>
      (file.reverted ?? checkpoint.publication.state === 'reverted') !==
      reverting,
  )
  const issues: string[] = []
  const original: CheckpointFile[] = []
  const conflicts: string[] = []
  for (const file of candidates) {
    try {
      const prepared = await prepareFile(storage, file, input)
      if (prepared) original.push(prepared)
      else conflicts.push(file.path)
    } catch (error) {
      if (!isFilePermissionError(error)) throw error
      issues.push(`${file.path}: ${String(error)}`)
    }
  }
  // Store failures must abort the operation before any workspace writes.
  for (const file of original) {
    if (file.before) await storage.bytes(file.before.hash)
    if (file.after) await storage.bytes(file.after.hash)
  }
  return { original, conflicts, issues }
}

async function prepareFile(
  storage: CheckpointStorage,
  file: CheckpointFile,
  input: RestoreInput,
) {
  await authorizeTarget(file, input)
  const current = await captureFile(storage, file.target)
  const reverting = input.direction === 'revert'
  const before = reverting ? file.after : file.before
  if (!sameFile(current, before)) return undefined
  return { ...file, before, after: reverting ? file.before : file.after }
}

async function authorizeTarget(file: CheckpointFile, input: RestoreInput) {
  const personal = input.workspaces?.find(
    (workspace) =>
      workspace.agentHome && !isOutside(workspace.agentHome.path, file.target),
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
  const link = file.before?.symlink || file.after?.symlink
  const target = link ? path.dirname(file.target) : file.target
  await assertCheckpointTarget(
    workspace.root,
    target,
    isOutside(workspace.root, target),
  )
  await resolveToolPath(
    workspace.root,
    target,
    input.allowedPaths,
    workspace.roots,
    workspace.grantRoot,
  )
}
