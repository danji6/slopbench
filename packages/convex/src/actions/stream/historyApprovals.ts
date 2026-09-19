'use node'

import { block } from '@sb/core/utils/blocks'
import type { ModelMessage, UIMessage } from 'ai'

/** Approval notes keyed by the call they annotate, settled calls only. */
export function collectApprovalNotes(
  messages: UIMessage[],
): Map<string, string> {
  const notes = new Map<string, string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (!part.type.startsWith('tool-')) continue
      const typed = part as {
        state?: string
        toolCallId?: string
        approval?: { note?: string }
      }
      // Only surface the note once the tool has settled, otherwise it never runs
      if (!typed.state?.startsWith('output-')) continue
      const note = typed.approval?.note?.trim()
      if (note && typed.toolCallId) notes.set(typed.toolCallId, note)
    }
  }
  return notes
}

/** Notes waiting for an approved tool to execute in the current SDK call. */
export function collectRespondedApprovalNotes(
  parts: UIMessage['parts'],
): Map<string, string> {
  const notes = new Map<string, string>()
  for (const part of parts) {
    if (!part.type.startsWith('tool-')) continue
    const typed = part as {
      state?: string
      toolCallId?: string
      approval?: { note?: string }
    }
    if (typed.state !== 'approval-responded') continue
    const note = typed.approval?.note?.trim()
    if (note && typed.toolCallId) notes.set(typed.toolCallId, note)
  }
  return notes
}

/** Inserts user approval notes after their tool-result group. */
export function insertApprovalNoteMessages(
  messages: ModelMessage[],
  notes: Map<string, string>,
): ModelMessage[] {
  if (notes.size === 0) return messages

  const annotated: ModelMessage[] = []
  let pendingNotes: string[] = []
  for (const [index, message] of messages.entries()) {
    annotated.push(message)
    if (message.role !== 'tool') continue

    pendingNotes.push(
      ...message.content.flatMap((part) => {
        if (part.type !== 'tool-result') return []
        const note = notes.get(part.toolCallId)
        return note
          ? [
              block('user-note', note, {
                tool: part.toolName,
                id: part.toolCallId,
              }),
            ]
          : []
      }),
    )
    if (messages[index + 1]?.role === 'tool') continue
    if (pendingNotes.length === 0) continue

    annotated.push({
      role: 'user',
      content: pendingNotes.map((text) => ({ type: 'text', text })),
    })
    pendingNotes = []
  }

  return annotated
}
