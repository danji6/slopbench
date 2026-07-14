import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import type { ThemeSnapshot } from '../../types'
import { findModelEntry } from '../provider/providers'
import { get as getSettings } from '../settings'
import { stopForSession } from '../stream/lifecycle'
import {
  getMember,
  requireEnabled,
  requireMember,
  requireNonBlockingStream,
} from './memberships'
import { setMetadataModel } from './metadata'

type Args = {
  sessionId: Id<'sessions'>
  agentId: Id<'agents'>
}

export async function list(
  ctx: AuthQueryCtx,
  { sessionId }: Omit<Args, 'agentId'>,
) {
  if (!(await getMember(ctx, sessionId, ctx.userId))) return []

  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  return Promise.all(
    links.map(async (link) => {
      const agent = await ctx.db.get(link.agentId)
      return (
        agent && {
          _id: agent._id,
          name: agent.name,
          avatarId: agent.avatarId,
          modelId: agent.modelId,
          customCss: agent.customCss,
          scrollMode: agent.scrollMode,
          mathMode: agent.mathMode,
          chatWidth: agent.chatWidth,
          theme: agent.theme ?? (await getOwnerTheme(ctx, agent.ownerId)),
        }
      )
    }),
  ).then((agents) => agents.filter(Boolean))
}

async function getOwnerTheme(
  ctx: AuthQueryCtx,
  ownerId: Id<'users'>,
): Promise<ThemeSnapshot | undefined> {
  const settings = await ctx.db
    .query('settings')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .unique()
  return settings?.theme
}

export async function link(ctx: AuthMutationCtx, args: Args) {
  const { session } = await requireMember(ctx, args.sessionId, ctx.userId)

  requireOwnerAdministrationWhenDisabled(session, ctx.userId)

  const agent = await requireAgent(ctx, args.agentId)
  if (agent.ownerId !== ctx.userId) error('Forbidden', 403)

  const existing = await findLink(ctx, args)
  if (!existing) {
    await ctx.db.insert('sessionAgents', { ...args, addedBy: ctx.userId })
  }
}

export async function unlink(ctx: AuthMutationCtx, args: Args) {
  const { session } = await requireMember(ctx, args.sessionId, ctx.userId)

  requireOwnerAdministrationWhenDisabled(session, ctx.userId)

  const agent = await requireAgent(ctx, args.agentId)
  if (session.ownerId !== ctx.userId && agent.ownerId !== ctx.userId) {
    error('Forbidden', 403)
  }

  const link = await findLink(ctx, args)
  if (!link) return

  if (session.activeAgentId === args.agentId) {
    await ctx.db.patch(session._id, {
      activeAgentId: undefined,
      metadata: setMetadataModel(session.metadata, undefined),
    })
    await stopForSession(ctx, args.sessionId)
  }

  await ctx.db.delete(link._id)
}

export async function activate(ctx: AuthMutationCtx, args: Args) {
  const { session } = await requireMember(ctx, args.sessionId, ctx.userId)

  requireEnabled(session)

  await requireNonBlockingStream(ctx, args.sessionId)

  if (!(await findLink(ctx, args))) {
    error('Agent is not linked', 409)
  }

  const isActive = session.activeAgentId === args.agentId
  const agent = isActive ? null : await requireAgent(ctx, args.agentId)
  const model = agent ? await modelForAgent(ctx, agent) : undefined

  await ctx.db.patch(args.sessionId, {
    activeAgentId: isActive ? undefined : args.agentId,
    metadata: setMetadataModel(session.metadata, model),
  })
  if (isActive) await stopForSession(ctx, args.sessionId)
}

async function findLink(ctx: AuthQueryCtx | AuthMutationCtx, args: Args) {
  return ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', args.sessionId).eq('agentId', args.agentId),
    )
    .unique()
}

async function requireAgent(
  ctx: AuthQueryCtx | AuthMutationCtx,
  agentId: Id<'agents'>,
) {
  const agent = await ctx.db.get(agentId)
  if (!agent) error('Not found', 404)
  return agent
}

function requireOwnerAdministrationWhenDisabled(
  session: { settings?: { disabled?: boolean }; ownerId: Id<'users'> },
  userId: Id<'users'>,
) {
  if (session.settings?.disabled && session.ownerId !== userId)
    error('Session is disabled', 409)
}

async function modelForAgent(
  ctx: AuthQueryCtx | AuthMutationCtx,
  agent: { modelId?: string; ownerId: Id<'users'> },
) {
  if (!agent.modelId) return undefined

  const settings = await getSettings(ctx)

  return (
    findModelEntry(settings?.modelProviders, agent.modelId) ?? {
      id: agent.modelId,
    }
  )
}
