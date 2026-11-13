'use node'

import { isUtf8ContinuationByte } from '@cv/core/attachments'

import { ToolError } from '../../errors'
import type { AttachmentRanges } from './attachmentRanges'

export type AttachmentPosition = {
  position: number
  line: number
  done: boolean
}

export async function readAttachmentPage(
  ranges: AttachmentRanges,
  position: number,
  limit: number,
  backward: boolean,
) {
  const { size } = ranges
  const range = backward
    ? await tailRange(ranges, position, limit)
    : await forwardRange(ranges, position, limit)
  const done = backward ? range.offset === 0 : range.endOffset === size
  return {
    ...(backward && { from: 'end' as const }),
    ...range,
    totalBytes: size,
    ...(!backward && { eof: done, nextOffset: done ? null : range.endOffset }),
    truncated: !done,
    done,
  }
}

async function forwardRange(
  ranges: AttachmentRanges,
  position: number,
  limit: number,
) {
  const bytes = await ranges.read(
    position,
    Math.min(ranges.size, position + limit + 7),
  )
  let start = 0
  while (start < 3 && continuation(bytes, start)) start++
  if (continuation(bytes, start)) throw invalidUtf8()

  let end = Math.min(bytes.length, start + limit)
  while (end > start && continuation(bytes, end)) end--
  // A tiny limit can still read one complete code point.
  if (start === end && start < bytes.length) {
    end++
    while (continuation(bytes, end)) end++
  }
  return decodedRange(bytes, position, start, end)
}

async function tailRange(
  ranges: AttachmentRanges,
  position: number,
  limit: number,
) {
  const base = Math.max(0, position - limit - 3)
  const bytes = await ranges.read(base, position)
  const end = bytes.length
  let start = Math.max(0, end - limit)
  while (continuation(bytes, start)) start++
  if (start === end && end > 0) {
    start--
    while (start > 0 && continuation(bytes, start)) start--
  }
  return decodedRange(bytes, base, start, end)
}

function continuation(bytes: Uint8Array, index: number) {
  return index < bytes.length && isUtf8ContinuationByte(bytes[index]!)
}

function decodedRange(
  bytes: Uint8Array,
  base: number,
  start: number,
  end: number,
) {
  const offset = base + start
  try {
    const content = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: offset > 0,
    }).decode(bytes.subarray(start, end))
    return { content, offset, endOffset: base + end }
  } catch {
    throw invalidUtf8()
  }
}

function invalidUtf8() {
  return new ToolError('Attachment is not valid UTF-8 text')
}
