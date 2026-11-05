type ContextNoteMessage = {
  _id: string
  type?: string
  extra?: object
}

export const CONTEXT_NOTE_TYPES = [
  'skills',
  'workspace',
  'mcp',
  'capabilities',
] as const

/** Places each note before the assistant output whose request first consumed it. */
export function orderContextNotes<T extends ContextNoteMessage>(
  messages: T[],
): T[] {
  const { anchored, remaining } = partitionContextNotes(messages)
  return remaining.flatMap((message) => [
    ...(anchored.get(message._id) ?? []),
    message,
  ])
}

function contextNoteAnchor(message: ContextNoteMessage) {
  if (!isContextNote(message.type) || !message.extra) return undefined
  if (!('anchorMessageId' in message.extra)) return undefined
  const anchor = message.extra.anchorMessageId
  return typeof anchor === 'string' ? anchor : undefined
}

/** Identifies immutable context prepared before a provider invocation. */
export function isContextNote(type: string | undefined) {
  return CONTEXT_NOTE_TYPES.some((contextType) => contextType === type)
}

/** Splits provider history at the exact settled step where a note was first consumed. */
export function contextNoteSegments<
  T extends ContextNoteMessage & { parts: unknown[] },
>(messages: T[]): T[] {
  const { anchored, remaining } = partitionContextNotes(messages)
  return remaining.flatMap((message) => {
    const notes = anchored.get(message._id)
    return notes ? splitContextParts(message, notes) : [message]
  })
}

function splitContextParts<T extends ContextNoteMessage & { parts: unknown[] }>(
  message: T,
  notes: T[],
) {
  const result: T[] = []
  let position = 0
  for (const note of notes.sort((a, b) => anchorOffset(a) - anchorOffset(b))) {
    const end = Math.min(message.parts.length, anchorOffset(note))
    if (end > position) {
      result.push({ ...message, parts: message.parts.slice(position, end) })
    }
    result.push(note)
    position = end
  }
  if (position < message.parts.length) {
    result.push({ ...message, parts: message.parts.slice(position) })
  }
  return result
}

function partitionContextNotes<T extends ContextNoteMessage>(messages: T[]) {
  const ids = new Set(messages.map((message) => message._id))
  const anchored = new Map<string, T[]>()
  const remaining = messages.filter((message) => {
    const anchor = contextNoteAnchor(message)
    if (!anchor || !ids.has(anchor)) return true
    anchored.set(anchor, [...(anchored.get(anchor) ?? []), message])
    return false
  })
  return { anchored, remaining }
}

function anchorOffset(note: ContextNoteMessage) {
  const count =
    note.extra && 'anchorPartCount' in note.extra
      ? note.extra.anchorPartCount
      : 0
  return typeof count === 'number' && count >= 0 ? count : 0
}
