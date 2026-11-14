import { transitionActive } from '@cv/core/workspace/transition'
import { lstat, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import {
  assertPlainPath,
  copyTree,
  dataRoot,
  identifier,
} from '../agent-files/storage'
import { checkpoints } from '../checkpoints/manager'
import { mcpRegistry } from '../mcp/external/registry'
import {
  lockWorkspaces,
  unlockWorkspaces,
  workspaceOperationActive,
} from '../mcp/workspace/context'
import { killSessionShellJobs, listShellJobs } from '../shell/registry'
import {
  assertSessionDirectoryLive,
  ensurePlainDirectory,
  sessionDirectory,
  sessionTombstone,
} from './storage'
import { missing } from './transfers'

type Duplicate = {
  sourceId: string
  targetId: string
  sessionIds: string[]
  token: string
}

export async function duplicateDirectory({
  sourceId,
  targetId,
  sessionIds,
  token,
}: Duplicate) {
  if (sourceId === targetId || !sessionIds.includes(sourceId)) {
    throw new Error('Invalid session directory copy')
  }
  if (!transitionActive(token)) {
    throw new Error('Session duplication timed out')
  }

  const source = sessionDirectory(sourceId)
  const target = sessionDirectory(targetId)
  const stage = duplicateStage(targetId)

  await assertSessionDirectoryLive(targetId)
  await assertPlainPath(target)

  const destination = await lstat(target).catch(missing)
  if (destination) {
    if (!destination.isDirectory())
      throw new Error('Invalid duplicate destination')
    return
  }

  await lockWorkspaces({ sessionIds, token })
  try {
    await assertSessionDirectoryLive(sourceId)
    await assertPlainPath(source)

    if (!(await lstat(source).catch(missing))) return

    await ensurePlainDirectory(path.dirname(stage))
    await assertPlainPath(stage)
    await rm(stage, { recursive: true, force: true })
    await copyTree(source, stage)

    if (!transitionActive(token))
      throw new Error('Session duplication timed out')

    await assertSessionDirectoryLive(targetId)
    await assertPlainPath(target)
    await rename(stage, target)
  } finally {
    try {
      await rm(stage, { recursive: true, force: true })
    } finally {
      unlockWorkspaces({ sessionIds, token })
    }
  }
}

function duplicateStage(sessionId: string) {
  return path.join(dataRoot(), 'session-duplicates', identifier(sessionId))
}

export async function removeDirectory(sessionId: string) {
  await ensurePlainDirectory(sessionTombstone(sessionId))
  killSessionShellJobs(sessionId, true)
  await mcpRegistry.disconnectSessions([sessionId])
  if (
    workspaceOperationActive(sessionId) ||
    listShellJobs(sessionId).some((job) => job.status === 'running')
  )
    throw new Error('Waiting for session tools to stop')

  await checkpoints().removeSession(sessionId)
  const directory = sessionDirectory(sessionId)
  await assertPlainPath(directory)
  await rm(directory, { recursive: true, force: true })
  const stage = duplicateStage(sessionId)
  await assertPlainPath(stage)
  await rm(stage, { recursive: true, force: true })
}
