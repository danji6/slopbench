import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { type AuthMutationCtx, requireRole } from '../../functions'
import type { ApprovalMode, SessionMode, UpdateSessionArgs } from '../../types'
import { injectModeNote } from '../chat/notes'
import { demoteToDraft } from '../plans'
import { ensureForUser as ensureSettingsForUser } from '../settings'
import { stopForSession } from '../stream/lifecycle'
import { syncTitle } from '../userSessions'
import {
  requireMember,
  requireNonBlockingStream,
  requireOwner,
} from './memberships'
import { resolveSessionModel } from './models'
import { requireActiveAgentOwner } from './sessionAccess'
import { requireLinkedAgent } from './sessionAccess'
import { patchState, setApprovalMode as setStateApprovalMode } from './state'

export async function update(
  ctx: AuthMutationCtx,
  { sessionId, ...patch }: UpdateSessionArgs,
) {
  await requireOwner(ctx, sessionId, ctx.userId)

  if ('activeAgentId' in patch) {
    await requireNonBlockingStream(ctx, sessionId)
    if (patch.activeAgentId) {
      await requireLinkedAgent(ctx, sessionId, patch.activeAgentId)
    }
  }

  const session = await ctx.db.get(sessionId)

  await ctx.db.patch(sessionId, {
    ...(typeof patch.title === 'string' ? { title: patch.title } : {}),
    ...('activeAgentId' in patch
      ? { activeAgentId: patch.activeAgentId ?? undefined }
      : {}),
    ...(patch.settings
      ? { settings: { ...session?.settings, ...patch.settings } }
      : {}),
  })

  if (typeof patch.title === 'string') {
    await syncTitle(ctx, sessionId, patch.title)
  }

  if (patch.settings?.disabled) await stopForSession(ctx, sessionId)
}

/** Selects the model for one session and remembers it for future sessions. */
export async function setModel(
  ctx: AuthMutationCtx,
  {
    sessionId,
    modelId,
    reasoningEffort,
  }: {
    sessionId: Id<'sessions'>
    modelId: string
    reasoningEffort: string
  },
) {
  const agent = await requireActiveAgentOwner(ctx, sessionId)
  const model = await resolveSessionModel(ctx, agent.ownerId, modelId)

  await ctx.db.patch(sessionId, { model, reasoningEffort })
  await ensureSettingsForUser(ctx, ctx.userId, {
    recentModel: modelId,
    recentReasoning: reasoningEffort,
  })
}

/** Selects reasoning effort for one session and its future session default. */
export async function setReasoningEffort(
  ctx: AuthMutationCtx,
  {
    sessionId,
    reasoningEffort,
  }: { sessionId: Id<'sessions'>; reasoningEffort: string },
) {
  await requireActiveAgentOwner(ctx, sessionId)
  await ctx.db.patch(sessionId, { reasoningEffort })
  await ensureSettingsForUser(ctx, ctx.userId, {
    recentReasoning: reasoningEffort,
  })
}

export async function setMode(
  ctx: AuthMutationCtx,
  { sessionId, mode }: { sessionId: Id<'sessions'>; mode: SessionMode },
) {
  const { session } = await requireMember(ctx, sessionId, ctx.userId)
  const next = mode === 'plan' ? mode : undefined
  await ctx.db.patch(sessionId, { mode: next })

  // Re-entering plan mode reopens an approved plan for revision
  if (mode === 'plan') await demoteToDraft(ctx, sessionId)

  await injectModeNote(ctx, { ...session, mode: next }, ctx.userId)
}

export async function setApprovalMode(
  ctx: AuthMutationCtx,
  { sessionId, mode }: { sessionId: Id<'sessions'>; mode: ApprovalMode },
) {
  requireRole(ctx.role, 'admin')
  await requireMember(ctx, sessionId, ctx.userId)
  await setStateApprovalMode(ctx, sessionId, mode)
}

export async function setDisabled(
  ctx: AuthMutationCtx,
  { sessionId, disabled }: { sessionId: Id<'sessions'>; disabled: boolean },
) {
  await requireOwner(ctx, sessionId, ctx.userId)
  const session = await ctx.db.get(sessionId)
  await ctx.db.patch(sessionId, {
    settings: { ...session?.settings, disabled },
  })
  if (disabled) await stopForSession(ctx, sessionId)
}

export async function setHidden(
  ctx: AuthMutationCtx,
  { sessionId, hidden }: { sessionId: Id<'sessions'>; hidden: boolean },
) {
  // Hiding a shared session only affects this member's sidebar
  const { membership } = await requireMember(ctx, sessionId, ctx.userId)
  await ctx.db.patch(membership._id, { userHidden: hidden || undefined })
}

export async function _patchEnvironment(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; environment: Record<string, unknown> },
) {
  await patchState(ctx, args.sessionId, { environment: args.environment })
}
