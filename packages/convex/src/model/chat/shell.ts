import type { ShellToolOutput } from '@sb/core/types/tools'

import { internal } from '../../_generated/api'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error } from '../../errors'
import type { AuthMutationCtx } from '../../functions'
import { requireRole } from '../../functions'
import { sharedSessionId } from '../../lib/subagent'
import {
  SHELL_TOOL_PART_TYPE,
  type ShellToolPart,
  isShellToolPart,
} from '../../lib/userShell'
import {
  getSegmentRow,
  insertMessage,
  patchSegmentParts,
  setSegmentParts,
} from '../messageContents'
import { syncActivity } from '../messages'
import { notifyUserMessage } from '../notifications'
import * as Memberships from '../session/memberships'
import * as Settings from '../settings'
import { resolveSender } from './identities'
import { reserveOrDebounceTurn } from './reserve'

/** How long a user command can run. Currently forever. */
export const USER_SHELL_TIMEOUT_S = 0

/**
 * How long one runner action watches the job before handing it to a freshly
 * scheduled one and thus outlive the Convex action time limit.
 */
export const USER_SHELL_WINDOW_MS = 8 * 60 * 1000

/**
 * When the runner dies without settling the message, this frees the row from
 * `processing`, otherwise it'd become permanently unmutable.
 */
const USER_SHELL_REAP_MS = 15 * 60 * 1000

type RunShellCommandArgs = {
  session: Doc<'sessions'>
  membership: Doc<'userSessions'>
  settings: Doc<'settings'> | null
  command: string
  silent: boolean
  hasAttachments: boolean
}

/**
 * Records a user shell command as a shell tool call on the user's own message
 * and hands it to the runner action. The agent turn (if any) is reserved once
 * the command has finished so it can see the output.
 */
export async function runShellCommand(
  ctx: AuthMutationCtx,
  {
    session,
    membership,
    settings,
    command,
    silent,
    hasAttachments,
  }: RunShellCommandArgs,
) {
  requireRole(ctx.role, 'admin')
  if (!session.workspace) {
    error('A workspace is required to run shell commands', 409)
  }
  if (hasAttachments) {
    error('Shell commands cannot carry attachments', 400)
  }

  const part: ShellToolPart = {
    type: SHELL_TOOL_PART_TYPE,
    toolCallId: crypto.randomUUID(),
    state: 'input-available',
    input: { command },
  }

  const { sender, identity } = await resolveSender(ctx, {
    role: 'user',
    session,
    settings,
  })

  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: session._id,
      sender,
      role: 'user',
      ...identity,
      status: 'processing',
    },
    [part],
  )

  // The preview reads from text parts, which a command message has none of
  await syncActivity(ctx, session._id, [{ type: 'text', text: `$ ${command}` }])
  if (sender.type === 'user') {
    await notifyUserMessage(ctx, {
      sessionId: session._id,
      senderId: sender.id,
      actorName: identity.senderName ?? 'User',
      actorAvatarId: identity.senderAvatarId,
      preview: `$ ${command}`,
      sourceMessageId: messageId,
    })
  }
  await ctx.db.patch(membership._id, { lastSendAt: Date.now() })

  await ctx.scheduler.runAfter(0, internal.actions.userShell._run, {
    messageId,
    invokedBy: ctx.userId,
    silent,
  })
  await ctx.scheduler.runAfter(
    USER_SHELL_REAP_MS,
    internal.chat._reapUserShell,
    { messageId },
  )

  return messageId
}

/**
 * Claims the command for one runner window. Refreshes the heartbeat and returns
 * what the runner needs, including how to pick up a job a previous window left
 * running. Null once the message is gone or already settled.
 */
export async function _beginUserShellWindow(
  ctx: MutationCtx,
  { messageId }: { messageId: Id<'messages'> },
) {
  const message = await ctx.db.get(messageId)
  if (!message || message.status !== 'processing') return null

  const session = await ctx.db.get(message.sessionId)
  if (!session?.workspace) return null

  const row = await getSegmentRow(ctx, messageId, 1, 0)
  const part = row?.parts.find(isShellToolPart)
  if (!row || !part?.input?.command) return null

  await patchSegmentParts(
    ctx,
    messageId,
    row,
    mapShellPart(row.parts, part.toolCallId, (claimed) => ({
      ...claimed,
      heartbeatAt: Date.now(),
    })),
  )

  const sender =
    message.sender.type === 'user'
      ? await Settings.getByOwnerId(ctx, message.sender.id)
      : null

  const output = part.output
  return {
    sessionId: sharedSessionId(session),
    owner: messageId, // guards against agent turn abort
    messageId,
    workspaceId: session.workspace.workspaceId,
    shell: sender?.shell || undefined,
    command: part.input.command,
    toolCallId: part.toolCallId,
    startedAt: message._creationTime,
    ...(output?.jobId && {
      resume: {
        jobId: output.jobId,
        term: output.term,
        termOffset: output.termOffset,
      },
    }),
  }
}

