import { FALLBACK_DISPLAY_NAME } from '@sb/core/const'
import type { PaginationOptions } from 'convex/server'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import {
  type AuthMutationCtx,
  type AuthQueryCtx,
  findUserBySubject,
} from '../../functions'
import { isPathAllowed } from '../../lib/tool/approval'
import type {
  SessionListItem,
  SessionMode,
  SessionParticipant,
  UpdateSessionArgs,
} from '../../types'
import * as Avatars from '../avatars'
import { deleteVersions } from '../messageContents'
import { demoteToDraft } from '../plans'
import { findModelEntry } from '../provider/providers'
import { getByOwnerId as getSettings } from '../settings'
import { remove as removeStream, stopForSession } from '../stream/lifecycle'
import { syncTitle } from '../userSessions'
import {
  getMember,
  requireMember,
  requireNonBlockingStream,
  requireOwner,
} from './memberships'
import { setMetadataModel } from './metadata'

export async function create(
  ctx: AuthMutationCtx,
  args: { title?: string; activeAgentId?: Id<'agents'>; mode?: SessionMode },
) {
  if (args.activeAgentId) {
    await requireOwnedAgent(ctx, args.activeAgentId)
  }

  const now = Date.now()
  const sessionId = await ctx.db.insert('sessions', {
    ownerId: ctx.userId,
    title: args.title,
    activeAgentId: args.activeAgentId,
    metadata: await metadataForAgent(ctx, args.activeAgentId),
    lastMessageAt: now,
    mode: args.mode === 'plan' ? args.mode : undefined,
  })

  await ctx.db.insert('userSessions', {
    sessionId,
    userId: ctx.userId,
    role: 'owner',
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

  return { sessionId }
}

export async function list(
  ctx: AuthQueryCtx,
  {
    paginationOpts,
    search,
    showHidden,
  }: {
    paginationOpts: PaginationOptions
    search?: string
    showHidden?: boolean
  },
): Promise<{
  page: SessionListItem[]
  isDone: boolean
  continueCursor: string
}> {
  const term = search?.trim()

  // userSessions is queried instead because it contains shared sessions too
  const result = term
    ? await ctx.db
        .query('userSessions')
        .withSearchIndex('search_title', (q) =>
          q.search('title', term).eq('userId', ctx.userId),
        )
        .paginate(paginationOpts)
    : await ctx.db
        .query('userSessions')
        .withIndex('by_userId_hidden_lastMessageAt', (q) =>
          q.eq('userId', ctx.userId).eq('hidden', undefined),
        )
        .order('desc')
        .paginate(paginationOpts)

  const page = await Promise.all(
    result.page.map(async (row) => {
      if (!showHidden && row.userHidden) return null
      const session = await ctx.db.get(row.sessionId)
      if (!session || session.parent) return null
      return toListItem(ctx, session, row.userHidden)
    }),
  )

  return {
    ...result,
    page: page.filter((item): item is SessionListItem => item !== null),
  }
}

async function toListItem(
  ctx: AuthQueryCtx,
  session: Doc<'sessions'>,
  userHidden?: boolean,
): Promise<SessionListItem> {
  const members = await ctx.db
    .query('userSessions')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .collect()

  const users = await Promise.all(
    members.map(async (member): Promise<SessionParticipant> => {
      const settings = await getSettings(ctx, member.userId)
      return {
        id: member.userId,
        kind: 'user',
        name: settings?.displayName ?? FALLBACK_DISPLAY_NAME,
        avatarId: settings?.avatarId,
      }
    }),
  )

  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
    .collect()

  const agents = await Promise.all(
    links.map(async (link): Promise<SessionParticipant | null> => {
      const agent = await ctx.db.get(link.agentId)
      return agent
        ? {
            id: agent._id,
            kind: 'agent',
            name: agent.name,
            avatarId: agent.avatarId,
          }
        : null
    }),
  )

  const participants = [
    ...users,
    ...agents.filter((agent): agent is SessionParticipant => agent !== null),
  ]

  return { ...session, participants, hidden: userHidden || undefined }
}

// Left intentionally unwired for now
export async function removeAll(ctx: AuthMutationCtx) {
  const owned = await ctx.db
    .query('sessions')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ctx.userId))
    .collect()

  for (const session of owned) {
    // Children are cascade-deleted with their parent
    if (!session.parent) await remove(ctx, { sessionId: session._id })
  }
}

export async function get(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const member = await getMember(ctx, sessionId, ctx.userId)
  return member?.session ?? null
}

