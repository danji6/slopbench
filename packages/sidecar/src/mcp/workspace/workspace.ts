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
  assertPersonalScope,
  selectFileWorkspace,
} from '@sb/core/workspace/personal'
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { readTextPage } from '../../files/read-text'
import { resolveShellDirectory } from '../../shell/directory'
import { assertCheckpointTarget, isOutside, resolveToolPath } from './access'
import { runCommand } from './command'
import { withFilesystemOperation, workspaceContextSchema } from './context'
import { resolveFileToolPath } from './file-path'
import { requireWorkspace } from './resolve-workspace'
import { checkScopedPaths } from './scoped-checks'
import {
  createCheckpoint,
  readSnapshot,
  readStore,
  updateStore,
  withFileQueue,
} from './store'

export { requireWorkspace } from './resolve-workspace'

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
  assertPersonalScope(input.workspace, target.absolutePath)
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

  assertPersonalScope(input.workspace, target.absolutePath)
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

  assertPersonalScope(input.workspace, target.absolutePath)
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
      assertPersonalScope(input.workspace, target.absolutePath)
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
      assertPersonalScope(input.workspace, target.absolutePath)
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
  cwd?: string
  allowedPaths?: string[]
  timeout?: number
  signal?: AbortSignal
}) {
  const directory = await resolveShellDirectory(input)
  return runCommand(
    input.command,
    directory.cwd,
    input.timeout ?? 30,
    input.signal,
    directory.environment,
  )
}

async function restoreLatestCheckpointImpl(
  input: z.infer<typeof restoreCheckpointSchema>,
) {
  const latest = (await readStore()).checkpoints
    .slice()
    .reverse()
    .find((item) => item.sessionId === input.sessionId)
  if (!latest) throw new Error('No checkpoint to restore')

  const selected = input.workspace
    ? selectFileWorkspace(input.workspace, latest.relativePath)
    : undefined
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    selected,
  )
  assertPersonalScope(selected, latest.absolutePath)

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

export async function resolveExistingFile(
  root: string,
  filePath: string,
  allowedPaths?: string[],
  roots?: string[],
  grantRoot?: string,
) {
  const target = await resolveFileToolPath(
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
  return resolveFileToolPath(root, filePath, allowedPaths, roots, grantRoot)
}

const MAX_DIFF_BYTES = 50_000

function capDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_BYTES) return diff
  return `${diff.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]`
}

export function readWorkspaceFile(
  input: Parameters<typeof readWorkspaceFileImpl>[0],
) {
  return withFilesystemOperation(input, () =>
    readWorkspaceFileImpl(fileOperationInput(input)),
  )
}

export function writeWorkspaceFile(
  input: Parameters<typeof writeWorkspaceFileImpl>[0],
) {
  return withFilesystemOperation(input, () =>
    writeWorkspaceFileImpl(fileOperationInput(input)),
  )
}

export function editWorkspaceFile(
  input: Parameters<typeof editWorkspaceFileImpl>[0],
) {
  return withFilesystemOperation(input, () =>
    editWorkspaceFileImpl(fileOperationInput(input)),
  )
}

export function previewWorkspaceDiff(
  input: Parameters<typeof previewWorkspaceDiffImpl>[0],
) {
  return withFilesystemOperation(input, () =>
    previewWorkspaceDiffImpl(fileOperationInput(input)),
  )
}

export function runWorkspaceCommand(
  input: Parameters<typeof runWorkspaceCommandImpl>[0],
) {
  return withFilesystemOperation(input, () => runWorkspaceCommandImpl(input))
}

export function checkFlaggedPaths(
  input: Parameters<typeof checkScopedPaths>[0],
) {
  return withFilesystemOperation(input, () => checkScopedPaths(input))
}

export function restoreLatestCheckpoint(
  input: Parameters<typeof restoreLatestCheckpointImpl>[0],
) {
  return withFilesystemOperation(input, () =>
    restoreLatestCheckpointImpl(input),
  )
}

type FileOperationInput = {
  workspace?: FolderWorkspace
  filePath: string
}

function fileOperationInput<T extends FileOperationInput>(input: T): T {
  if (!input.workspace) return input
  return {
    ...input,
    workspace: selectFileWorkspace(input.workspace, input.filePath),
  }
}
