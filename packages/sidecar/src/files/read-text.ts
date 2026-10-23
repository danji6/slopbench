import { open } from 'node:fs/promises'

/** Bounds allocation and output, independently of the stored file's size. */
export const TEXT_READ_BYTES = 50_000
const SCAN_BYTES = 8 * 1024 * 1024
const CHUNK_BYTES = 16 * 1024

export type TextReadOptions = {
  offset?: number
  limit?: number
  maxBytes?: number
  byteOffset?: number
}

/** Reads a bounded text page; byte continuation also handles very long lines. */
export async function readTextPage(
  filename: string,
  options: TextReadOptions = {},
) {
  const file = await open(filename, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Path is not a regular file')

    let position = Math.max(0, options.byteOffset ?? 0)
    let line = options.byteOffset === undefined ? 1 : (options.offset ?? 1)
    const offset = Math.max(1, options.offset ?? 1)
    const budget = Math.min(TEXT_READ_BYTES, Math.max(1, options.maxBytes ?? TEXT_READ_BYTES)) // prettier-ignore
    const output = Buffer.alloc(budget + 4)
    const chunk = Buffer.alloc(CHUNK_BYTES)
    let size = 0
    let selectedLines = 1
    let scanned = 0
    let stopped = false

    while (position < info.size && !stopped) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, position)
      if (!bytesRead) break

      for (let i = 0; i < bytesRead; i++) {
        const byte = chunk[i]!
        if (line < offset) {
          position++
          if (byte === 10) line++
          if (++scanned > SCAN_BYTES) {
            throw new Error(
              'Line offset exceeds the scan budget; use byteOffset to continue',
            )
          }
          continue
        }
        if (size >= budget) {
          stopped = true
          break
        }
        if (byte === 0)
          throw new Error('Binary file: use a suitable tool to inspect it')

        position++
        if (byte === 10 && options.limit && selectedLines >= options.limit) {
          if (size && output[size - 1] === 13) size--
          stopped = true
          break
        }
        output[size++] = byte
        if (byte === 10) selectedLines++
      }
    }

    // Do not split a UTF-8 code point at the output boundary
    const safeSize = utf8PrefixLength(output.subarray(0, size))
    if (size && !safeSize)
      throw new Error(
        'Byte budget is too small for the next UTF-8 character; retry with a byte budget of at least 4',
      )
    position -= size - safeSize
    const truncated = position < info.size
    const content = new TextDecoder('utf8', { fatal: true })
      .decode(output.subarray(0, safeSize))
      .replace(/\r\n/g, '\n')

    return {
      content,
      offset,
      totalLines: truncated ? undefined : line + selectedLines - 1,
      truncated,
      nextByteOffset: truncated ? position : undefined,
    }
  } finally {
    await file.close()
  }
}

/** Returns the largest prefix ending at a complete UTF-8 code point. */
export function utf8PrefixLength(bytes: Uint8Array): number {
  if (!bytes.length) return 0
  let start = bytes.length - 1
  while (start > 0 && (bytes[start]! & 0xc0) === 0x80) start--
  const lead = bytes[start]!
  const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
  return bytes.length - start < width ? start : bytes.length
}

/** Reads a fixed-size prefix for previews and binary attachments with bounded allocation. */
export async function readFilePrefix(filename: string, budget: number) {
  const file = await open(filename, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Path is not a regular file')
    const buffer = Buffer.alloc(Math.min(info.size, budget) + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        size,
        buffer.length - size,
        size,
      )
      if (!bytesRead) break
      size += bytesRead
    }
    return {
      buffer: buffer.subarray(0, Math.min(size, budget)),
      truncated: size > budget || info.size > budget,
    }
  } finally {
    await file.close()
  }
}
