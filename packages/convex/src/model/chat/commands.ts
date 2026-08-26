import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { error, sanitizeChatError } from '../../errors'
import type { AuthMutationCtx, AuthQueryCtx } from '../../functions'
import type {
  CommandName,
  CommandStatus,
  MessageExtra,
  QueuedCommand,
} from '../../types'
import { insertMessage } from '../messageContents'
import * as Memberships from '../session/memberships'
import { getState, patchState } from '../session/state'
import { executeEval } from './controls'
import { executeCompact, executeImpersonate, executeResume } from './send'

/** How many commands a session may keep waiting for an idle moment. */
const MAX_QUEUED_COMMANDS = 10

type CommandInvocation = {
  name: CommandName
  argument?: string
  requestId?: string
}

export function compact(
  ctx: AuthMutationCtx,
  {
    sessionId,
    extraInstructions,
  }: { sessionId: Id<'sessions'>; extraInstructions?: string },
) {
  return invokeCommand(ctx, sessionId, {
    name: 'compact',
    argument: extraInstructions,
  })
}

export function impersonate(
  ctx: AuthMutationCtx,
  {
    sessionId,
    extraInstructions,
  }: { sessionId: Id<'sessions'>; extraInstructions?: string },
) {
  return invokeCommand(ctx, sessionId, {
    name: 'impersonate',
    argument: extraInstructions,
  })
}

export function resumeAgentMessage(
  ctx: AuthMutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  return invokeCommand(ctx, sessionId, { name: 'resume' })
}

export function resetSessionCache(
  ctx: AuthMutationCtx,
  { sessionId, requestId }: { sessionId: Id<'sessions'>; requestId?: string },
) {
  return invokeCommand(ctx, sessionId, { name: 'eval', requestId })
}

/** Whether the caller's requested command is still waiting to run. */
export async function isCommandQueued(
  ctx: AuthQueryCtx,
  { sessionId, requestId }: { sessionId: Id<'sessions'>; requestId: string },
) {
  await Memberships.requireMember(ctx, sessionId, ctx.userId)
  const queue = (await getState(ctx, sessionId))?.commandQueue ?? []

  return queue.some(
    (entry) => entry.invokedBy === ctx.userId && entry.requestId === requestId,
  )
}

/** Runs a command, or defers it to the next idle moment when the agent is busy. */
async function invokeCommand(
  ctx: AuthMutationCtx,
  sessionId: Id<'sessions'>,
  command: CommandInvocation,
) {
  const { session } = await Memberships.requireMember(
    ctx,
    sessionId,
    ctx.userId,
  )
  Memberships.requireEnabled(session)

  const queue = (await getState(ctx, sessionId))?.commandQueue ?? []
  const defer = Boolean(await Memberships.getActiveStream(ctx, sessionId))
  if (defer && queue.length >= MAX_QUEUED_COMMANDS) {
    error('Too many commands are already waiting', 409)
  }

  const messageId = commandCreatesMessage(command.name)
    ? await insertCommandChip(
        ctx,
        session,
        ctx.userId,
        command,
        defer ? 'queued' : 'ran',
      )
    : undefined
  const entry: QueuedCommand = {
    ...command,
    invokedBy: ctx.userId,
    ...(messageId && { messageId }),
  }

  if (defer) {
    await patchState(ctx, sessionId, { commandQueue: [...queue, entry] })
    return { queued: true }
  }

  await executeCommand(ctx, session, entry)
  return { queued: false }
}

/** Whether the command creates a new message after its invocation boundary. */
function commandCreatesMessage(name: CommandName) {
  return name === 'compact' || name === 'impersonate'
}

/** Runs everything that has been waiting, until the session gets busy again. */
export async function drainCommandQueue(
  ctx: MutationCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  const session = await ctx.db.get(sessionId)
  if (!session) return

  let queue = (await getState(ctx, sessionId))?.commandQueue ?? []
  while (queue.length > 0) {
    if (await Memberships.getActiveStream(ctx, sessionId)) break

    const [entry, ...rest] = queue
    queue = rest
    // A command that fails is not retried forever
    await patchState(ctx, sessionId, { commandQueue: queue })
    await runQueuedCommand(ctx, session, entry)
  }
}

async function runQueuedCommand(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  entry: QueuedCommand,
) {
  // Deleting a visible chip is how the user cancels its waiting command
  if (entry.messageId && !(await ctx.db.get(entry.messageId))) return

  try {
    await executeCommand(ctx, session, entry)
    if (entry.messageId) await markChip(ctx, entry.messageId, 'ran')
  } catch (err) {
    if (entry.messageId) {
      await markChip(ctx, entry.messageId, 'failed', sanitizeChatError(err))
    }
  }
}

function executeCommand(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  { name, argument, invokedBy }: QueuedCommand,
) {
  switch (name) {
    case 'compact':
      return executeCompact(ctx, session, invokedBy, argument)
    case 'impersonate':
      return executeImpersonate(ctx, session, invokedBy, argument)
    case 'resume':
      return executeResume(ctx, session, invokedBy)
    case 'eval':
      return executeEval(ctx, session)
  }
}

/**
 * Announces a command as a hidden, part-less message. Carrying no parts keeps
 * it out of the model's context while the user still sees it as a chip.
 */
async function insertCommandChip(
  ctx: MutationCtx,
  session: Doc<'sessions'>,
  invokedBy: Id<'users'>,
  command: CommandInvocation,
  status: CommandStatus,
) {
  const { messageId } = await insertMessage(
    ctx,
    {
      sessionId: session._id,
      sender: { type: 'user', id: invokedBy },
      role: 'user',
      status: 'done',
      type: 'command',
      hidden: true,
      extra: {
        name: command.name,
        argument: command.argument,
        status,
      } satisfies MessageExtra['command'],
    },
    [],
  )

  return messageId
}

async function markChip(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
  status: CommandStatus,
  failure?: string,
) {
  const message = await ctx.db.get(messageId)
  const extra = message?.extra as MessageExtra['command'] | undefined
  if (!extra) return

  await ctx.db.patch(messageId, {
    extra: { ...extra, status, ...(failure && { error: failure }) },
  })
}
