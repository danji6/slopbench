import { toDisplayName } from '@sb/core/utils/names'
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
import { injectModeNote, injectWorkspaceNote } from '../chat/notes'
import { deleteVersions } from '../messageContents'
import { demoteToDraft } from '../plans'
import { getByOwnerId as getSettings } from '../settings'
import { remove as removeStream, stopForSession } from '../stream/lifecycle'
import { syncTitle } from '../userSessions'
import {
  getMember,
  requireMember,
  requireNonBlockingStream,
  requireOwner,
} from './memberships'
import { resolveAgentModel } from './models'
import { appendApprovals, getApprovals, getState, patchState } from './state'

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
    model: await modelForAgent(ctx, args.activeAgentId),
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
        name: toDisplayName(settings?.displayName),
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

  return {
    _id: session._id,
    _creationTime: session._creationTime,
    title: session.title,
    activeAgentId: session.activeAgentId,
    lastMessageAt: session.lastMessageAt,
    lastMessagePreview: session.lastMessagePreview,
    firstMessagePreview: session.firstMessagePreview,
    participants,
    hidden: userHidden || undefined,
  }
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

  const log = (await getState(ctx, sessionId))?.log
  return { logUrl: log ? await ctx.storage.getUrl(log) : null }
}

/** The slice of a session's hot state the UI renders. */
export async function getStateView(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const member = await getMember(ctx, sessionId, ctx.userId)
  if (!member) return null

  const state = await getState(ctx, sessionId)
  return {
    toolApprovals: state?.toolApprovals,
    usage: state?.usage,
    hasLog: Boolean(state?.log),
  }
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
      ? { model: await modelForAgent(ctx, patch.activeAgentId) }
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
  const { session } = await requireMember(ctx, sessionId, ctx.userId)
  const next = mode === 'plan' ? mode : undefined
  await ctx.db.patch(sessionId, { mode: next })

  // Re-entering plan mode reopens an approved plan for revision
  if (mode === 'plan') await demoteToDraft(ctx, sessionId)

  await injectModeNote(ctx, { ...session, mode: next }, ctx.userId)
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

  // Read before the state row is deleted below
  const log = (await getState(ctx, sessionId))?.log

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
    'sessionState',
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

  await deleteStorageIfPresent(ctx, log)

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()

  const avatarIds = new Set(
    messages.flatMap((message) =>
      message.senderAvatarId ? [message.senderAvatarId] : [],
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
  await patchState(ctx, args.sessionId, { environment: args.environment })
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

  await appendApprovals(ctx, args.sessionId, 'paths', additions)
}

async function requireOwnedAgent(ctx: AuthMutationCtx, agentId: Id<'agents'>) {
  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
  return agent
}

async function modelForAgent(
  ctx: MutationCtx,
  agentId: Id<'agents'> | null | undefined,
) {
  if (!agentId) return undefined

  const agent = await ctx.db.get(agentId)
  if (!agent?.modelId) return undefined

  return resolveAgentModel(ctx, agent)
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
