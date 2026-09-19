import type { Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import { findUserBySubject } from '../../functions'
import { foldPaths, isPathAllowed } from '../../lib/tool/approval'
import { injectWorkspaceNote } from '../chat/notes'
import { requireMember, requireOwner } from './memberships'
import { deleteStorageIfPresent } from './sessionTeardown'
import { getApprovals, getState, patchState, setApprovals } from './state'

export async function _getWorkspaceContext(
  ctx: QueryCtx,
  { sessionId, subject }: { sessionId: Id<'sessions'>; subject: string },
) {
  const user = await findUserBySubject(ctx, subject)
  if (!user) error('Profile not initialized', 409)
  const { session } = await requireOwner(ctx, sessionId, user._id)
  return { workspace: session.workspace }
}

export async function _getMemberWorkspaceContext(
  ctx: QueryCtx,
  { sessionId, subject }: { sessionId: Id<'sessions'>; subject: string },
) {
  const user = await findUserBySubject(ctx, subject)
  if (!user) error('Profile not initialized', 409)
  const { session } = await requireMember(ctx, sessionId, user._id)
  return { workspace: session.workspace }
}

export async function _patchWorkspace(
  ctx: MutationCtx,
  args: {
    sessionId: Id<'sessions'>
    workspace: { workspaceId: string; label: string; path: string } | null
  },
) {
  const session = await ctx.db.get(args.sessionId)
  if (!session) return

  const workspace = args.workspace ?? undefined
  await injectWorkspaceNote(ctx, session, workspace)
  await ctx.db.patch(args.sessionId, { workspace })
}

/** Points the session at a freshly stored provider log, dropping the old one. */
export async function _patchSessionLog(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; storageId: Id<'_storage'> },
) {
  const previous = (await getState(ctx, args.sessionId))?.log

  await patchState(ctx, args.sessionId, { log: args.storageId })

  if (previous !== args.storageId) {
    await deleteStorageIfPresent(ctx, previous)
  }
}

export async function _allowToolPaths(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; paths: string[] },
) {
  const approvals = await getApprovals(ctx, args.sessionId)
  const existing = approvals.paths ?? []
  const additions = args.paths.filter((path) => !isPathAllowed(path, existing))
  if (additions.length === 0) return

  const paths = foldPaths([...existing, ...additions])
  await setApprovals(ctx, args.sessionId, 'paths', paths)
}
