import { LARGE_PASTE_BYTES } from './const'

const ATTACHMENT_LINK =
  /(?:\/attachments\/|attachment:)([^/?#\s]+)\/([^/?#\s)]+)/g
const ATTACHMENT_SCHEME = 'attachment:'

export type AttachmentReference = { token: string; filename: string }

/** Whether a composer paste should be represented as an attachment. */
export function shouldAttachTextPaste(
  text: string,
  commandMode = false,
): boolean {
  if (commandMode || /^\s*(?:\/|\$\s)/.test(text)) return false
  return new TextEncoder().encode(text).byteLength >= LARGE_PASTE_BYTES
}

/** Builds the stable HTTP path for a bearer attachment token. */
export function attachmentPath(token: string, filename: string): string {
  return `/attachments/${encodeURIComponent(token)}/${encodeURIComponent(filename)}`
}

/** Builds a host-independent attachment reference. */
export function attachmentRef(token: string, filename: string): string {
  return `${ATTACHMENT_SCHEME}${encodeURIComponent(token)}/${encodeURIComponent(filename)}`
}

/** Builds a clickable Markdown attachment reference for copying. */
export function attachmentMarkdownLink(
  token: string,
  filename: string,
): string {
  const label = filename.replace(/\r?\n/g, ' ').replace(/([[\]\\])/g, '\\$1')
  return `[📎 ${label}](${attachmentRef(token, filename)})`
}

/** Extracts and deduplicates permanent attachment references from message text. */
export function attachmentReferences(text: string): AttachmentReference[] {
  const references = new Map<string, AttachmentReference>()
  for (const match of withoutMarkdownCode(text).matchAll(ATTACHMENT_LINK)) {
    if (!match[1] || !match[2]) continue
    try {
      const reference = {
        token: decodeURIComponent(match[1]),
        filename: decodeURIComponent(match[2]),
      }
      references.set(JSON.stringify(reference), reference)
    } catch {
      // Malformed URLs aren't attachment links
    }
  }
  return [...references.values()]
}

/** Extracts and deduplicates bearer attachment tokens from message text. */
export function attachmentTokens(text: string): string[] {
  return [...new Set(attachmentReferences(text).map(({ token }) => token))]
}

function withoutMarkdownCode(text: string): string {
  let fence: { marker: '`' | '~'; length: number } | null = null
  const visible = text.split('\n').map((line) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (match?.[1]) {
      const marker = match[1][0] as '`' | '~'
      if (!fence) fence = { marker, length: match[1].length }
      else if (marker === fence.marker && match[1].length >= fence.length) {
        fence = null
      }
      return ''
    }
    return fence ? '' : line
  })
  return visible.join('\n').replace(/(`+)[\s\S]*?\1/g, '')
}

/** Parses the bearer token and filename from a permanent reference or URL. */
export function attachmentReference(value: string): AttachmentReference | null {
  try {
    if (value.startsWith(ATTACHMENT_SCHEME)) {
      return parseReferenceSegments(value.slice(ATTACHMENT_SCHEME.length))
    }

    const url = new URL(value, 'https://attachment.invalid')
    const marker = '/attachments/'
    if (!url.pathname.startsWith(marker)) return null
    return parseReferenceSegments(url.pathname.slice(marker.length))
  } catch {
    return null
  }
}

function parseReferenceSegments(value: string): AttachmentReference | null {
  const segments = value.split('/')
  if (segments.length !== 2 || !segments[0] || !segments[1]) return null
  return {
    token: decodeURIComponent(segments[0]),
    filename: decodeURIComponent(segments[1]),
  }
}

/** Returns the bearer token contained in a permanent reference or URL. */
export function attachmentToken(value: string): string | null {
  return attachmentReference(value)?.token ?? null
}

export type Utf8Range = {
  content: string
  offset: number
  endOffset: number
  nextOffset: number | null
  totalBytes: number
  eof: boolean
  truncated: boolean
}

/** Decodes a byte-bounded UTF-8 window without splitting a code point. */
export function readUtf8Range(
  bytes: Uint8Array,
  requestedOffset: number,
  requestedLimit: number,
): Utf8Range {
  let offset = Math.min(Math.max(0, Math.floor(requestedOffset)), bytes.length)
  const limit = Math.max(1, Math.floor(requestedLimit))
  while (offset < bytes.length && isContinuationByte(bytes[offset]!))
    offset += 1

  let endOffset = Math.min(bytes.length, offset + limit)
  while (endOffset > offset && isContinuationByte(bytes[endOffset]!)) {
    endOffset -= 1
  }
  if (endOffset === offset && offset < bytes.length) {
    endOffset += 1
    while (endOffset < bytes.length && isContinuationByte(bytes[endOffset]!)) {
      endOffset += 1
    }
  }

  const content = new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(offset, endOffset),
  )
  const eof = endOffset >= bytes.length
  return {
    content,
    offset,
    endOffset,
    nextOffset: eof ? null : endOffset,
    totalBytes: bytes.length,
    eof,
    truncated: !eof,
  }
}

function isContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80
}
