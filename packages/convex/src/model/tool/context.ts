import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import type { ToolApprovals } from '../../types'

export type WorkspaceToolContext = {
  /** The main session (parent's session if sub-agent). */
  sessionId: Id<'sessions'>
  /** Session that owns what this turn spawns. */
  ownerId: Id<'sessions'>
  /** Message the turn is writing into. */
  messageId?: Id<'messages'>
  messageCreatedAt?: number
  workspaceId: string
  /** Shell used to execute commands (system's default when absent). */
  shell?: string
  /** Tool approvals, resolved on every call since they update often. */
  approvals?: () => Promise<ToolApprovals | undefined>
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
    owner: context.ownerId,
    workspaceId: context.workspaceId,
    shell: context.shell,
  }
}
