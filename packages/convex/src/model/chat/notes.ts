import { PLAN_TOOL_TOGGLE } from '@sb/core/const'
import type { MessageRole } from '@sb/core/types'
import { systemReminder } from '@sb/core/utils/blocks'
import { inline } from '@sb/core/utils/strings'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { MessageExtra, SessionMode } from '../../types'
import { deleteVersions, insertMessage } from '../messageContents'
import { scheduleMessageEval } from '../messages'
import { getByOwnerId as getSettingsByOwnerId } from '../settings'
import { agentSenderSnapshot } from './identities'

export type NoteSender = {
  agent: Doc<'agents'>
  senderSnapshot: ReturnType<typeof agentSenderSnapshot>
}

export type HiddenNote = {
  type: NonNullable<Doc<'messages'>['type']>
  role: MessageRole
  content: string
  extra?: unknown
}

/** Resolves the session's active agent as the sender of injected notes. */
export async function resolveNoteSender(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
): Promise<NoteSender | null> {
  if (!session.activeAgentId) return null

  const agent = await ctx.db.get(session.activeAgentId)
  if (!agent) return null

  const settings = await getSettingsByOwnerId(ctx, agent.ownerId)
  return { agent, senderSnapshot: agentSenderSnapshot(agent, settings) }
}

/**
 * Persists a note the agent reads as history but the user only sees as a chip.
 * Call before inserting the triggering message or computing a fresh boundary.
 */
export async function insertHiddenNote(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokerId: Id<'users'>,
  sender: NoteSender,
  note: HiddenNote,
) {
  const parts = [{ type: 'text', text: note.content }]
  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: session._id,
      sender: { type: 'agent', id: sender.agent._id },
      role: note.role,
      senderSnapshot: sender.senderSnapshot,
      status: 'done',
      type: note.type,
      hidden: true,
      extra: note.extra,
    },
    parts,
  )
  await scheduleMessageEval(ctx, {
    messageId,
    invokerId,
    parts,
    version: 1,
    segmentIndex: 0,
  })
}

export type ModeNoteAudience = {
  /** The agent has planning tools enabled. */
  planTools: boolean
  /** The session is a delegated sub-agent session. */
  subagent: boolean
}

// TODO make these user-configurable
export function modeNoteBody(
  mode: SessionMode,
  { planTools, subagent }: ModeNoteAudience,
): string[] {
  if (mode !== 'plan') {
    return [
      'Plan mode is no longer active.',
      'Read-only restrictions are lifted and all of your tools are available again.',
    ]
  }

  if (!planTools) {
    return [
      inline`Plan mode is now active. You CANNOT make any changes: no file writes,
        no edits, no mutating commands.`,
      '',
      '- Research the request with the read-only tools available to you.',
      '- Report what you found and what you would do in your reply.',
    ]
  }

  if (subagent) {
    return [
      inline`Plan mode is now active for this delegated task. You CANNOT make any
        changes: no file writes, no edits, no mutating commands.`,
      '',
      '- Explore using the available read-only tools and commands.',
      inline`- The session plan is shared with the delegating agent. Contribute to it
        with the write_plan and edit_plan tools when your task calls for it.`,
      inline`- You cannot exit plan mode or present the plan for approval. When done,
        write your findings as your final message. It is returned to the delegating
        agent as your report.`,
    ]
  }

  return [
    inline`Plan mode is now active. You CANNOT make any changes: no file writes,
      no edits, no mutating commands.`,
    '',
    '- Explore using the available read-only tools and commands.',
    inline`- Author the plan with the write_plan tool, and refine specific sections
      with edit_plan as your understanding deepens. Keep the plan concise, concrete,
      and actionable: context, approach, steps, critical files, verification.`,
    inline`- When the plan is ready, call exit_plan_mode to present it for approval.
      If approval is denied, keep researching and refining the plan.`,
  ]
}

export function buildModeNoteContent(
  mode: SessionMode,
  audience: ModeNoteAudience,
) {
  return systemReminder(...modeNoteBody(mode, audience))
}

type ModeTransition = MessageExtra['mode']

export type ModeAnnouncement = {
  remove: boolean
  insert: ModeTransition | null
}

