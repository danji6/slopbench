import type { Doc, Id } from '../_generated/dataModel'

/** Finds user messages whose media belongs to the current response turn. */
export function activeAttachmentMessages(
  history: Array<Pick<Doc<'messages'>, '_id' | 'role'>>,
  boundaryId: Id<'messages'> | undefined,
): Set<Id<'messages'>> {
  const active = new Set<Id<'messages'>>()
  if (!boundaryId) return active

  const boundaryIndex = history.findIndex((message) => message._id === boundaryId) // prettier-ignore
  if (boundaryIndex < 0) return active
  if (history[boundaryIndex]?.role === 'assistant') return active

  for (let index = boundaryIndex; index >= 0; index -= 1) {
    const message = history[index]!
    if (index !== boundaryIndex && message.role === 'assistant') break
    if (message.role === 'user') active.add(message._id)
  }

  return active
}

/** Whether a message contains a loaded media result from read_attachment. */
export function hasLoadedAttachmentMedia(parts: unknown[]): boolean {
  return parts.some((part) => {
    if (
      typeof part !== 'object' ||
      part === null ||
      (part as { type?: unknown }).type !== 'tool-read_attachment' ||
      (part as { state?: unknown }).state !== 'output-available'
    ) {
      return false
    }
    const output = (part as { output?: unknown }).output
    return (
      typeof output === 'object' &&
      output !== null &&
      (output as { kind?: unknown }).kind === 'media'
    )
  })
}
