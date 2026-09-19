'use node'

import { pathApprovalStatus } from '@sb/core/workspace/path-policy'
import type { UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import {
  analyzeShellPathCandidates,
  mergeToolApprovals,
} from '../../lib/tool/approval'
import { postSidecar } from '../../model/sidecar'
import { checkToolPaths } from '../../model/tool/paths'
import { type prepare } from './engineSetup'

export function hasAwaitingApproval(parts: UIMessage['parts']) {
  return parts.some((part) => {
    if (!part.type.startsWith('tool-')) return false
    const toolPart = part as { state?: string }
    return toolPart.state === 'approval-requested'
  })
}

export const FILE_MUTATION_TOOL_TYPES = new Set([
  'tool-write_file',
  'tool-edit_file',
])

export type ApprovalContext = {
  sessionId: Id<'sessions'>
  workspaceId: string
  allowedPaths?: string[]
}

/**
 * Attach what an approval request needs beyond its input: a simulated diff for
 * file mutations, and the sensitive paths a shell command references.
 */
export async function attachApprovalPreviews(
  ctx: ActionCtx,
  setup: NonNullable<Awaited<ReturnType<typeof prepare>>>,
  parts: UIMessage['parts'],
): Promise<UIMessage['parts']> {
  const workspaceId = setup.workspace?.workspaceId
  if (!workspaceId) return parts

  const approvals = await ctx.runQuery(internal.sessions._getApprovals, {
    sessionId: setup.stream.sessionId,
  })
  const context = {
    sessionId: setup.workspaceSessionId,
    workspaceId,
    allowedPaths: mergeToolApprovals(
      approvals ?? undefined,
      setup.agent.autoApprove,
    )?.paths,
  }
  const result = await Promise.all(
    parts.map((part) => {
      if ((part as { state?: string }).state !== 'approval-requested') {
        return part
      }
      if (FILE_MUTATION_TOOL_TYPES.has(part.type)) {
        return withPreviewDiff(context, part)
      }
      if (part.type === 'tool-shell') {
        return withApprovalPaths(context, part)
      }
      return part
    }),
  )

  return result as UIMessage['parts']
}

export async function withPreviewDiff(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  const input = (
    part as { input?: { path?: string; content?: string; edits?: unknown } }
  ).input
  if (!input?.path) return part

  try {
    const { diff, path } = await postSidecar<{ diff: string; path?: string }>(
      '/workspace/preview-diff',
      {
        ...context,
        filePath: input.path,
        content: input.content,
        edits: input.edits,
      },
    )
    if (!diff) return part
    return { ...part, previewDiff: diff, previewPath: path }
  } catch {
    return part
  }
}

export async function withApprovalPaths(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  const command = (part as { input?: { command?: string } }).input?.command
  if (typeof command !== 'string') return part

  const { candidates, complete } = analyzeShellPathCandidates(command)
  const result = complete
    ? await checkToolPaths(candidates, context, context.allowedPaths)
    : null

  return {
    ...part,
    approvalPathStatus: pathApprovalStatus(result),
    ...(result?.complete && result.uncovered.length
      ? { approvalPaths: result.uncovered }
      : {}),
  }
}
