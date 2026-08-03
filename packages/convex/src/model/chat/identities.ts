import { toDisplayName } from '@sb/core/utils/names'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import type { MessageRole, ThemeSnapshot } from '../../types'
import * as Appearances from '../appearances'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'

/** The denormalized sender fields every message and segment 0 carries. */
export type SenderIdentity = {
  senderName?: string
  senderAvatarId?: Id<'avatars'>
  appearanceId?: Id<'appearances'>
}

/** Picks just the identity fields off any row that carries them. */
export function senderIdentity(source: SenderIdentity): SenderIdentity {
  return {
    senderName: source.senderName,
    senderAvatarId: source.senderAvatarId,
    appearanceId: source.appearanceId,
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

    const agentSettings = await getSettingsByOwnerId(ctx, agent.ownerId)

    return {
      sender: { type: 'agent' as const, id: agent._id },
      identity: await agentIdentity(ctx, agent, agentSettings),
    }
  }

  return {
    sender: { type: 'user' as const, id: ctx.userId },
    identity: role === 'system' ? {} : await userIdentity(ctx, settings),
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
    identity: await userIdentity(ctx, settings),
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
    identity: await agentIdentity(ctx, agent, agentSettings),
  }
}

export async function userIdentity(
  ctx: MutationCtx,
  settings: {
    displayName?: string
    avatarId?: Id<'avatars'>
    customCss?: string
    theme?: ThemeSnapshot
  } | null,
): Promise<SenderIdentity> {
  return {
    senderName: toDisplayName(settings?.displayName),
    senderAvatarId: settings?.avatarId,
    appearanceId: await Appearances.resolve(ctx, {
      css: settings?.customCss,
      theme: settings?.theme,
    }),
  }
}

export async function agentIdentity(
  ctx: MutationCtx,
  agent: {
    name: string
    avatarId?: Id<'avatars'>
    customCss?: string
    theme?: ThemeSnapshot
  },
  settings: { theme?: ThemeSnapshot } | null,
): Promise<SenderIdentity> {
  return {
    senderName: agent.name,
    senderAvatarId: agent.avatarId,
    appearanceId: await Appearances.resolve(ctx, {
      css: agent.customCss,
      theme: agent.theme ?? settings?.theme,
    }),
  }
}
