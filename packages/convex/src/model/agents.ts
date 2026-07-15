import type { Id } from '../_generated/dataModel'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { CreateAgentArgs, UpdateAgentArgs } from '../types'
import { sanitizeSubAgents } from './agent/subagents'
import * as Avatars from './avatars'
import { DEFAULT_CONTEXT_OPTIONS, createDefaultAgent } from './defaults'
import { findModelEntry } from './provider/providers'
import { setMetadataModel } from './session/metadata'
import { get as getSettings } from './settings'
import { stopForSession } from './stream/lifecycle'

export async function list(ctx: AuthQueryCtx) {
  return ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', ctx.userId))
    .order('asc')
    .collect()
}

export async function get(
  ctx: AuthQueryCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await ctx.db.get(agentId)
  return agent?.ownerId === ctx.userId ? agent : null
}

export async function create(ctx: AuthMutationCtx, args: CreateAgentArgs) {
  const defaults = createDefaultAgent()
  return ctx.db.insert('agents', {
    ownerId: ctx.userId,
    prompts: defaults.prompts,
    tools: [],
    ...DEFAULT_CONTEXT_OPTIONS,
    ...args,
    subAgents: await sanitizeSubAgents(ctx, ctx.userId, args.subAgents),
  })
}

export async function update(
  ctx: AuthMutationCtx,
  { agentId, unset, ...patch }: UpdateAgentArgs,
) {
  const agent = await requireOwned(ctx, agentId)
  if (patch.subAgents) {
    patch.subAgents = await sanitizeSubAgents(ctx, ctx.userId, patch.subAgents)
  }
  // Explicit `undefined` in a patch deletes the field. Used to clear overrides.
  const cleared = Object.fromEntries(
    (unset ?? []).map((key) => [key, undefined]),
  )
  await ctx.db.patch(agentId, { ...patch, ...cleared })

  if ('modelId' in patch) {
    await refreshActiveSessionModelMetadata(ctx, {
      ...agent,
      modelId: patch.modelId,
    })
  }
}

export async function remove(
  ctx: AuthMutationCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await requireOwned(ctx, agentId)

  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
    .collect()

  for (const link of links) {
    await stopForSession(ctx, link.sessionId)
    const session = await ctx.db.get(link.sessionId)
    if (session?.activeAgentId === agentId) {
      await ctx.db.patch(session._id, {
        activeAgentId: undefined,
        metadata: setMetadataModel(session.metadata, undefined),
      })
    }
    await ctx.db.delete(link._id)
  }

  await ctx.db.delete(agentId)
  if (agent.avatarId) await Avatars.removeIfUnreferenced(ctx, agent.avatarId)
}

export async function duplicate(
  ctx: AuthMutationCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await requireOwned(ctx, agentId)
  const { _id, _creationTime, avatarId: _avatarId, ...copy } = agent
  return ctx.db.insert('agents', { ...copy, name: `${copy.name} (copy)` })
}

export async function clearAvatar(
  ctx: AuthMutationCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await requireOwned(ctx, agentId)
  await ctx.db.patch(agentId, { avatarId: undefined })
  if (agent.avatarId) await Avatars.removeIfUnreferenced(ctx, agent.avatarId)
}

export async function generateAvatarUploadUrl(ctx: AuthMutationCtx) {
  return ctx.storage.generateUploadUrl()
}

export async function confirmAvatarUpload(
  ctx: AuthMutationCtx,
  { agentId, avatarId }: { agentId: Id<'agents'>; avatarId: Id<'avatars'> },
) {
  const agent = await requireOwned(ctx, agentId)
  await ctx.db.patch(agentId, { avatarId })
  if (agent.avatarId) await Avatars.removeIfUnreferenced(ctx, agent.avatarId)
}

async function requireOwned(ctx: AuthMutationCtx, agentId: Id<'agents'>) {
  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
  return agent
}

async function refreshActiveSessionModelMetadata(
  ctx: AuthMutationCtx,
  agent: { _id: Id<'agents'>; ownerId: Id<'users'>; modelId?: string },
) {
  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_agentId', (q) => q.eq('agentId', agent._id))
    .collect()

  const settings = await getSettings(ctx)

  const model = agent.modelId
    ? (findModelEntry(settings?.modelProviders, agent.modelId) ?? {
        id: agent.modelId,
      })
    : undefined

  for (const link of links) {
    const session = await ctx.db.get(link.sessionId)
    if (session?.activeAgentId !== agent._id) continue

    await ctx.db.patch(session._id, {
      metadata: setMetadataModel(session.metadata, model),
    })
  }
}
