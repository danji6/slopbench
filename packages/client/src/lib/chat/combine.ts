import type { UIMessage } from 'ai'
import { isReasoningUIPart, isTextUIPart } from 'ai'

type AnyPart = UIMessage['parts'][number]
type ToolLikePart = AnyPart & { toolCallId: string; state: string }

export type SourceMessagePart = AnyPart & { sourceMessageId?: string }

function isToolLikePart(part: AnyPart): part is ToolLikePart {
  return (
    'toolCallId' in part &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  )
}

/** Combine multi-step messages into a single message for better UX. */
export function combineTurns<T extends UIMessage>(messages: T[]): T[] {
  const result: T[] = []
  let i = 0

  while (i < messages.length) {
    const message = messages[i]
    const order = orderOf(message)

    if (message.role !== 'assistant' || order === undefined) {
      result.push(message)
      i++
      continue
    }

    const group: T[] = [message]
    let j = i + 1
    while (
      j < messages.length &&
      messages[j].role === 'assistant' &&
      orderOf(messages[j]) === order
    ) {
      group.push(messages[j])
      j++
    }

    result.push(group.length === 1 ? message : mergeTurn(group))
    i = j
  }

  return result
}

function mergeTurn<T extends UIMessage>(group: T[]): T {
  const parts = mergeParts(
    group.flatMap((message) =>
      message.parts.map((part) => withSourceMessageId(part, message.id)),
    ),
  )
  const streaming = group.some((m) => statusOf(m) === 'streaming')
  return {
    ...group[0],
    parts,
    status: streaming ? 'streaming' : statusOf(group[0]),
    text: parts.filter(isTextUIPart).reduce((acc, p) => acc + p.text, ''),
  } as T
}

function withSourceMessageId(part: AnyPart, messageId: string): SourceMessagePart {
  return { ...part, sourceMessageId: messageId }
}

function mergeParts(parts: AnyPart[]): AnyPart[] {
  const result: AnyPart[] = []
  const toolIndex = new Map<string, number>()
  const seenText = new Set<string>()

  for (const part of parts) {
    if (isToolLikePart(part)) {
      const at = toolIndex.get(part.toolCallId)
      if (at === undefined) {
        toolIndex.set(part.toolCallId, result.length)
        result.push(part)
      } else {
        result[at] = pickToolPart(result[at] as ToolLikePart, part)
      }
      continue
    }

    if (isTextUIPart(part) || isReasoningUIPart(part)) {
      const text = part.text ?? ''
      if (text.trim() === '') continue
      const key = `${part.type}:${text}`
      if (seenText.has(key)) continue
      seenText.add(key)
    }

    result.push(part)
  }

  return result
}

const TOOL_STATE_RANK: Record<string, number> = {
  'input-streaming': 0,
  'input-available': 1,
  'approval-requested': 1,
  'approval-responded': 2,
  'output-available': 3,
  'output-denied': 4,
  'output-error': 4,
}

function toolRank(state: string): number {
  return TOOL_STATE_RANK[state] ?? 0
}

function pickToolPart(a: ToolLikePart, b: ToolLikePart): ToolLikePart {
  return toolRank(b.state) >= toolRank(a.state) ? b : a
}

function orderOf(message: UIMessage): number | undefined {
  return (message as { order?: number }).order
}

function statusOf(message: UIMessage): string | undefined {
  return (message as { status?: string }).status
}
