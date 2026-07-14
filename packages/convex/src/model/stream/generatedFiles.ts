import { decodeBase64 } from '../io/base64'

export type GeneratedFilePart = {
  type: 'file'
  url: string
  mediaType?: string
  filename?: string
}

/** A `file` part whose bytes are embedded inline as a `data:` URL. */
export function isGeneratedFilePart(part: unknown): part is GeneratedFilePart {
  if (typeof part !== 'object' || part === null) return false
  const record = part as { type?: unknown; url?: unknown }
  return (
    record.type === 'file' &&
    typeof record.url === 'string' &&
    record.url.startsWith('data:')
  )
}

/** Stable key to dedupe a generated file during a stream. */
export function generatedFileCacheKey(url: string): string {
  return `${url.length}:${url.slice(0, 48)}:${url.slice(-48)}`
}

export function parseDataUrl(
  url: string,
): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url)
  if (!match) return null
  const [, mediaType, base64, data] = match
  try {
    const bytes = base64
      ? decodeBase64(data)
      : new Uint8Array(new TextEncoder().encode(decodeURIComponent(data)))
    return { mediaType: mediaType || 'application/octet-stream', bytes }
  } catch {
    return null
  }
}

export function generatedFilename(mediaType: string, index: number): string {
  const ext = mediaType.split('/')[1]?.split(';')[0]?.split('+')[0] || 'bin'
  return `generated-${index + 1}.${ext}`
}
