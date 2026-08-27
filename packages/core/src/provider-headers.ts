import { limitError } from './limit-errors'
import { MAX_PROVIDER_EXTRA_HEADERS_CHARS } from './limits'

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Headers controlled by HTTP transports and intermediaries. */
export const RESERVED_PROVIDER_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export function parseProviderExtraHeaders(
  value?: string,
): Record<string, string> {
  if (!value?.trim()) return {}
  if (value.length > MAX_PROVIDER_EXTRA_HEADERS_CHARS) {
    throw new Error(limitError('providerExtraHeaders'))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Extra headers must be valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Extra headers must be a JSON object.')
  }

  const result: Record<string, string> = {}
  const names = new Set<string>()
  for (const [name, headerValue] of Object.entries(parsed)) {
    const normalized = name.toLowerCase()
    if (!HEADER_NAME.test(name)) {
      throw new Error(`Invalid header name: ${name}`)
    }
    if (RESERVED_PROVIDER_HEADERS.has(normalized)) {
      throw new Error(`Header is managed by the HTTP transport: ${name}`)
    }
    if (names.has(normalized)) {
      throw new Error(`Duplicate header name: ${name}`)
    }
    if (typeof headerValue !== 'string') {
      throw new Error(`Header values must be strings: ${name}`)
    }
    if (/[\0\r\n]/.test(headerValue)) {
      throw new Error(`Invalid header value: ${name}`)
    }
    names.add(normalized)
    result[name] = headerValue
  }
  return result
}
