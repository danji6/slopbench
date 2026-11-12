'use node'

import { ToolError } from '../../errors'

export type AttachmentRanges = {
  size: number
  read: (start: number, end: number) => Promise<Uint8Array>
}

export function attachmentRanges(
  url: string,
  size: number,
  signal?: AbortSignal,
): AttachmentRanges {
  return {
    size,
    read: async (start, end) => {
      if (start === end) return new Uint8Array()
      signal?.throwIfAborted()
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end - 1}`,
          'Accept-Encoding': 'identity',
        },
        signal,
      })
      const encoding = response.headers.get('content-encoding')
      const contentRange = response.headers.get('content-range')
      const invalidResponse =
        response.status !== 206 ||
        contentRange !== `bytes ${start}-${end - 1}/${size}` ||
        (encoding && encoding.toLowerCase() !== 'identity') ||
        !response.body
      if (invalidResponse) {
        await response.body?.cancel()
        throw invalidRange()
      }
      return readExactRange(response.body, end - start)
    },
  }
}

async function readExactRange(body: ReadableStream<Uint8Array>, size: number) {
  const bytes = new Uint8Array(size)
  const reader = body.getReader()
  let offset = 0
  try {
    while (offset < size) {
      const { done, value } = await reader.read()
      if (done || value.length > size - offset) throw invalidRange()
      bytes.set(value, offset)
      offset += value.length
    }
    if (!(await reader.read()).done) throw invalidRange()
    return bytes
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

function invalidRange() {
  return new ToolError(
    'Attachment storage did not return the requested byte range',
  )
}
