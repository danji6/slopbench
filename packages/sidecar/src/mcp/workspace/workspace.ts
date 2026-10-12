import type { FolderWorkspace } from '@sb/core/types/workspace'
import {
  applyEdits,
  createUnifiedDiff,
  detectLineEnding,
  isUnchangedWrite,
  normalizeToLf,
  restoreLineEndings,
  stripBom,
} from '@sb/core/workspace/edit'
import {
  copyFile,
  mkdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { withAgentFiles } from '../../agent-files/access'
import { assertPlainPath } from '../../agent-files/storage'
import { readTextPage } from '../../files/read-text'
import { assertCheckpointTarget, isOutside, resolveToolPath } from './access'
import { checkPaths } from './check-paths'
import { runCommand } from './command'
import { withWorkspaceOperation, workspaceContextSchema } from './context'
import {
  createCheckpoint,
  readSnapshot,
  readStore,
  updateStore,
  withFileQueue,
} from './store'

export const restoreCheckpointSchema = z.object({
  allowedPaths: z.array(z.string()).optional(),
  sessionId: z.string(),
  workspaceId: z.string(),
  workspace: workspaceContextSchema,
})

export const previewDiffSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  workspace: workspaceContextSchema,
  filePath: z.string(),
  allowedPaths: z.array(z.string()).optional(),
  content: z.string().optional(),
  edits: z
    .array(z.object({ oldText: z.string(), newText: z.string() }))
    .optional(),
})

async function readWorkspaceFileImpl(input: {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  filePath: string
  allowedPaths?: string[]
  offset?: number
  limit?: number
  byteOffset?: number
}) {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )
  const target = await resolveExistingFile(
    workspace.root,
    input.filePath,
    input.allowedPaths,
    workspace.roots,
    workspace.grantRoot,
  )
  return {
    path: target.relativePath,
    ...(await readTextPage(target.absolutePath, input)),
  }
}

