import type { Id } from '@sb/convex/_generated/dataModel'
import type { WindowMessage } from '@sb/convex/model/chat/queries'
import type { MessageWindowArgs } from '@sb/convex/types'

type MessageFactory = (time: number, segments?: number) => WindowMessage

/** Models a small restored window and older history with large rendered text. */
export function clampedWindow(message: MessageFactory, full = false) {
  const history = Array.from({ length: 22 }, (_, time) =>
    clampedMessage(message, time, full),
  )
  const segments = history.flatMap((row) =>
    row.segments.map((segment) => ({ row, segment })),
  )
  return (args: MessageWindowArgs) => {
    const forward = args.direction === 'newer'
    const anchor = Number(args.anchor?.[1] ?? (forward ? 0 : 21))
    const candidates = segments.filter(({ row, segment }) => {
      if (row._creationTime !== anchor) {
        return forward ? row._creationTime > anchor : row._creationTime < anchor
      }
      if (args.anchorInclusive === false) return false
      if (args.anchorSegment === undefined) return true
      return forward
        ? segment.segmentIndex >= args.anchorSegment
        : segment.segmentIndex <= args.anchorSegment
    })
    if (!forward) candidates.reverse()
    const page: WindowMessage[] = []
    let bytes = 0
    for (const { row, segment } of candidates) {
      if (bytes > 0 && bytes + segment.sizeBytes > args.budgetBytes!) break
      bytes += segment.sizeBytes
      let kept = page.find((item) => item._id === row._id)
      if (!kept) {
        if (page.length >= args.limit) break
        kept = { ...row, segments: [], sizeBytes: 0 }
        page.push(kept)
      }
      kept.segments.push(segment)
      kept.sizeBytes += segment.sizeBytes
    }
    page.sort((a, b) => a._creationTime - b._creationTime)
    for (const row of page) {
      row.segments.sort((a, b) => a.segmentIndex - b.segmentIndex)
      row.hasOlderSegments = row.segments[0].segmentIndex > 0
      row.hasNewerSegments =
        row._creationTime === 8 && row.segments.at(-1)!.segmentIndex < 2
    }
    const first = page[0]
    const last = page.at(-1)!
    const hasOlder = first._creationTime > 0 || first.hasOlderSegments
    const hasNewer = last._creationTime < 21 || last.hasNewerSegments
    return { page, hasOlder, hasNewer, atTail: !hasNewer }
  }
}

function clampedMessage(message: MessageFactory, time: number, full: boolean) {
  const row = message(time, time === 8 ? 3 : 1)
  row.sender = { type: 'agent', id: 'same-agent' as Id<'agents'> }
  row.segments.forEach((segment) => {
    segment.sizeBytes =
      time === 8
        ? [69650, 69402, 18227][segment.segmentIndex]
        : time < 8
          ? full
            ? 45000
            : 13000
          : 4000
    segment.parts =
      time === 8 && segment.segmentIndex < 2
        ? [
            {
              type: 'tool-read_file',
              toolCallId: `call8:${segment.segmentIndex}`,
              state: 'output-available',
              input: { path: 'a.ts' },
              output: 'contents',
            },
          ]
        : [{ type: 'text', text: `History ${time}` }]
  })
  return row
}
