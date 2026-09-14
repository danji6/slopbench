import { readUtf8Range } from '@sb/core/attachments'

export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

export type TextPreview = {
  text: string
  shownBytes: number
  truncated: boolean
}

/** Reads at most one browser-safe preview window from a URL. */
export async function readTextPreview(
  url: string,
  signal: AbortSignal,
  maxBytes = MAX_TEXT_PREVIEW_BYTES,
): Promise<TextPreview> {
  const response = await fetch(url, { signal })
  if (!response.ok)
    throw new Error(`Failed to load attachment (${response.status})`)

  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return decodePreview(bytes, maxBytes, bytes.length > maxBytes)
  }

  const readLimit = maxBytes + 4
  const chunks: Uint8Array[] = []
  let byteLength = 0
  let done = false

  try {
    while (byteLength < readLimit) {
      const next = await reader.read()
      done = next.done
      if (done) break
      if (!next.value) continue

      const remaining = readLimit - byteLength
      const chunk = next.value.subarray(0, remaining)
      chunks.push(chunk)
      byteLength += chunk.byteLength
      if (chunk.byteLength < next.value.byteLength) break
    }
  } finally {
    if (!done) await reader.cancel().catch(() => {})
  }

  return decodePreview(
    joinBytes(chunks, byteLength),
    maxBytes,
    !done || byteLength > maxBytes,
  )
}

function decodePreview(
  bytes: Uint8Array,
  maxBytes: number,
  truncated: boolean,
): TextPreview {
  const range = readUtf8Range(bytes, 0, Math.max(1, maxBytes))
  return {
    text: range.content,
    shownBytes: range.endOffset,
    truncated: truncated || range.truncated,
  }
}

function joinBytes(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
