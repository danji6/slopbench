import type { FolderWorkspace } from '@sb/core/types/workspace'
import type { PathCheckResult } from '@sb/core/workspace/path-policy'
import {
  assertPersonalScope,
  selectFileWorkspace,
} from '@sb/core/workspace/personal'
import {
  parseScopedPath,
  scopedDisplayPath,
} from '@sb/core/workspace/scoped-path'

import { inspectShellDirectory } from '../../shell/directory'
import { checkPaths } from './check-paths'
import { assertInside } from './paths'
import { requireWorkspace } from './resolve-workspace'

type CheckInput = {
  sessionId: string
  workspaceId: string
  workspace?: FolderWorkspace
  paths: string[]
  allowedPaths?: string[]
  literal?: boolean
  cwd?: string
}

/** Checks file prefixes or ordinary shell operands using their actual execution base. */
export async function checkScopedPaths(
  input: CheckInput,
): Promise<PathCheckResult> {
  if (input.cwd !== undefined) return checkShellPaths(input)
  const result: PathCheckResult = {
    complete: true,
    resolved: [],
    flagged: [],
    uncovered: [],
  }
  for (const filePath of input.paths) {
    appendResult(result, await checkFilePath(input, filePath))
  }
  return result
}

async function checkFilePath(input: CheckInput, filePath: string) {
  const selected = input.workspace
    ? selectFileWorkspace(input.workspace, filePath)
    : undefined
  const workspace = await requireWorkspace(
    input.sessionId,
    input.workspaceId,
    selected,
  )
  const parsed = parseScopedPath(filePath)
  const checked = await checkPaths(
    workspace.root,
    { ...input, paths: [parsed.path] },
    workspace.roots,
    workspace.grantRoot,
  )
  const canonical = canonicalGrants(checked)
  for (const item of checked.resolved) {
    if (parsed.explicit) assertInside(workspace.root, item.absolutePath)
    if (input.literal) assertPersonalScope(selected, item.absolutePath)
    item.path = scopedDisplayPath(filePath, item.path)
  }
  return canonical
}

async function checkShellPaths(input: CheckInput) {
  // Inspection must report an unapproved external cwd rather than reject it
  const directory = await inspectShellDirectory({
    ...input,
    allowedPaths: [...(input.allowedPaths ?? []), input.cwd!],
  })
  const cwdResult = await checkPaths(
    directory.root,
    { paths: [directory.cwd], allowedPaths: input.allowedPaths },
    directory.roots,
    directory.grantRoot,
  )
  const operands = await checkPaths(
    directory.cwd,
    input,
    directory.roots,
    directory.grantRoot,
  )
  const result = canonicalGrants(cwdResult)
  appendResult(result, canonicalGrants(operands))
  return result
}

function canonicalGrants(result: PathCheckResult): PathCheckResult {
  const resolve = (value: string) =>
    result.resolved.find((item) => item.path === value)?.absolutePath ?? value
  return {
    ...result,
    flagged: result.flagged.map(resolve),
    uncovered: result.uncovered.map(resolve),
  }
}

function appendResult(target: PathCheckResult, source: PathCheckResult) {
  target.complete &&= source.complete
  target.resolved.push(...source.resolved)
  target.flagged = [...new Set([...target.flagged, ...source.flagged])]
  target.uncovered = [...new Set([...target.uncovered, ...source.uncovered])]
}
