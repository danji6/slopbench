'use node'

import { READ_ATTACHMENT_TOOL_NAME } from '@sb/core/const'
import { block } from '@sb/core/utils/blocks'
import { settleUnansweredToolParts } from '@sb/core/utils/tool-parts'
import type { UIMessage } from 'ai'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { trimContextToThreshold } from '../../model/context'
import { buildPrompts } from '../../model/prompt/prompts'
import type { MessageRole, StreamContext } from '../../types'
import { activeAttachmentMessages } from './attachmentHistory'
import { collectApprovalNotes } from './historyApprovals'
import { insertApprovalNoteMessages } from './historyApprovals'
import { resolveParts } from './historyContent'
import { representMessage } from './historySenders'
import { prefixSenderName } from './historySenders'
import { removeOrphanToolCalls } from './historyTools'

export { collectApprovalNotes } from './historyApprovals'
export { collectRespondedApprovalNotes } from './historyApprovals'
export { insertApprovalNoteMessages } from './historyApprovals'
export { removeOrphanToolCalls } from './historyTools'
export { representMessage } from './historySenders'
export { prefixSenderName } from './historySenders'

export async function buildProviderHistory(
  ctx: ActionCtx,
  data: StreamContext,
  remainingPrompts: Parameters<typeof buildPrompts>[0],
) {
  const history = await ctx.runQuery(internal.streams._getProviderHistory, {
    streamId: data.stream._id,
  })
  const activeMediaMessages = activeAttachmentMessages(
    history,
    data.stream.omitActiveMedia
      ? undefined
      : data.stream.contextBoundaryMessageId,
  )
  const readerEnabled = (
    data.sessionCache?.tools?.names ??
    data.agent.tools ??
    []
  ).includes(READ_ATTACHMENT_TOOL_NAME)

  const messages: UIMessage[] = []
  for (const message of history) {
    const { role, parts } = representMessage(
      message,
      data.agent,
      await resolveParts(ctx, message.parts, data.session, message.role, {
        mediaActive: activeMediaMessages.has(message._id),
        readerEnabled,
        toolMediaActive:
          !data.stream.omitActiveMedia &&
          message._id === data.stream.processingMessageId,
      }),
    )
    messages.push({
      id: message._id,
      role: role as MessageRole,
      parts:
        message._id === data.stream.processingMessageId
          ? parts
          : (settleUnansweredToolParts(parts) as UIMessage['parts']),
    })
  }

  const attributed = messages.map((message, index) => ({
    ...message,
    parts: prefixSenderName(message, history[index], data.agent),
  }))
  const approvalNotes = collectApprovalNotes(attributed)

  const [
    { convertToModelMessages },
    { shellHistoryTools },
    { attachmentHistoryTools },
  ] = await Promise.all([
    import('ai'),
    import('../../model/tool/shell'),
    import('../../model/tool/attachments'),
  ])

  let modelMessages = await convertToModelMessages(attributed, {
    ignoreIncompleteToolCalls: true,
    // Maps shell outputs so replayed history never contains terminal scrollback
    tools: { ...shellHistoryTools(), ...attachmentHistoryTools() },
  })
  modelMessages = removeOrphanToolCalls(modelMessages)
  modelMessages = insertApprovalNoteMessages(modelMessages, approvalNotes)
  if (data.stream.omitActiveMedia) {
    modelMessages.push({
      role: 'system',
      content: block(
        'attachment-error',
        'The provider rejected the active media payload as too large. Continue without it; its attachment link remains available.',
      ),
    })
  }
  modelMessages = buildPrompts(
    remainingPrompts,
    modelMessages,
    (value) => value,
  )

  const { trimContext, contextWindow } = data.agent

  return trimContext && (contextWindow ?? 0) > 0
    ? await trimContextToThreshold(modelMessages, undefined, contextWindow!)
    : modelMessages
}
