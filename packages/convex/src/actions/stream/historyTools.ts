'use node'

import type { ModelMessage } from 'ai'

export function removeOrphanToolCalls(
  messages: ModelMessage[],
): ModelMessage[] {
  const sanitized: ModelMessage[] = []
  let segment: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'assistant' || message.role === 'tool') {
      segment.push(message)
      continue
    }

    sanitized.push(...sanitizeToolSegment(segment), message)
    segment = []
  }

  sanitized.push(...sanitizeToolSegment(segment))
  return sanitized
}

export function sanitizeToolSegment(segment: ModelMessage[]): ModelMessage[] {
  if (segment.length === 0) return []

  const keptCallIds = new Set<string>()
  const keptApprovalIds = new Set<string>()

  const normalized = segment
    .map((message, index): ModelMessage | null => {
      if (message.role === 'assistant') {
        if (typeof message.content === 'string') return message

        const futureResultIds = collectFutureToolResultIds(segment, index)
        const futureApprovalIds = collectFutureApprovalResponseIds(
          segment,
          index,
        )
        const removedCallIds = new Set<string>()

        const content = message.content.filter((part) => {
          if (part.type !== 'tool-call' || part.providerExecuted) return true
          if (
            futureResultIds.has(part.toolCallId) ||
            hasFutureApprovalResponse(
              message.content,
              part.toolCallId,
              futureApprovalIds,
            )
          ) {
            keptCallIds.add(part.toolCallId)
            return true
          }
          removedCallIds.add(part.toolCallId)
          return false
        })

        const withoutRemovedApprovals = content.filter((part) => {
          if (part.type !== 'tool-approval-request') return true
          if (removedCallIds.has(part.toolCallId)) return false
          keptApprovalIds.add(part.approvalId)
          return true
        })

        return withoutRemovedApprovals.length > 0
          ? { ...message, content: withoutRemovedApprovals }
          : null
      }

      if (message.role !== 'tool') return message

      const content = message.content.filter((part) => {
        if (part.type === 'tool-result') {
          return keptCallIds.has(part.toolCallId)
        }
        if (part.type === 'tool-approval-response') {
          return keptApprovalIds.has(part.approvalId)
        }
        return true
      })

      return content.length > 0 ? { ...message, content } : null
    })
    .filter((message): message is ModelMessage => message !== null)

  return normalized
}

export function collectFutureToolResultIds(
  segment: ModelMessage[],
  startIndex: number,
): Set<string> {
  const resultIds = new Set<string>()

  for (let index = startIndex + 1; index < segment.length; index++) {
    const message = segment[index]
    if (message.role !== 'tool') continue

    for (const part of message.content) {
      if (part.type === 'tool-result') resultIds.add(part.toolCallId)
    }
  }

  return resultIds
}

export function collectFutureApprovalResponseIds(
  segment: ModelMessage[],
  startIndex: number,
): Set<string> {
  const approvalIds = new Set<string>()

  for (let index = startIndex + 1; index < segment.length; index++) {
    const message = segment[index]
    if (message.role !== 'tool') continue

    for (const part of message.content) {
      if (part.type === 'tool-approval-response') {
        approvalIds.add(part.approvalId)
      }
    }
  }

  return approvalIds
}

export function hasFutureApprovalResponse(
  content: Extract<ModelMessage, { role: 'assistant' }>['content'],
  toolCallId: string,
  futureApprovalIds: Set<string>,
): boolean {
  if (typeof content === 'string') return false

  return content.some(
    (part) =>
      part.type === 'tool-approval-request' &&
      part.toolCallId === toolCallId &&
      futureApprovalIds.has(part.approvalId),
  )
}
