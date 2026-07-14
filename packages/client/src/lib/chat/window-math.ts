type SizedSegment = { segmentIndex: number; sizeBytes: number }

type SegmentedMessage = {
  sizeBytes: number
  segments: SizedSegment[]
  hasOlderSegments: boolean
}

/** An anchor position; `segmentIndex` is set when it lands mid-message. */
export type SegmentAnchor = { index: number; segmentIndex?: number }

/**
 * The newest messages whose accumulated size stays within the budget.
 * The boundary message may be trimmed to a suffix of its segments.
 * Always keeps at least one message.
 */
export function sliceTailByBudget<T extends SegmentedMessage>(
  page: T[],
  budget: number,
): T[] {
  let total = 0
  for (let i = page.length - 1; i >= 0; i--) {
    total += page[i].sizeBytes
    if (total > budget && i < page.length - 1) {
      const remaining = budget - (total - page[i].sizeBytes)
      const trimmed = trimToSegmentSuffix(page[i], remaining)
      return trimmed ? [trimmed, ...page.slice(i + 1)] : page.slice(i + 1)
    }
  }
  return page
}

/** Keeps the newest segments of a message that fit the budget, if any. */
function trimToSegmentSuffix<T extends SegmentedMessage>(
  message: T,
  budget: number,
): T | null {
  const { segments } = message
  if (segments.length <= 1) return null

  const kept: SizedSegment[] = []
  let total = 0
  for (let i = segments.length - 1; i >= 0; i--) {
    if (total + segments[i].sizeBytes > budget) break
    kept.unshift(segments[i])
    total += segments[i].sizeBytes
  }
  if (kept.length === 0) return null

  return {
    ...message,
    segments: kept,
    sizeBytes: total,
    hasOlderSegments: true,
  }
}

/**
 * The anchor one page budget in from the newest end. Used to anchor an
 * older direction fetch while dropping roughly a page's worth of the
 * newest content. Lands mid-message when a boundary turn is oversized.
 */
export function anchorFromEnd(
  messages: SegmentedMessage[],
  pageBudget: number,
): SegmentAnchor {
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const { segments } = messages[i]
    for (let j = segments.length - 1; j >= 0; j--) {
      total += segments[j].sizeBytes
      if (total >= pageBudget) {
        return { index: i, segmentIndex: segments[j].segmentIndex }
      }
    }
  }
  return { index: 0 }
}

/**
 * The anchor one page budget in from the oldest end. Used to anchor a
 * newer direction fetch while dropping roughly a page's worth of the
 * oldest content.
 */
export function anchorFromStart(
  messages: SegmentedMessage[],
  pageBudget: number,
): SegmentAnchor {
  let total = 0
  for (let i = 0; i < messages.length; i++) {
    const { segments } = messages[i]
    for (let j = 0; j < segments.length; j++) {
      total += segments[j].sizeBytes
      if (total >= pageBudget) {
        return { index: i, segmentIndex: segments[j].segmentIndex }
      }
    }
  }
  return { index: Math.max(0, messages.length - 1) }
}