export async function getLogUrls(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const member = await getMember(ctx, sessionId, ctx.userId)
  if (!member) return null

  const logUrl = member.session.metadata?.log
    ? await ctx.storage.getUrl(member.session.metadata.log)
    : null

  return { logUrl }
}

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
    ...('activeAgentId' in patch
      ? {
          metadata: setMetadataModel(
            await getSessionMetadata(ctx, sessionId),
            patch.activeAgentId === null
              ? undefined
              : await modelForAgent(ctx, patch.activeAgentId),
          ),
        }
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

export async function getMode(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
): Promise<SessionMode | null> {
  return (await ctx.db.get(sessionId))?.mode ?? null
}

export async function setMode(
  ctx: AuthMutationCtx,
  { sessionId, mode }: { sessionId: Id<'sessions'>; mode: SessionMode },
) {
  await requireMember(ctx, sessionId, ctx.userId)
  await ctx.db.patch(sessionId, { mode: mode === 'plan' ? mode : undefined })

  // Re-entering plan mode reopens an approved plan for revision
  if (mode === 'plan') await demoteToDraft(ctx, sessionId)
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

export async function remove(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  await requireOwner(ctx, sessionId, ctx.userId)
  await stopForSession(ctx, sessionId)

  const children = await ctx.db
    .query('sessions')
    .withIndex('by_parentSessionId', (q) => q.eq('parent.sessionId', sessionId))
    .collect()

  for (const child of children) {
    await remove(ctx, { sessionId: child._id })
  }

  const sessionTables = [
    'userSessions',
    'sessionShares',
    'sessionAgents',
    'plans',
    'todos',
    'sessionCache',
  ] as const

  for (const table of sessionTables) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .collect()

    for (const row of rows) {
      await ctx.db.delete(row._id)
    }
  }

  const streams = await ctx.db
    .query('streams')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const stream of streams) {
    await removeStream(ctx, stream._id)
  }

  const attachments = await ctx.db
    .query('attachments')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  for (const attachment of attachments) {
    await ctx.storage.delete(attachment.storageId)
    await ctx.db.delete(attachment._id)
  }

  const metadata = await getSessionMetadata(ctx, sessionId)
  await deleteStorageIfPresent(ctx, metadata.log)

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  const avatarIds = new Set(
    messages.flatMap((message) =>
      message.senderSnapshot?.avatarId ? [message.senderSnapshot.avatarId] : [],
    ),
  )

  for (const message of messages) {
    await deleteVersions(ctx, message._id)
    await ctx.db.delete(message._id)
  }

  await ctx.db.delete(sessionId)

  for (const avatarId of avatarIds) {
    await Avatars.removeIfUnreferenced(ctx, avatarId)
  }
}

export async function _patchEnvironment(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; environment: Record<string, unknown> },
) {
  await ctx.db.patch(args.sessionId, { environment: args.environment })
}

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
  await ctx.db.patch(args.sessionId, {
    workspace: args.workspace ?? undefined,
  })
}

export async function _patchLastRequestBody(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; storageId: Id<'_storage'> },
) {
  const metadata = await getSessionMetadata(ctx, args.sessionId)
  const next = { ...metadata, log: args.storageId }

  await ctx.db.patch(args.sessionId, {
    metadata: next,
  })
  if (metadata.log !== args.storageId) {
    await deleteStorageIfPresent(ctx, metadata.log)
  }
}

export async function _allowToolPaths(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; paths: string[] },
) {
  const session = await ctx.db.get(args.sessionId)
  if (!session) return

  const approvals = session.toolApprovals ?? {}
  const existing = approvals.paths ?? []
  const additions = args.paths.filter((path) => !isPathAllowed(path, existing))
  if (additions.length === 0) return

  await ctx.db.patch(args.sessionId, {
    toolApprovals: { ...approvals, paths: [...existing, ...additions] },
  })
}

export async function _patchLastResponseBody(
  ctx: MutationCtx,
  args: { sessionId: Id<'sessions'>; storageId: Id<'_storage'> },
) {
  const metadata = await getSessionMetadata(ctx, args.sessionId)
  const next = { ...metadata, log: args.storageId }

  await ctx.db.patch(args.sessionId, {
    metadata: next,
  })
  if (metadata.log !== args.storageId) {
    await deleteStorageIfPresent(ctx, metadata.log)
  }
}

async function requireOwnedAgent(ctx: AuthMutationCtx, agentId: Id<'agents'>) {
  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
  return agent
}

async function metadataForAgent(
  ctx: AuthMutationCtx,
  agentId: Id<'agents'> | undefined,
) {
  const model = await modelForAgent(ctx, agentId)
  return model ? { model } : undefined
}

async function modelForAgent(
  ctx: MutationCtx,
  agentId: Id<'agents'> | null | undefined,
) {
  if (!agentId) return undefined

  const agent = await ctx.db.get(agentId)
  if (!agent?.modelId) return undefined

  const settings = await getSettings(ctx, agent.ownerId)

  return (
    findModelEntry(settings?.modelProviders, agent.modelId) ?? {
      id: agent.modelId,
    }
  )
}

async function getSessionMetadata(ctx: MutationCtx, sessionId: Id<'sessions'>) {
  return (await ctx.db.get(sessionId))?.metadata ?? {}
}

async function deleteStorageIfPresent(
  ctx: MutationCtx,
  storageId: Id<'_storage'> | undefined,
) {
  if (storageId) await ctx.storage.delete(storageId).catch(() => {})
}

async function requireLinkedAgent(
  ctx: AuthMutationCtx,
  sessionId: { sessionId: Id<'sessions'> }['sessionId'],
  agentId: NonNullable<UpdateSessionArgs['activeAgentId']>,
) {
  const link = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId_agentId', (q) =>
      q.eq('sessionId', sessionId).eq('agentId', agentId),
    )
    .unique()

  if (!link) error('Agent is not linked to this session', 409)
}
