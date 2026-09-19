'use node'

import { INJECTED_BLOCK_PREFIXES } from '@sb/convex/lib/workspace'
import type { UIMessage } from 'ai'

import type { Doc } from '../../_generated/dataModel'

export function representMessage(
  stored: Doc<'messages'>,
  agent: Doc<'agents'>,
  parts: UIMessage['parts'],
) {
  const isOtherAgent =
    !stored.hidden &&
    stored.sender.type === 'agent' &&
    stored.sender.id !== agent._id
  const role = agent.maskOtherAgents && isOtherAgent ? 'user' : stored.role

  if (role === 'user') {
    return {
      role,
      // User messages shouldn't carry reasoning/tool parts
      parts: parts.filter(
        (part) => part.type === 'text' || part.type === 'file',
      ),
    }
  }

  return { role: stored.role, parts }
}

export function prefixSenderName(
  message: UIMessage,
  stored: Doc<'messages'>,
  agent: Doc<'agents'>,
) {
  const senderName = stored.senderName
  if (!senderName || stored.hidden) return message.parts

  const shouldPrefix =
    (stored.sender.type === 'user' && agent.shareUserDisplayNames) ||
    (stored.sender.type === 'agent' &&
      stored.sender.id !== agent._id &&
      agent.shareAgentDisplayNames)
  if (!shouldPrefix) return message.parts

  // Skip injected context blocks so the actual user message is prefixed instead
  const index = message.parts.findIndex(
    (part) => part.type === 'text' && !isInjectedContextBlock(part.text),
  )
  if (index < 0) return message.parts

  return message.parts.map((part, partIndex) =>
    partIndex === index && part.type === 'text'
      ? { ...part, text: `${senderName}: ${part.text}` }
      : part,
  )
}

export function isInjectedContextBlock(text: string): boolean {
  return INJECTED_BLOCK_PREFIXES.some((prefix) => text.startsWith(prefix))
}
