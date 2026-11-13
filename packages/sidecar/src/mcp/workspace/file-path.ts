import type { FolderWorkspace } from '@cv/core/types/workspace'
import {
  isRelativeFilePath,
  selectFileWorkspace,
} from '@cv/core/workspace/personal'
import {
  parseScopedPath,
  scopedDisplayPath,
} from '@cv/core/workspace/scoped-path'
import { isAbsolute } from 'node:path'

import { resolveToolPath } from './access'
import { assertInside } from './paths'

type FileToolInput = {
  workspace?: FolderWorkspace
  filePath: string
}

/** Uses the personal folder as the approval base when it is the only root. */
export function selectFileToolScope<T extends FileToolInput>(input: T): T {
  const { workspace } = input
  if (!workspace) return input

  let { filePath } = input
  if (workspace.agentOnly && workspace.agentHome) {
    if (isAbsolute(filePath)) {
      // Keep the path unprefixed so normal external path approvals apply.
      return { ...input, workspace: selectFileWorkspace(workspace, 'agent://') }
    }
    const { explicit, path } = parseScopedPath(filePath)
    if (!explicit && isRelativeFilePath(path)) filePath = `agent://${path}`
  }
  return {
    ...input,
    filePath,
    workspace: selectFileWorkspace(workspace, filePath),
  }
}

/** Resolves a file prefix and enforces its boundary after symlink resolution. */
export async function resolveFileToolPath(
  root: string,
  input: string,
  allowedPaths?: string[],
  roots?: string[],
  grantRoot?: string,
  allowOutsideWorkspace = false,
) {
  const parsed = parseScopedPath(input)
  const target = await resolveToolPath(
    root,
    parsed.path,
    allowedPaths,
    roots,
    grantRoot,
    allowOutsideWorkspace,
  )
  if (parsed.explicit) assertInside(root, target.absolutePath)
  return {
    ...target,
    relativePath: scopedDisplayPath(input, target.relativePath),
  }
}
