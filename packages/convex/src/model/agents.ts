import type { Doc, Id } from '../_generated/dataModel'
import { error } from '../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../functions'
import type { CreateAgentArgs, Prompt, UpdateAgentArgs } from '../types'
import { sanitizeSubAgents } from './agent/subagents'
import * as Avatars from './avatars'
import { assertCustomCssCap, assertShellPathCap } from './caps'
import { DEFAULT_CONTEXT_OPTIONS, createDefaultAgent } from './defaults'
import * as Prompts from './prompts'
import * as Reminders from './reminders'
import { stopForSession } from './stream/lifecycle'

/** What the agent pickers and lists render. */
export type AgentSummary = Pick<
  Doc<'agents'>,
  '_id' | 'name' | 'description' | 'avatarId'
>

/** All agents the user owns, as subsets of the docs for cheap read. */
export async function list(ctx: AuthQueryCtx): Promise<AgentSummary[]> {
  const agents = await ctx.db
    .query('agents')
    .withIndex('by_ownerId_name', (q) => q.eq('ownerId', ctx.userId))
    .order('asc')
    .collect()

  return agents.map(({ _id, name, description, avatarId }) => ({
    _id,
    name,
    description,
    avatarId,
  }))
}

export async function get(
  ctx: AuthQueryCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await ctx.db.get(agentId)
  return agent?.ownerId === ctx.userId ? agent : null
}

/**
 * An agent flattened back into the shape the archive format expects, with its
 * prompt and reminder rows inlined alongside the owner's prompt library.
 */
export async function exportData(
  ctx: AuthQueryCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await get(ctx, { agentId })
  if (!agent) return null

  const { _id, _creationTime, ownerId, avatarId, ...rest } = agent
  const [prompts, reminders, library] = await Promise.all([
    Prompts.listForAgent(ctx, agentId, 'own'),
    Reminders.listForAgent(ctx, agentId),
    Prompts.listOwned(ctx, ownerId, 'library'),
  ])

  return {
    name: agent.name,
    avatarId,
    data: {
      ...rest,
      prompts: Prompts.toItems(prompts),
      reminderPrompts: Reminders.toItems(reminders),
    } as Record<string, unknown>,
    libraryPrompts: Prompts.toItems(library) as Prompt[],
  }
}

export async function create(ctx: AuthMutationCtx, args: CreateAgentArgs) {
  const { prompts, reminderPrompts, ...rest } = args
  assertCustomCssCap(rest.customCss)
  assertShellPathCap(rest.shell)

  const agentId = await ctx.db.insert('agents', {
    ownerId: ctx.userId,
    tools: [],
    ...DEFAULT_CONTEXT_OPTIONS,
    ...rest,
    subAgents: await sanitizeSubAgents(ctx, ctx.userId, args.subAgents),
  })

  await Prompts.seed(ctx, {
    ownerId: ctx.userId,
    agentId,
    scope: 'own',
    items: prompts ?? createDefaultAgent().prompts,
  })
  if (reminderPrompts?.length) {
    await Reminders.seed(ctx, {
      ownerId: ctx.userId,
      agentId,
      scope: 'own',
      items: reminderPrompts,
    })
  }

  return agentId
}

export async function update(
  ctx: AuthMutationCtx,
  { agentId, unset, ...patch }: UpdateAgentArgs,
) {
  await requireOwned(ctx, agentId)
  assertCustomCssCap(patch.customCss)
  assertShellPathCap(patch.shell)
  if (patch.subAgents) {
    patch.subAgents = await sanitizeSubAgents(ctx, ctx.userId, patch.subAgents)
  }
  // Explicit `undefined` in a patch deletes the field. Used to clear overrides.
  const cleared = Object.fromEntries(
    (unset ?? []).map((key) => [key, undefined]),
  )
  await ctx.db.patch(agentId, { ...patch, ...cleared })
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
      })
    }
    await ctx.db.delete(link._id)
  }

  await Prompts.removeForAgent(ctx, agentId)
  await Reminders.removeForAgent(ctx, agentId)
  await removeSessionCache(ctx, agentId)

  await ctx.db.delete(agentId)
  if (agent.avatarId) await Avatars.removeIfUnreferenced(ctx, agent.avatarId)
}

async function removeSessionCache(ctx: AuthMutationCtx, agentId: Id<'agents'>) {
  const rows = await ctx.db
    .query('sessionCache')
    .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
    .collect()

  for (const row of rows) await ctx.db.delete(row._id)
}

export async function duplicate(
  ctx: AuthMutationCtx,
  { agentId }: { agentId: Id<'agents'> },
) {
  const agent = await requireOwned(ctx, agentId)
  const { _id, _creationTime, avatarId: _avatarId, ...copy } = agent

  const duplicateId = await ctx.db.insert('agents', {
    ...copy,
    name: `${copy.name} (copy)`,
  })
  await Prompts.copyForAgent(ctx, agentId, duplicateId, ctx.userId)
  await Reminders.copyForAgent(ctx, agentId, duplicateId, ctx.userId)

  return duplicateId
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
