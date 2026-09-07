import {
  applyEdits,
  createUnifiedDiff,
  detectLineEnding,
  isUnchangedWrite,
  normalizeToLf,
  restoreLineEndings,
  stripBom,
} from '@sb/core/workspace/edit'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { assertCheckpointTarget, resolveToolPath } from './access'
import { checkPaths } from './check-paths'
import { runCommand } from './command'
import { expandHome } from './paths'
import {
  createCheckpoint,
  readSnapshot,
  readStore,
  updateStore,
  withFileQueue,
} from './store'

export type { WorkspaceRef } from './store'

const MAX_READ_BYTES = 50_000

export const bindWorkspaceSchema = z.object({
  sessionId: z.string(),
  root: z.string().min(1),
})

export const clearWorkspaceSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string().optional(),
})

export const restoreCheckpointSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
})

export const previewDiffSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  filePath: z.string(),
  allowedPaths: z.array(z.string()).optional(),
  content: z.string().optional(),
  edits: z
    .array(z.object({ oldText: z.string(), newText: z.string() }))
    .optional(),
})

export async function bindWorkspace(
  input: z.infer<typeof bindWorkspaceSchema>,
) {
  const root = await realpath(path.resolve(expandHome(input.root)))
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new Error('Workspace must be a directory')

  return updateStore((state) => {
    const existing = Object.values(state.workspaces).find(
      (item) => item.sessionId === input.sessionId,
    )
    const workspaceId = existing?.workspaceId ?? randomUUID()
    const now = Date.now()

    state.workspaces[workspaceId] = {
      workspaceId,
      sessionId: input.sessionId,
      root,
      label: path.basename(root) || root,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const record = state.workspaces[workspaceId]
    return { workspaceId, label: record.label, path: record.root }
  })
}

export async function clearWorkspace(
  input: z.infer<typeof clearWorkspaceSchema>,
) {
  await updateStore((state) => {
    for (const [workspaceId, workspace] of Object.entries(state.workspaces)) {
      if (
        workspace.sessionId === input.sessionId &&
        (!input.workspaceId || input.workspaceId === workspaceId)
      ) {
        delete state.workspaces[workspaceId]
      }
    }
    state.checkpoints = state.checkpoints.filter(
      (checkpoint) => checkpoint.sessionId !== input.sessionId,
    )
  })
  return { ok: true }
}

export async function readWorkspaceFile(input: {
  sessionId: string
  workspaceId: string
  filePath: string
  allowedPaths?: string[]
  offset?: number
  limit?: number
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveExistingFile(
    workspace.root,
    input.filePath,
    input.allowedPaths,
  )
  const buffer = await readFile(target.absolutePath)
  const raw = buffer.toString('utf-8')
  const lines = raw.split(/\r?\n/)
  const offset = Math.max(1, input.offset ?? 1)
  const start = offset - 1
  const selected =
    input.limit && input.limit > 0
      ? lines.slice(start, start + input.limit)
      : lines.slice(start)

  let content = selected.join('\n')
  let truncated = false
  if (content.length > MAX_READ_BYTES) {
    content = `${content.slice(0, MAX_READ_BYTES)}\n[truncated]`
    truncated = true
  }

  return {
    path: target.relativePath,
    content,
    totalLines: lines.length,
    offset,
    truncated,
  }
}

export async function writeWorkspaceFile(input: {
  sessionId: string
  workspaceId: string
  filePath: string
  allowedPaths?: string[]
  content: string
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveWritablePath(
    workspace.root,
    input.filePath,
    input.allowedPaths,
  )

  return withFileQueue(target.absolutePath, async () => {
    await assertCheckpointTarget(
      workspace.root,
      target.absolutePath,
      target.external,
    )
    const snapshot = await readSnapshot(target.absolutePath)

    // Reject empty diffs
    if (
      snapshot.existed &&
      isUnchangedWrite(snapshot.content ?? '', input.content)
    ) {
      throw new Error(
        `No changes made to ${target.relativePath}. The file already contains this content.`,
      )
    }

    const checkpoint = await createCheckpoint({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      absolutePath: target.absolutePath,
      external: target.external,
      relativePath: target.relativePath,
      snapshot,
    })

    await assertCheckpointTarget(
      workspace.root,
      target.absolutePath,
      target.external,
    )
    await mkdir(path.dirname(target.absolutePath), { recursive: true })
    await writeFile(target.absolutePath, input.content, 'utf-8')

    return {
      path: target.relativePath,
      bytes: Buffer.byteLength(input.content),
      checkpointId: checkpoint.checkpointId,
      diff: capDiff(
        createUnifiedDiff(
          target.relativePath,
          normalizeToLf(stripBom(snapshot.content ?? '').text),
          normalizeToLf(stripBom(input.content).text),
        ),
      ),
    }
  })
}

export async function editWorkspaceFile(input: {
  sessionId: string
  workspaceId: string
  filePath: string
  allowedPaths?: string[]
  edits: Array<{ oldText: string; newText: string }>
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  const target = await resolveExistingFile(
    workspace.root,
    input.filePath,
    input.allowedPaths,
  )

  return withFileQueue(target.absolutePath, async () => {
    await assertCheckpointTarget(
      workspace.root,
      target.absolutePath,
      target.external,
    )
    const snapshot = await readSnapshot(target.absolutePath)
    const { bom, text } = stripBom(snapshot.content ?? '')
    const ending = detectLineEnding(text)
    const baseContent = normalizeToLf(text)
    const newContent = applyEdits(baseContent, input.edits, target.relativePath)

    const checkpoint = await createCheckpoint({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      absolutePath: target.absolutePath,
      external: target.external,
      relativePath: target.relativePath,
      snapshot,
    })

    await assertCheckpointTarget(
      workspace.root,
      target.absolutePath,
      target.external,
    )
    await writeFile(
      target.absolutePath,
      bom + restoreLineEndings(newContent, ending),
      'utf-8',
    )

    return {
      path: target.relativePath,
      edits: input.edits.length,
      checkpointId: checkpoint.checkpointId,
      diff: capDiff(
        createUnifiedDiff(target.relativePath, baseContent, newContent),
      ),
    }
  })
}

/** Simulate a unified diff for the given input. */
export async function previewWorkspaceDiff(
  input: z.infer<typeof previewDiffSchema>,
): Promise<{ diff: string; path?: string }> {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)

  try {
    if (input.edits?.length) {
      const target = await resolveExistingFile(
        workspace.root,
        input.filePath,
        input.allowedPaths,
      )
      const snapshot = await readSnapshot(target.absolutePath)
      const baseContent = normalizeToLf(stripBom(snapshot.content ?? '').text)
      const newContent = applyEdits(
        baseContent,
        input.edits,
        target.relativePath,
      )

      return {
        path: target.relativePath,
        diff: capDiff(
          createUnifiedDiff(target.relativePath, baseContent, newContent),
        ),
      }
    }

    if (input.content !== undefined) {
      const target = await resolveWritablePath(
        workspace.root,
        input.filePath,
        input.allowedPaths,
      )
      const snapshot = await readSnapshot(target.absolutePath)
      const baseContent = normalizeToLf(stripBom(snapshot.content ?? '').text)
      const newContent = normalizeToLf(stripBom(input.content).text)

      return {
        path: target.relativePath,
        diff: capDiff(
          createUnifiedDiff(target.relativePath, baseContent, newContent),
        ),
      }
    }
  } catch {
    // No-op, client will use a fallback
  }

  return { diff: '' }
}

export async function runWorkspaceCommand(input: {
  sessionId: string
  workspaceId: string
  command: string
  timeout?: number
  signal?: AbortSignal
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  return runCommand(
    input.command,
    workspace.root,
    input.timeout ?? 30,
    input.signal,
  )
}

/** Inspect paths using the same resolver as dedicated file tools. */
export async function checkFlaggedPaths(input: {
  sessionId: string
  workspaceId: string
  paths: string[]
  allowedPaths?: string[]
  literal?: boolean
}) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  return checkPaths(workspace.root, input)
}

export async function restoreLatestCheckpoint(
  input: z.infer<typeof restoreCheckpointSchema>,
) {
  const workspace = await requireWorkspace(input.sessionId, input.workspaceId)
  return updateStore(async (state) => {
    const checkpoint = [...state.checkpoints]
      .reverse()
      .find(
        (item) =>
          item.sessionId === input.sessionId &&
          item.workspaceId === input.workspaceId,
      )

    if (!checkpoint) throw new Error('No checkpoint to restore')
    await assertCheckpointTarget(
      workspace.root,
      checkpoint.absolutePath,
      checkpoint.external === true,
    )

    if (!checkpoint.existed) {
      await rm(checkpoint.absolutePath, { force: true })
    } else if (checkpoint.contentPath) {
      const content = await readFile(checkpoint.contentPath, 'utf-8')
      await mkdir(path.dirname(checkpoint.absolutePath), { recursive: true })
      await writeFile(checkpoint.absolutePath, content, 'utf-8')
    }

    state.checkpoints = state.checkpoints.filter(
      (item) => item.checkpointId !== checkpoint.checkpointId,
    )
    return {
      restored: checkpoint.relativePath,
      checkpointId: checkpoint.checkpointId,
    }
  })
}

export async function requireWorkspace(sessionId: string, workspaceId: string) {
  const state = await readStore()
  const workspace = state.workspaces[workspaceId]
  if (!workspace || workspace.sessionId !== sessionId) {
    throw new Error('Workspace is not configured for this session')
  }
  return { ...workspace, root: await realpath(workspace.root) }
}

export async function resolveExistingFile(
  root: string,
  filePath: string,
  allowedPaths?: string[],
) {
  const target = await resolveToolPath(root, filePath, allowedPaths)
  const fileStat = await stat(target.absolutePath)
  if (!fileStat.isFile()) throw new Error('Path is not a file')
  return target
}

/** Browsing and mentions remain confined to the workspace. */
export async function resolveExistingPath(root: string, filePath: string) {
  const target = await resolveToolPath(root, filePath)
  const pathStat = await stat(target.absolutePath)
  return {
    ...target,
    isDirectory: pathStat.isDirectory(),
    isFile: pathStat.isFile(),
  }
}

async function resolveWritablePath(
  root: string,
  filePath: string,
  allowedPaths?: string[],
) {
  return resolveToolPath(root, filePath, allowedPaths)
}

const MAX_DIFF_BYTES = 50_000

function capDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_BYTES) return diff
  return `${diff.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]`
}