type PatchArgs = {
  messageId: Id<'messages'>
  toolCallId: string
  output: ShellToolOutput
}

/** Streams the running job's output. False when the message is gone. */
export async function _patchUserShell(
  ctx: MutationCtx,
  { messageId, toolCallId, output }: PatchArgs,
) {
  const message = await ctx.db.get(messageId)
  if (!message || message.status !== 'processing') return false

  const row = await getSegmentRow(ctx, messageId, 1, 0)
  if (!row) return false

  await patchSegmentParts(
    ctx,
    messageId,
    row,
    mapShellPart(row.parts, toolCallId, (part) =>
      settleShellPart(part, { output, preliminary: true }),
    ),
  )
  return true
}

type FinishArgs = {
  messageId: Id<'messages'>
  toolCallId: string
  invokedBy: Id<'users'>
  silent: boolean
  duration: number
  output?: ShellToolOutput
  errorText?: string
}

/** Settles the command and hands the turn back to the agent. */
export async function _finishUserShell(
  ctx: MutationCtx,
  {
    messageId,
    toolCallId,
    invokedBy,
    silent,
    duration,
    output,
    errorText,
  }: FinishArgs,
) {
  const message = await ctx.db.get(messageId)
  if (!message) return

  const row = await getSegmentRow(ctx, messageId, 1, 0)
  if (row) {
    await setSegmentParts(
      ctx,
      message,
      row,
      mapShellPart(row.parts, toolCallId, (part) =>
        settleShellPart(part, { output, errorText }),
      ),
    )
  }

  await ctx.db.patch(messageId, {
    status: 'done',
    metadata: { ...message.metadata, duration },
  })

  const session = await ctx.db.get(message.sessionId)
  if (!session) return

  await reserveOrDebounceTurn(ctx, {
    session,
    messageId,
    invokedBy,
    silent,
    activeStream: await Memberships.getActiveStream(ctx, session._id),
  })
}

/** Releases a message whose runner never reported back. */
export async function _reapUserShell(
  ctx: MutationCtx,
  { messageId }: { messageId: Id<'messages'> },
) {
  const message = await ctx.db.get(messageId)
  if (!message || message.status !== 'processing') return

  const row = await getSegmentRow(ctx, messageId, 1, 0)
  const heartbeatAt =
    row?.parts.find(isShellToolPart)?.heartbeatAt ?? message._creationTime
  const idleFor = Date.now() - heartbeatAt

  // A stale heartbeat is the one thing that means nobody is watching anymore
  if (idleFor < USER_SHELL_REAP_MS) {
    await ctx.scheduler.runAfter(
      USER_SHELL_REAP_MS - idleFor,
      internal.chat._reapUserShell,
      { messageId },
    )
    return
  }

  if (row) {
    await setSegmentParts(
      ctx,
      message,
      row,
      row.parts.map((part) =>
        isShellToolPart(part) && !isSettledShellPart(part)
          ? settleShellPart(part, { errorText: 'The command did not finish.' })
          : part,
      ),
    )
  }

  await ctx.db.patch(messageId, { status: 'done' })
}

function mapShellPart(
  parts: unknown[],
  toolCallId: string,
  settle: (part: ShellToolPart) => ShellToolPart,
) {
  return parts.map((part) =>
    isShellToolPart(part) && part.toolCallId === toolCallId
      ? settle(part)
      : part,
  )
}

type ShellPartPatch = {
  output?: ShellToolOutput
  errorText?: string
  preliminary?: boolean
}

/** Rebuilds the part, dropping the flags that only apply while it runs. */
function settleShellPart(
  part: ShellToolPart,
  { output, errorText, preliminary }: ShellPartPatch,
): ShellToolPart {
  const {
    output: _output,
    errorText: _errorText,
    preliminary: _preliminary,
    heartbeatAt,
    ...base
  } = part

  if (errorText) return { ...base, state: 'output-error', errorText }

  return {
    ...base,
    state: 'output-available',
    output,
    ...(preliminary && {
      preliminary: true,
      ...(heartbeatAt !== undefined && { heartbeatAt }),
    }),
  }
}

function isSettledShellPart(part: ShellToolPart): boolean {
  if (part.state === 'output-error') return true
  return part.state === 'output-available' && !part.preliminary
}
