import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { CommandName, CommandStatus, MessageExtra } from '../../types'
import { insertMessage } from '../messageContents'

export type CommandInvocation = {
  name: CommandName
  argument?: string
}

/** Inserts the hidden message representing a command. */
export async function insertCommandChip(
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

/** Updates a command chip. */
export async function markCommandChip(
  ctx: MutationCtx,
  messageId: Id<'messages'>,
  status: CommandStatus,
  detail?: string,
) {
  const message = await ctx.db.get(messageId)
  const extra = message?.extra as MessageExtra['command'] | undefined
  if (!extra) return

  await ctx.db.patch(messageId, {
    extra: {
      name: extra.name,
      ...(extra.argument !== undefined ? { argument: extra.argument } : {}),
      status,
      ...(status === 'failed' && detail ? { error: detail } : {}),
      ...(status === 'cancelled' && detail ? { reason: detail } : {}),
    },
  })
}
