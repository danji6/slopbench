import { toDisplayName } from '@sb/core/utils/names'
import type { PaginationOptions } from 'convex/server'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { error } from '../../errors'
import {
  type AuthMutationCtx,
  type AuthQueryCtx,
  findUserBySubject,
  requireRole,
} from '../../functions'
import { foldPaths, isPathAllowed } from '../../lib/tool/approval'
import type {
  ApprovalMode,
  SessionListItem,
  SessionMode,
  SessionParticipant,
  UpdateSessionArgs,
} from '../../types'
import * as Attachments from '../attachments'
import * as Avatars from '../avatars'
import { injectModeNote, injectWorkspaceNote } from '../chat/notes'
import { deleteVersions, insertMessage, withParts } from '../messageContents'
import { finalizeMessageParts, notACommandChip } from '../messages'
import {
  demoteToDraft,
  getBySession as getPlan,
  upsert as upsertPlan,
} from '../plans'
import {
  ensureForUser as ensureSettingsForUser,
  getByOwnerId as getSettings,
} from '../settings'
import { remove as removeStream, stopForSession } from '../stream/lifecycle'
import { syncTitle } from '../userSessions'
import {
  getActiveStream,
  getMember,
  requireMember,
  requireNonBlockingStream,
  requireOwner,
} from './memberships'
import { resolveSessionModel } from './models'
import {
  getApprovals,
  getState,
  patchState,
  setApprovals,
  setApprovalMode as setStateApprovalMode,
} from './state'

