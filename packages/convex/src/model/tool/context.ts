import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { ToolApprovals } from '../../types'

export type WorkspaceToolContext = {
  sessionId: Id<'sessions'>
  workspaceId: string
  approvals?: ToolApprovals
  isPlanMode?: () => Promise<boolean>
}

export type PlanToolContext = {
  ctx: ActionCtx
  sessionId: Id<'sessions'>
}

export type ToolMeta = {
  name: string
  description?: string
  category?: string
  requiresAdmin?: boolean
  requiresWorkspace?: boolean
}

export function workspaceArgs(context: WorkspaceToolContext) {
  return {
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
  }
}
