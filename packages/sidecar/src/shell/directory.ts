import type { FolderWorkspace } from '@cv/core/types/workspace'
import {
  assertPersonalScope,
  defaultShellDirectory,
  selectFileWorkspace,
} from '@cv/core/workspace/personal'
import { stat } from 'node:fs/promises'

import { resolveFileToolPath } from '../mcp/workspace/file-path'
import { requireWorkspace } from '../mcp/workspace/resolve-workspace'
import { ensureSessionDirectory } from '../session-files/storage'

export type ShellDirectoryInput = {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  cwd?: string
  allowedPaths?: string[]
}

/** Resolves execution and approval bases without changing project source authority. */
export async function inspectShellDirectory(input: ShellDirectoryInput) {
  const path = input.cwd ?? defaultShellDirectory(input.workspace)
  const selected = input.workspace
    ? selectFileWorkspace(input.workspace, path)
    : undefined
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    selected,
  )
  const target = await resolveFileToolPath(
    workspace.root,
    path,
    input.allowedPaths,
    workspace.roots,
    workspace.grantRoot,
  )
  assertPersonalScope(selected, target.absolutePath)
  if (!(await stat(target.absolutePath)).isDirectory())
    throw new Error('Shell cwd is not a directory')
  return { ...workspace, cwd: target.absolutePath }
}

/** Revalidates the selected directory immediately before starting a shell. */
export async function resolveShellDirectory(input: ShellDirectoryInput) {
  const directory = await inspectShellDirectory(input)
  return {
    ...directory,
    environment: {
      SESSION_DIR: input.workspace?.sessionFiles
        ? await ensureSessionDirectory(input.sessionId)
        : undefined,
      AGENT_DIR: input.workspace?.agentHome?.path,
      WORKSPACE_DIR:
        input.workspace?.agentOnly || input.workspace?.sessionOnly
          ? undefined
          : input.workspace?.path,
    },
  }
}