export async function create(
  ctx: AuthMutationCtx,
  args: {
    title?: string
    activeAgentId?: Id<'agents'>
    mode?: SessionMode
    approvalMode?: ApprovalMode
  },
) {
  if (args.approvalMode === 'unrestricted') requireRole(ctx.role, 'admin')
  const activeAgent = args.activeAgentId
    ? await requireOwnedAgent(ctx, args.activeAgentId)
    : null
  const settings = await getSettings(ctx, ctx.userId)

  const now = Date.now()
  const sessionId = await ctx.db.insert('sessions', {
    ownerId: ctx.userId,
    title: args.title,
    activeAgentId: args.activeAgentId,
    model: await resolveSessionModel(
      ctx,
      activeAgent?.ownerId ?? ctx.userId,
      settings?.recentModel,
    ),
    reasoningEffort: settings?.recentReasoning,
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

  if (args.approvalMode === 'unrestricted') {
    await setStateApprovalMode(ctx, sessionId, args.approvalMode)
  }

  return { sessionId }
}

/**
 * Deep copies a conversation into a fresh session owned by the caller.
 * What carries over:
 * - Message history (without versioning)
 * - Linked agents
 * - Bound workspace (if called from api.actions.sessions.duplicate)
 * - Plan
 * - Environment variables
 * - Media
 *
 * Blobs are shared by reference with the source, which is safe because
 * attachment removal is refcount-aware. Large offloaded tool outputs keep
 * pointing at the source's blob and fall back to their preview if the source
 * deletes them.
 */
export async function duplicate(
  ctx: AuthMutationCtx,
  { sessionId, title }: { sessionId: Id<'sessions'>; title?: string },
) {
  const { session } = await requireOwner(ctx, sessionId, ctx.userId)
  if (session.parent) error('Sub-agent sessions cannot be duplicated', 409)
  if (await getActiveStream(ctx, sessionId)) {
    error('Session is busy', 409)
  }

  const now = Date.now()
  const baseTitle =
    title?.trim() || session.title || session.firstMessagePreview || 'New chat'
  const newTitle = `${baseTitle} (copy)`

  const newSessionId = await ctx.db.insert('sessions', {
    ownerId: ctx.userId,
    title: newTitle,
    activeAgentId: session.activeAgentId,
    ...(session.model ? { model: session.model } : {}),
    reasoningEffort: session.reasoningEffort,
    mode: session.mode,
    announcedMode: session.announcedMode,
    // A copy starts enabled even when its source was disabled
    settings: session.settings
      ? { ...session.settings, disabled: undefined }
      : undefined,
    lastMessageAt: now,
    lastMessagePreview: session.lastMessagePreview,
    firstMessagePreview: session.firstMessagePreview,
  })

  await ctx.db.insert('userSessions', {
    sessionId: newSessionId,
    userId: ctx.userId,
    role: 'owner',
    lastMessageAt: now,
    title: newTitle,
  })

  const links = await ctx.db
    .query('sessionAgents')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  for (const link of links) {
    await ctx.db.insert('sessionAgents', {
      sessionId: newSessionId,
      agentId: link.agentId,
      addedBy: ctx.userId,
    })
  }

  const plan = await getPlan(ctx, sessionId)
  if (plan) {
    await upsertPlan(ctx, newSessionId, plan.content, {
      status: plan.status,
      dirty: plan.dirty,
    })
  }

  const state = await getState(ctx, sessionId)
  if (state?.environment) {
    await patchState(ctx, newSessionId, { environment: state.environment })
  }

  const messages = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .filter(notACommandChip)
    .order('asc')
    .collect()

  const copied = messages.filter((message) => message.status !== 'processing')
  const partsByMessage = new Map<Id<'messages'>, unknown[]>()
  const referencedAttachmentIds = new Set<string>()
  for (const message of copied) {
    const { parts } = await withParts(ctx, message)
    partsByMessage.set(message._id, parts)
    for (const id of Attachments.referencedAttachmentIds(parts)) {
      referencedAttachmentIds.add(id)
    }
  }

  const oldAttachments = await ctx.db
    .query('attachments')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .collect()
  const attachmentMap = new Map<Id<'attachments'>, Id<'attachments'>>()
  for (const attachment of oldAttachments) {
    if (!referencedAttachmentIds.has(attachment._id)) continue
    const copyId = await ctx.db.insert('attachments', {
      storageId: attachment.storageId,
      previewStorageId: attachment.previewStorageId,
      uploaderId: attachment.uploaderId,
      sessionId: newSessionId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
    })
    attachmentMap.set(attachment._id, copyId)
  }

  const attachmentCopyByMessage = new Map<Id<'messages'>, Id<'attachments'>>()
  for (const attachment of oldAttachments) {
    const copyId = attachmentMap.get(attachment._id)
    if (attachment.messageId && copyId) {
      attachmentCopyByMessage.set(attachment.messageId, copyId)
    }
  }

  const messageIdMap = new Map<Id<'messages'>, Id<'messages'>>()
  for (const message of copied) {
    const parts = Attachments.remapPartAttachmentIds(
      partsByMessage.get(message._id) ?? [],
      attachmentMap,
    )

    const { messageId } = await insertMessage(
      ctx,
      {
        sessionId: newSessionId,
        sender: message.sender,
        role: message.role,
        type: message.type,
        status: 'done',
        hidden: message.hidden,
        extra: message.extra,
        metadata: message.metadata,
        senderName: message.senderName,
        senderAvatarId: message.senderAvatarId,
        appearanceId: message.appearanceId,
      },
      finalizeMessageParts(parts),
    )
    messageIdMap.set(message._id, messageId)
  }

  for (const [oldId, newId] of messageIdMap) {
    const copyId = attachmentCopyByMessage.get(oldId)
    if (copyId) await ctx.db.patch(copyId, { messageId: newId })
  }

  return { sessionId: newSessionId }
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
    'typing',
    'shellJobs',
    'notifications',
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

  // Blobs other sessions (e.g. duplicates) still reference
  const sharedBlobs = await Attachments.foreignStorageIds(ctx, sessionId)

  for (const attachment of attachments) {
    await Attachments.removeAttachment(ctx, attachment, sharedBlobs)
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

  const paths = foldPaths([...existing, ...additions])
  await setApprovals(ctx, args.sessionId, 'paths', paths)
}

async function requireOwnedAgent(ctx: AuthMutationCtx, agentId: Id<'agents'>) {
  const agent = await ctx.db.get(agentId)
  if (!agent || agent.ownerId !== ctx.userId) error('Not found', 404)
  return agent
}

async function requireActiveAgentOwner(
  ctx: AuthMutationCtx,
  sessionId: Id<'sessions'>,
) {
  const { session } = await requireMember(ctx, sessionId, ctx.userId)
  if (!session.activeAgentId) error('No active agent', 409)

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) error('Agent not found', 404)
  if (agent.ownerId !== ctx.userId) error('Forbidden', 403)
  return agent
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
