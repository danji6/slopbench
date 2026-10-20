type ContextNoteMessage = {
  _id: string
  type?: string
  extra?: object
}

/** Places each note before the assistant output whose request first consumed it. */
export function orderContextNotes<T extends ContextNoteMessage>(
  messages: T[],
): T[] {
  const anchored = new Map<string, T[]>()
  const ids = new Set(messages.map((message) => message._id))
  const remaining = messages.filter((message) => {
    const anchor = contextNoteAnchor(message)
    if (!anchor || !ids.has(anchor)) return true
    anchored.set(anchor, [...(anchored.get(anchor) ?? []), message])
    return false
  })
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
  return type === 'skills' || type === 'workspace'
}