async function writeWorkspaceFileImpl(input: {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  filePath: string
  allowedPaths?: string[]
  content: string
}) {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )
  const target = await resolveWritablePath(
    workspace.root,
    input.filePath,
    input.allowedPaths,
    workspace.roots,
    workspace.grantRoot,
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

async function editWorkspaceFileImpl(input: {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  filePath: string
  allowedPaths?: string[]
  edits: Array<{ oldText: string; newText: string }>
}) {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )
  const target = await resolveExistingFile(
    workspace.root,
    input.filePath,
    input.allowedPaths,
    workspace.roots,
    workspace.grantRoot,
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
async function previewWorkspaceDiffImpl(
  input: z.infer<typeof previewDiffSchema>,
): Promise<{ diff: string; path?: string }> {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )

  try {
    if (input.edits?.length) {
      const target = await resolveExistingFile(
        workspace.root,
        input.filePath,
        input.allowedPaths,
        workspace.roots,
        workspace.grantRoot,
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
        workspace.roots,
        workspace.grantRoot,
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

async function runWorkspaceCommandImpl(input: {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  command: string
  timeout?: number
  signal?: AbortSignal
}) {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )
  return runCommand(
    input.command,
    workspace.root,
    input.timeout ?? 30,
    input.signal,
  )
}

/** Inspect paths using the same resolver as dedicated file tools. */
async function checkFlaggedPathsImpl(input: {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  paths: string[]
  allowedPaths?: string[]
  literal?: boolean
}) {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )
  return checkPaths(workspace.root, input, workspace.roots, workspace.grantRoot)
}

async function restoreLatestCheckpointImpl(
  input: z.infer<typeof restoreCheckpointSchema>,
) {
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    input.workspace,
  )
  const latest = (await readStore()).checkpoints
    .slice()
    .reverse()
    .find((item) => item.sessionId === input.sessionId)

  if (!latest) throw new Error('No checkpoint to restore')

  return withFileQueue(latest.absolutePath, () =>
    updateStore(async (state) => {
      const checkpoint = state.checkpoints
        .slice()
        .reverse()
        .find((item) => item.sessionId === input.sessionId)

      if (!checkpoint || checkpoint.checkpointId !== latest.checkpointId)
        throw new Error('Checkpoint changed, try again')

      await assertCheckpointTarget(
        workspace.root,
        checkpoint.absolutePath,
        isOutside(workspace.root, checkpoint.absolutePath),
      )
      await resolveToolPath(
        workspace.root,
        checkpoint.absolutePath,
        input.allowedPaths,
        workspace.roots,
        workspace.grantRoot,
      )
      if (!checkpoint.existed) {
        await rm(checkpoint.absolutePath, { force: true })
      } else if (checkpoint.contentPath) {
        await mkdir(path.dirname(checkpoint.absolutePath), { recursive: true })
        await copyFile(checkpoint.contentPath, checkpoint.absolutePath)
      }
      state.checkpoints = state.checkpoints.filter(
        (item) => item.checkpointId !== checkpoint.checkpointId,
      )
      return {
        restored: checkpoint.relativePath,
        checkpointId: checkpoint.checkpointId,
      }
    }),
  )
}

export async function requireWorkspace(
  sessionId: string,
  workspaceId: string,
  context?: FolderWorkspace,
) {
  if (context) {
    if (context.workspaceId !== workspaceId || !context.sources?.length)
      throw new Error('Invalid folder workspace context')

    const roots = await Promise.all(
      context.sources.map(async (source) => {
        const root = await realpath(source.path)
        if (root !== source.path || !(await stat(root)).isDirectory())
          throw new Error(`Source directory changed: ${source.path}`)
        return root
      }),
    )
    if (roots[0] !== context.path)
      throw new Error('Primary source does not match the workspace')

    if (context.agentHome) {
      await assertPlainPath(context.agentHome.path)
      if (
        (await realpath(context.agentHome.path)) !== context.agentHome.path ||
        !(await stat(context.agentHome.path)).isDirectory()
      )
        throw new Error('Personal folder changed')
    }
    return {
      workspaceId,
      sessionId,
      root: roots[0]!,
      roots: [
        ...new Set([
          ...roots,
          ...(context.agentHome
            ? [await realpath(context.agentHome.path)]
            : []),
        ]),
      ],
      grantRoot: context.approvalRoot ?? roots[0]!,
      label: context.label,
    }
  }
  throw new Error('Workspace is not configured for this session')
}

export async function resolveExistingFile(
  root: string,
  filePath: string,
  allowedPaths?: string[],
  roots?: string[],
  grantRoot?: string,
) {
  const target = await resolveToolPath(
    root,
    filePath,
    allowedPaths,
    roots,
    grantRoot,
  )
  const fileStat = await stat(target.absolutePath)
  if (!fileStat.isFile()) throw new Error('Path is not a file')
  return target
}

/** Browsing and mentions remain confined to the workspace. */
export async function resolveExistingPath(
  root: string,
  filePath: string,
  roots?: string[],
) {
  const target = await resolveToolPath(root, filePath, [], roots)
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
  roots?: string[],
  grantRoot?: string,
) {
  return resolveToolPath(root, filePath, allowedPaths, roots, grantRoot)
}

const MAX_DIFF_BYTES = 50_000

function capDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_BYTES) return diff
  return `${diff.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]`
}

export function readWorkspaceFile(
  input: Parameters<typeof readWorkspaceFileImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () => readWorkspaceFileImpl(input)),
  )
}

export function writeWorkspaceFile(
  input: Parameters<typeof writeWorkspaceFileImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () =>
      writeWorkspaceFileImpl(input),
    ),
  )
}

export function editWorkspaceFile(
  input: Parameters<typeof editWorkspaceFileImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () => editWorkspaceFileImpl(input)),
  )
}

export function previewWorkspaceDiff(
  input: Parameters<typeof previewWorkspaceDiffImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () =>
      previewWorkspaceDiffImpl(input),
    ),
  )
}

export function runWorkspaceCommand(
  input: Parameters<typeof runWorkspaceCommandImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () =>
      runWorkspaceCommandImpl(input),
    ),
  )
}

export function checkFlaggedPaths(
  input: Parameters<typeof checkFlaggedPathsImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () => checkFlaggedPathsImpl(input)),
  )
}

export function restoreLatestCheckpoint(
  input: Parameters<typeof restoreLatestCheckpointImpl>[0],
) {
  return withAgentFiles(input.workspace?.agentHome?.agentId, () =>
    withWorkspaceOperation(input.sessionId, () =>
      restoreLatestCheckpointImpl(input),
    ),
  )
}
