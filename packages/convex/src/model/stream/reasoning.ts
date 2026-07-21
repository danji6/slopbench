import type { TextStreamPart, ToolSet, UIMessage } from 'ai'

/** Time span of one reasoning block, in order of appearance. */
type ReasoningSpan = { startedAt: number; endedAt?: number }

export type ReasoningTracker = { spans: ReasoningSpan[] }

export const createReasoningTracker = (): ReasoningTracker => ({ spans: [] })

/**
 * Times reasoning blocks at the provider boundary, before patch throttling can
 * blur their start and end.
 */
export const trackReasoningTimings =
  <TOOLS extends ToolSet>(tracker: ReasoningTracker) =>
  (_: { tools: TOOLS }) => {
    const open = new Map<string, ReasoningSpan>()

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === 'reasoning-start') {
          const span: ReasoningSpan = { startedAt: Date.now() }
          tracker.spans.push(span)
          open.set(chunk.id, span)
        } else if (chunk.type === 'reasoning-end') {
          const span = open.get(chunk.id)
          if (span) {
            span.endedAt = Date.now()
            open.delete(chunk.id)
          }
        }
        controller.enqueue(chunk)
      },
    })
  }

/** Stamps measured think time onto the reasoning parts this step produced. */
export function applyReasoningDurations(
  parts: UIMessage['parts'],
  tracker: ReasoningTracker,
  fromIndex: number,
): UIMessage['parts'] {
  if (tracker.spans.length === 0) return parts

  let seen = 0
  const result = parts.map((part, index) => {
    if (part.type !== 'reasoning' || index < fromIndex) return part

    const span = tracker.spans[seen++]
    if (!span) return part

    return { ...part, duration: (span.endedAt ?? Date.now()) - span.startedAt }
  })

  return result as UIMessage['parts']
}
