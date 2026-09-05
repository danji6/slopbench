type Segment = {
  segmentIndex: number
  parts: unknown[]
  sizeBytes: number
  live?: boolean
}

type WindowMessage = {
  _id: string
  selectedVersion: number
  segments: Segment[]
  sizeBytes: number
}

type ProcessingSegment = {
  messageId: string
  selectedVersion: number
  segment: Segment
}

/** Hydrates stable window placeholders with their bounded mutable tails. */
export function hydrateLiveSegments<T extends WindowMessage>(
  messages: T[],
  liveSegments: ProcessingSegment[],
): T[] {
  if (messages.length === 0 || liveSegments.length === 0) return messages

  const liveByMessage = new Map(
    liveSegments.map((live) => [live.messageId, live]),
  )
  let changed = false
  const hydrated = messages.map((message) => {
    const live = liveByMessage.get(message._id)
    if (!live || live.selectedVersion !== message.selectedVersion) {
      return message
    }

    const placeholder = message.segments.findIndex(
      (segment) =>
        segment.live && segment.segmentIndex === live.segment.segmentIndex,
    )
    if (placeholder === -1) return message

    changed = true
    const segments = [...message.segments]
    segments[placeholder] = { ...live.segment, live: true }
    return {
      ...message,
      segments,
      sizeBytes: segments.reduce((sum, segment) => sum + segment.sizeBytes, 0),
    }
  })

  return changed ? hydrated : messages
}
