import type { FolderWorkspace } from '@sb/core/types/workspace'

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
  workspace?: FolderWorkspace
  /** Frozen description guidance, separate from live personal folder access. */
  hasAgentHome?: boolean
  /** Shell used to execute commands (system's default when absent). */
  shell?: string
  allowInteractiveShells?: boolean
  /** Tool approvals, resolved on every call since they update often. */
  approvals?: () => Promise<ToolApprovals | undefined>
  isPlanMode?: () => Promise<boolean>
  /** Watches a background job so it can report back. */
  watchJob?: (job: WatchedJobRef) => Promise<void>
  /** Drops the watch once the agent has read or killed the job itself. */
  releaseJob?: (jobId: string) => Promise<void>
}

export type WatchedJobRef = {
  jobId: string
  command: string
  toolCallId: string
}

export type PlanToolContext = {
  ctx: ActionCtx
  sessionId: Id<'sessions'>
  approvals?: () => Promise<ToolApprovals | undefined>
}

export type ToolMeta = {
  name: string
  description?: string
  category?: string
  requiresAdmin?: boolean
  requiresWorkspace?: boolean
}

export function fileWorkspaceArgs(context: WorkspaceToolContext) {
  return {
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
    workspace: context.workspace,
  }
}

export function workspaceArgs(context: WorkspaceToolContext) {
  return {
    ...fileWorkspaceArgs(context),
    owner: context.ownerId,
    shell: context.shell,
    allowInteractiveShells: context.allowInteractiveShells ?? false,
  }
}
