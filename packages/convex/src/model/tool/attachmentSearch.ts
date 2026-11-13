'use node'

import { isUtf8ContinuationByte } from '@cv/core/attachments'
import { ATTACHMENT_READ_MAX_BYTES } from '@cv/core/const'

import type { AttachmentPosition } from './attachmentPaging'
import type { AttachmentRanges } from './attachmentRanges'

const PREVIEW_BYTES = 512
const MIN_PREVIEW_BYTES = 64
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })

type AttachmentMatch = {
  line?: number
  lineFromEnd?: number
  byteOffset: number
  lineStartOffset: number
  preview: string
  previewClipped?: true
}

export type AttachmentSearchOutput = {
  kind: 'search'
  from?: 'end'
  matches: AttachmentMatch[]
  operationId: string
  done: boolean
}

type SearchOptions = {
  operationId: string
  pattern: string
  limit: number
  backward: boolean
  position: number
  line: number
}

export async function searchAttachment(
  ranges: AttachmentRanges,
  options: SearchOptions,
) {
  const { scanRegex } = await import('../../lib/regex/scan')

  const page = new SearchPage(ranges.size, options)
  const position = await scanRegex({
    ...options,
    size: ranges.size,
    read: ranges.read,
    hit: page.hit,
  })
  const done = options.backward
    ? position.position === 0
    : position.position === ranges.size

  return {
    output: { ...page.output, done },
    position: { ...position, done } satisfies AttachmentPosition,
  }
}

class SearchPage {
  readonly output: AttachmentSearchOutput
  private bytes: number
  private remaining: number
  private readonly minPreviewBytes: number
  private readonly reserve: number

  constructor(size: number, options: SearchOptions) {
    this.output = {
      kind: 'search',
      ...(options.backward && { from: 'end' }),
      matches: [],
      operationId: options.operationId,
      done: false,
    }
    this.bytes = jsonBytes(this.output)
    this.remaining = options.limit
    this.minPreviewBytes = Math.min(MIN_PREVIEW_BYTES, options.limit)
    // Include the comma and allow six JSON bytes per input byte for escapes.
    const metadataBytes = jsonBytes(this.entry(size + 1, size, size, '', true))
    this.reserve = metadataBytes + 1 + this.minPreviewBytes * 6
  }

  readonly hit = (
    line: number,
    offset: number,
    start: number,
    end: number,
    base: number,
    bytes: Uint8Array,
  ) => {
    const limit = Math.min(PREVIEW_BYTES, this.remaining)
    const budget =
      ATTACHMENT_READ_MAX_BYTES -
      this.bytes -
      Number(this.output.matches.length > 0)
    const [entry, consumed] = this.fitPreview(
      bytes,
      base,
      { line, offset, start, end },
      limit,
      budget,
    )

    this.bytes += jsonBytes(entry) + Number(this.output.matches.length > 0)
    this.output.matches.push(entry)
    this.remaining -= consumed

    return (
      this.remaining >= this.minPreviewBytes &&
      ATTACHMENT_READ_MAX_BYTES - this.bytes >= this.reserve
    )
  }

  private fitPreview(
    bytes: Uint8Array,
    base: number,
    hit: { line: number; offset: number; start: number; end: number },
    limit: number,
    budget: number,
  ) {
    // Center each clipped candidate on the hit so shrinking it keeps the match visible.
    const available = Math.min(bytes.length, hit.end - base)

    for (let width = limit; width >= 0; width--) {
      let start = Math.max(
        0,
        Math.min(hit.offset - base - Math.floor(width / 4), available - width),
      )
      const end = Math.min(available, start + width)
      while (start < end && isContinuation(bytes, start)) start++
      let stop = end
      while (stop > start && isContinuation(bytes, stop)) stop--
      const preview = decoder.decode(bytes.subarray(start, stop))
      const clipped = base + start > hit.start || base + stop < hit.end
      const entry = this.entry(
        hit.line,
        hit.offset,
        hit.start,
        preview,
        clipped,
      )
      if (jsonBytes(entry) <= budget) return [entry, stop - start] as const
    }
    throw new Error('Attachment search page has no room for a match')
  }

  private entry(
    line: number,
    byteOffset: number,
    lineStartOffset: number,
    preview: string,
    clipped: boolean,
  ): AttachmentMatch {
    return {
      ...(this.output.from ? { lineFromEnd: line } : { line }),
      byteOffset,
      lineStartOffset,
      preview,
      ...(clipped && { previewClipped: true }),
    }
  }
}

function isContinuation(bytes: Uint8Array, index: number) {
  return index < bytes.length && isUtf8ContinuationByte(bytes[index]!)
}

function jsonBytes(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length
}
