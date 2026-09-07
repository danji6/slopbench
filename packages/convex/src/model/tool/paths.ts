import type { PathCheckResult } from '@sb/core/workspace/path-policy'

import {
  isToolAutoApproved,
  isUnrestrictedAccess,
} from '../../lib/tool/approval'
import type { WorkspaceToolContext } from './context'
import { callMcpTool } from './mcp'

/** Shared sidecar boundary for file and shell path decisions. */
export async function checkToolPaths(
  paths: string[],
  context: Pick<WorkspaceToolContext, 'sessionId' | 'workspaceId'>,
  allowedPaths: string[] = [],
  literal = false,
): Promise<PathCheckResult | null> {
  try {
    const text = await callMcpTool('check_paths', {
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      paths,
      allowedPaths,
      literal,
    })
    const result = JSON.parse(text) as PathCheckResult
    if (
      typeof result.complete !== 'boolean' ||
      !Array.isArray(result.resolved) ||
      !Array.isArray(result.uncovered) ||
      !Array.isArray(result.flagged)
    )
      return null
    return result
  } catch {
    return null
  }
}

export async function fileNeedsApproval(
  name: string,
  path: string,
  context: WorkspaceToolContext,
): Promise<boolean> {
  const approvals = await context.approvals?.()
  if (isUnrestrictedAccess(approvals)) return false
  const result = await checkToolPaths([path], context, approvals?.paths, true)
  const target = result?.resolved[0]
  if (!result?.complete || !target) return true
  if (target.allowed) return false
  if (target.forbidden || target.outside) return true
  return name !== 'read_file' && !isToolAutoApproved(name, undefined, approvals)
}
