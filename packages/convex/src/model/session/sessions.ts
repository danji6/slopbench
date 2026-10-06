import type { Id } from '../../_generated/dataModel'
import { type AuthMutationCtx, requireRole } from '../../functions'
import type { ApprovalMode, SessionMode } from '../../types'
import { getByOwnerId as getSettings } from '../settings'
import { requireFolder, sessionGroup } from './folderContext'
import { resolveSessionModel } from './models'
import { requireOwnedAgent } from './sessionAccess'
import { setApprovalMode as setStateApprovalMode } from './state'

export { duplicate } from './sessionDuplicate'
export { list } from './sessionQueries'
export { removeAll } from './sessionTeardown'
export { get } from './sessionQueries'
export { getLogUrls } from './sessionQueries'
export { getStateView } from './sessionQueries'
export { update } from './sessionSettings'
export { setModel } from './sessionSettings'
export { setReasoningEffort } from './sessionSettings'
export { getMode } from './sessionQueries'
export { setMode } from './sessionSettings'
export { setApprovalMode } from './sessionSettings'
export { setDisabled } from './sessionSettings'
export { setHidden } from './sessionSettings'
export { remove } from './sessionTeardown'
export { _patchEnvironment } from './sessionSettings'
export { _getWorkspaceContext } from './sessionWorkspace'
export { _getMemberWorkspaceContext } from './sessionWorkspace'
export { _patchSessionLog } from './sessionWorkspace'
export { _allowToolPaths } from './sessionWorkspace'

export async function create(
  ctx: AuthMutationCtx,
  args: {
    folderId?: Id<'sessionFolders'>
    title?: string
    activeAgentId?: Id<'agents'>
    mode?: SessionMode
    approvalMode?: ApprovalMode
  },
) {
  if (args.approvalMode === 'unrestricted') requireRole(ctx.role, 'admin')
  const activeAgent = args.activeAgentId
    ? await requireOwnedAgent(ctx, args.activeAgentId)
    : null
  const settings = await getSettings(ctx, ctx.userId)

  const folder = args.folderId
    ? await requireFolder(ctx, args.folderId, ctx.userId)
    : null
  const now = Date.now()
  const sessionId = await ctx.db.insert('sessions', {
    ownerId: ctx.userId,
    folderId: args.folderId,
    title: args.title,
    activeAgentId: args.activeAgentId,
    model: await resolveSessionModel(
      ctx,
      activeAgent?.ownerId ?? ctx.userId,
      settings?.recentModel,
    ),
    reasoningEffort: settings?.recentReasoning,
    lastMessageAt: now,
    mode: folder?.workspace && args.mode === 'plan' ? args.mode : undefined,
  })

  await ctx.db.insert('userSessions', {
    sessionId,
    userId: ctx.userId,
    role: 'owner',
    groupKey: sessionGroup(args.folderId),
    lastMessageAt: now,
    title: args.title,
  })

  if (args.activeAgentId) {
    await ctx.db.insert('sessionAgents', {
      sessionId,
      agentId: args.activeAgentId,
      addedBy: ctx.userId,
    })
  }

  if (folder?.workspace && args.approvalMode === 'unrestricted') {
    await setStateApprovalMode(ctx, sessionId, args.approvalMode)
  }

  return { sessionId }
}
