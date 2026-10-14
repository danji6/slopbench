import { toDisplayName } from '@sb/core/utils/names'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { MessageRole } from '../../types'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'

/** The denormalized sender fields every message and segment 0 carries. */
export type SenderIdentity = {
  senderName?: string
  senderAvatarId?: Id<'avatars'>
}

/** Picks just the identity fields off any row that carries them. */
export function senderIdentity(source: SenderIdentity): SenderIdentity {
  return {
    senderName: source.senderName,
    senderAvatarId: source.senderAvatarId,
  }
}

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

    return {
      sender: { type: 'agent' as const, id: agent._id },
      identity: agentIdentity(agent),
    }
  }

  return {
    sender: { type: 'user' as const, id: ctx.userId },
    identity: role === 'system' ? {} : userIdentity(settings),
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
    identity: userIdentity(settings),
  }
}

/** The output message identity a stream writes into, resolved at claim time. */
export async function streamOutputIdentity(
  ctx: MutationCtx,
  stream: {
    command: Doc<'streams'>['command']
    agentId: Id<'agents'>
    invokedBy: Id<'users'>
  },
) {
  if (stream.command.kind === 'impersonate') {
    return userOutputIdentity(ctx, stream.invokedBy)
  }

  const agent = await ctx.db.get(stream.agentId)
  if (!agent) error('Agent not found', 404)
  return {
    sender: { type: 'agent' as const, id: stream.agentId },
    role: 'assistant' as const,
    identity: agentIdentity(agent),
  }
}

export function userIdentity(
  settings: { displayName?: string; avatarId?: Id<'avatars'> } | null,
): SenderIdentity {
  return {
    senderName: toDisplayName(settings?.displayName),
    senderAvatarId: settings?.avatarId,
  }
}

export function agentIdentity(agent: {
  name: string
  avatarId?: Id<'avatars'>
}): SenderIdentity {
  return { senderName: agent.name, senderAvatarId: agent.avatarId }
}
