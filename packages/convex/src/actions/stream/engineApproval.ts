'use node'

import type { FolderWorkspace } from '@cv/core/types/workspace'
import {
  type PathCheckResult,
  pathApprovalStatus,
} from '@cv/core/workspace/path-policy'
import type { UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import {
  analyzeShellPathCandidates,
  isFileTool,
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
  workspace?: FolderWorkspace
  allowedPaths?: string[]
}

/**
 * Attach what an approval request needs beyond its input: a simulated diff for
 * file mutations, and resolved paths for file and shell access.
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
    workspace: setup.workspace,
    allowedPaths: mergeToolApprovals(
      approvals ?? undefined,
      setup.agent.autoApprove,
    )?.paths,
  }
  const result = await Promise.all(
    parts.map((part) => withApprovalPreview(context, part)),
  )

  return result as UIMessage['parts']
}

async function withApprovalPreview(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  if ((part as { state?: string }).state !== 'approval-requested') {
    return part
  }
  if (isFileTool(part.type.replace(/^tool-/, ''))) {
    const checked = await withFileApprovalPaths(context, part)
    return FILE_MUTATION_TOOL_TYPES.has(part.type)
      ? withPreviewDiff(context, checked)
      : checked
  }
  return part.type === 'tool-shell' ? withApprovalPaths(context, part) : part
}

async function withFileApprovalPaths(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  const input = (part as { input?: { path?: string } }).input
  if (typeof input?.path !== 'string') return part
  const result = await checkToolPaths(
    [input.path],
    context,
    context.allowedPaths,
    true,
  )
  return withPathApprovalResult(part, result)
}

type PreviewDiffInput = {
  path?: string
  content?: string
  edits?: unknown
}

export async function withPreviewDiff(
  context: ApprovalContext,
  part: UIMessage['parts'][number],
) {
  const input = (part as { input?: PreviewDiffInput }).input
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
  const input = (part as { input?: { command?: string; cwd?: string } }).input
  const command = input?.command
  if (typeof command !== 'string') return part

  const { candidates, complete } = analyzeShellPathCandidates(command)
  const result = complete
    ? await checkToolPaths(
        candidates,
        context,
        context.allowedPaths,
        false,
        input?.cwd ?? 'workspace://',
      )
    : null

  return withPathApprovalResult(part, result)
}

function withPathApprovalResult(
  part: UIMessage['parts'][number],
  result: PathCheckResult | null,
) {
  return {
    ...part,
    approvalPathStatus: pathApprovalStatus(result),
    ...(result?.complete && result.uncovered.length
      ? { approvalPaths: result.uncovered }
      : {}),
  }
}
