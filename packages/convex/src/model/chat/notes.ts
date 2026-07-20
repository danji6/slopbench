import type { MessageRole } from '@sb/core/types'
import { systemReminder } from '@sb/core/utils/blocks'

import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { MessageExtra } from '../../types'
import { insertMessage } from '../messageContents'
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
  const body = next
    ? [
        `The workspace is now "${next.label}" (${next.path}).`,
        previous
          ? `It was previously "${previous.label}" (${previous.path}). ` +
            'Paths you resolved earlier no longer apply.'
          : 'File and shell tools now operate on this workspace.',
        'Re-read any file you need instead of relying on earlier reads.',
      ]
    : [
        previous
          ? `The workspace "${previous.label}" (${previous.path}) was unbound.`
          : 'The workspace was unbound.',
        'File and shell tools have nothing to operate on until one is bound.',
      ]

  return systemReminder(...body)
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
