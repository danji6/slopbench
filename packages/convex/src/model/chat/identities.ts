import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { MessageRole, ThemeSnapshot } from '../../types'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'

export async function resolveSender(
  ctx: AuthMutationCtx,
  {
    role,
    session,
    settings,
  }: {
    role: MessageRole
    session: Doc<'sessions'>
    settings: Doc<'settings'> | null
  },
) {
  if (role === 'assistant') {
    if (!session.activeAgentId) error('No active agent', 409)
    const agent = await ctx.db.get(session.activeAgentId)
    if (!agent) error('Agent not found', 404)

    const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)

    return {
      sender: { type: 'agent' as const, id: agent._id },
      senderSnapshot: agentSenderSnapshot(agent, agentSettings),
    }
  }

  return {
    sender: { type: 'user' as const, id: ctx.userId },
    senderSnapshot:
      role === 'system' ? undefined : userSenderSnapshot(settings),
  }
}

export async function userOutputIdentity(
  ctx: MutationCtx,
  userId: Id<'users'>,
) {
  const settings = await getSettingsByOwnerId(ctx, userId)

  return {
    sender: { type: 'user' as const, id: userId },
    role: 'user' as const,
    senderSnapshot: userSenderSnapshot(settings),
  }
}

/** The output message identity a stream writes into, resolved at claim time. */
export async function streamOutputIdentity(
  ctx: MutationCtx,
  stream: {
    operation: Doc<'streams'>['operation']
    agentId: Id<'agents'>
    invokedBy: Id<'users'>
  },
) {
  if (stream.operation === 'impersonate') {
    return userOutputIdentity(ctx, stream.invokedBy)
  }

  const agent = await ctx.db.get(stream.agentId)
  if (!agent) error('Agent not found', 404)
  const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)

  return {
    sender: { type: 'agent' as const, id: stream.agentId },
    role: 'assistant' as const,
    senderSnapshot: agentSenderSnapshot(agent, agentSettings),
  }
}

function userSenderSnapshot(
  settings: {
    displayName?: string
    avatarId?: Id<'avatars'>
    customCss?: string
    theme?: ThemeSnapshot
  } | null,
) {
  return {
    name: settings?.displayName ?? 'User',
    avatarId: settings?.avatarId,
    css: settings?.customCss,
    theme: settings?.theme,
  }
}

export function agentSenderSnapshot(
  agent: {
    name: string
    avatarId?: Id<'avatars'>
    customCss?: string
    theme?: ThemeSnapshot
  },
  settings: { theme?: ThemeSnapshot } | null,
) {
  return {
    name: agent.name,
    avatarId: agent.avatarId,
    css: agent.customCss,
    theme: agent.theme ?? settings?.theme,
  }
}
