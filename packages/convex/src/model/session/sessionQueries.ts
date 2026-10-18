import { parseSessionSearch } from '@sb/core/session-search/parse'
import { toDisplayName } from '@sb/core/utils/names'

import type { Doc, Id } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { type AuthQueryCtx } from '../../functions'
import type {
  ListSessionsArgs,
  SessionListItem,
  SessionMode,
  SessionParticipant,
} from '../../types'
import { getByOwnerId as getSettings } from '../settings'
import { readFolderTrail } from './folderTree'
import { getMember } from './memberships'
import { sessionListQuery, sessionSearchMatcher } from './sessionSearch'
import { getApprovals, getState } from './state'

export async function list(
  ctx: AuthQueryCtx,
  args: ListSessionsArgs,
): Promise<{
  page: SessionListItem[]
  isDone: boolean
  continueCursor: string
}> {
  const { text, clauses } = parseSessionSearch(args.search ?? '')
  const query = sessionListQuery(ctx, args, text)
  const visible = args.showHidden
    ? query
    : query.filter((q) => q.neq(q.field('userHidden'), true))
  const result = await visible.paginate(args.paginationOpts)
  const matches = await sessionSearchMatcher(ctx, clauses)

  const page = await Promise.all(
    result.page.map(async (row) => {
      const session = await ctx.db.get(row.sessionId)
      if (!session || session.parent) return null
      return toListItem(ctx, session, row.userHidden, row.pinned, row.folderId)
    }),
  )

  return {
    ...result,
    page: page.filter(
      (item): item is SessionListItem => item !== null && matches(item),
    ),
  }
}

export async function toListItem(
  ctx: AuthQueryCtx,
  session: Doc<'sessions'>,
  userHidden?: boolean,
  pinned?: boolean,
  personalFolderId?: Id<'sessionFolders'>,
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

  const folderId =
    session.ownerId === ctx.userId ? session.folderId : personalFolderId

  const folder = folderId ? await ctx.db.get(folderId) : null

  const folderPath = folder
    ? (await readFolderTrail(ctx, folder._id, ctx.userId))
        .map((f) => f.name)
        .join(' / ')
    : undefined

  return {
    pinned: pinned || undefined,
    owned: session.ownerId === ctx.userId,
    folderId,
    folderName: folder?.name,
    folderPath,
    folderIcon: folder?.icon,
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
    toolApprovals: await getApprovals(ctx, sessionId),
    usage: state?.usage,
    hasLog: Boolean(state?.log),
  }
}

export async function getMode(
  ctx: QueryCtx,
  sessionId: Id<'sessions'>,
): Promise<SessionMode | null> {
  return (await ctx.db.get(sessionId))?.mode ?? null
}