/**
 * Decides what the transcript tail should say about the session mode.
 * A trailing chip nobody consumed is rewritten instead of stacked.
 */
export function decideModeNote({
  next,
  announced,
  trailing,
}: {
  next: SessionMode
  announced: SessionMode
  trailing?: ModeTransition
}): ModeAnnouncement {
  if (trailing) {
    if (trailing.to === next) return { remove: false, insert: null }
    return trailing.from === next
      ? { remove: true, insert: null }
      : { remove: true, insert: { from: trailing.from, to: next } }
  }

  return announced === next
    ? { remove: false, insert: null }
    : { remove: false, insert: { from: announced, to: next } }
}

/**
 * Announces the session mode to the agent when it effectively changes.
 * Call before inserting the triggering message or computing a fresh boundary.
 */
export async function injectModeNote(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokerId: Id<'users'>,
) {
  const next = session.mode ?? 'normal'
  const announced = session.announcedMode ?? 'normal'
  if (announced === next) return

  const trailing = await trailingModeNote(ctx, session._id)

  const { remove, insert } = decideModeNote({
    next,
    announced,
    trailing: trailing?.extra as ModeTransition | undefined,
  })
  if (!remove && !insert) return

  // If the sender is missing, leave announcedMode stale and defer to a later turn
  const sender = insert ? await resolveNoteSender(ctx, session) : null
  if (insert && !sender) return

  if (trailing && remove) {
    await deleteVersions(ctx, trailing._id)
    await ctx.db.delete(trailing._id)
  }

  if (insert && sender) {
    const tools = sender.agent.tools
    await insertHiddenNote(ctx, session, invokerId, sender, {
      type: 'mode',
      role: 'system',
      content: buildModeNoteContent(next, {
        planTools: Array.isArray(tools) && tools.includes(PLAN_TOOL_TOGGLE),
        subagent: !!session.parent,
      }),
      extra: insert satisfies MessageExtra['mode'],
    })
  }

  await ctx.db.patch(session._id, { announcedMode: next })
}

/** Marks the mode as unannounced so the next turn states it again. */
export async function clearAnnouncedMode(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
) {
  await ctx.db.patch(sessionId, { announcedMode: undefined })
}

/** The newest message, when it is a mode chip nothing has answered yet. */
async function trailingModeNote(ctx: MutationCtx, sessionId: Id<'sessions'>) {
  const newest = await ctx.db
    .query('messages')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .order('desc')
    .first()

  return newest?.type === 'mode' ? newest : null
}

type Workspace = Doc<'sessions'>['workspace']

/**
 * The sidecar keeps one workspaceId per session and re-points its root on a
 * re-bind, so the path (not the id) is what identifies a workspace here.
 */
export function workspaceChanged(previous: Workspace, next: Workspace) {
  return previous?.path !== next?.path
}

export function buildWorkspaceNoteContent(
  previous: Workspace,
  next: Workspace,
) {
  return systemReminder(...workspaceNoteBody(previous, next))
}

function workspaceNoteBody(previous: Workspace, next: Workspace): string[] {
  if (!next) {
    return [
      previous
        ? `The workspace "${previous.label}" (${previous.path}) was unbound.`
        : 'The workspace was unbound.',
      'File and shell tools have nothing to operate on until one is bound.',
    ]
  }

  if (!previous) {
    return [
      `The workspace "${next.label}" (${next.path}) is bound.`,
      'File and shell tools operate on this workspace.',
    ]
  }

  return [
    `The workspace is now "${next.label}" (${next.path}).`,
    `It was previously "${previous.label}" (${previous.path}). ` +
      'Paths you resolved earlier no longer apply.',
    'Re-read any file you need instead of relying on earlier reads.',
  ]
}

/** Tells the agent its workspace moved. */
export async function injectWorkspaceNote(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  next: Workspace,
) {
  const previous = session.workspace
  if (!workspaceChanged(previous, next)) return

  const sender = await resolveNoteSender(ctx, session)
  if (!sender) return

  await insertHiddenNote(ctx, session, session.ownerId, sender, {
    type: 'workspace',
    role: 'system',
    content: buildWorkspaceNoteContent(previous, next),
    extra: { label: next?.label } satisfies MessageExtra['workspace'],
  })
}
