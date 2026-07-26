/**
 * A generic description of "what is open", carried in the `?view=` query
 * parameter.
 * A view is a path of segments joined by `/`, each `name` or `name:value`:
 *
 *     ?view=settings:behavior/prompt:9f2c-...
 *
 * The names and values are encoded, separators are not.
 */

export type ViewSegment = {
  name: string
  value?: string
}

export const VIEW_PARAM = 'view'

const SEGMENT_SEPARATOR = '/'
const VALUE_SEPARATOR = ':'

/**
 * Reads a query parameter without decoding its value to keep it distinguishable
 * from the separators.
 */
function readRawParam(search: string, name: string): string | undefined {
  const query = search.startsWith('?') ? search.slice(1) : search

  for (const pair of query.split('&')) {
    if (!pair) continue
    const equals = pair.indexOf('=')
    const key = equals === -1 ? pair : pair.slice(0, equals)
    if (decodeURIComponent(key) !== name) continue
    return equals === -1 ? '' : pair.slice(equals + 1)
  }

  return undefined
}

function parseSegment(raw: string): ViewSegment | null {
  const separator = raw.indexOf(VALUE_SEPARATOR)
  const rawName = separator === -1 ? raw : raw.slice(0, separator)
  const name = safeDecode(rawName)
  if (!name) return null

  if (separator === -1) return { name }

  const value = safeDecode(raw.slice(separator + 1))
  return value ? { name, value } : { name }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseViewPath(search: string): ViewSegment[] {
  const raw = readRawParam(search, VIEW_PARAM)
  if (!raw) return []

  return raw
    .split(SEGMENT_SEPARATOR)
    .map(parseSegment)
    .filter((segment): segment is ViewSegment => segment !== null)
}

/** Serializes a path into the `?view=` value. Empty for an empty path. */
export function formatViewPath(path: readonly ViewSegment[]): string {
  return path
    .map(({ name, value }) =>
      value === undefined
        ? encodeURIComponent(name)
        : `${encodeURIComponent(name)}${VALUE_SEPARATOR}${encodeURIComponent(value)}`,
    )
    .join(SEGMENT_SEPARATOR)
}

export function findViewSegment(
  path: readonly ViewSegment[],
  name: string,
): ViewSegment | undefined {
  return path.find((segment) => segment.name === name)
}

export type SegmentOptions = {
  /** Keep segments nested below the replaced one. Defaults to dropping them. */
  keepChildren?: boolean
}

/** Replaces the segment with a matching name, or appends it when absent. */
export function withViewSegment(
  path: readonly ViewSegment[],
  segment: ViewSegment,
  { keepChildren = false }: SegmentOptions = {},
): ViewSegment[] {
  const index = path.findIndex((existing) => existing.name === segment.name)
  if (index === -1) return [...path, segment]

  const tail = keepChildren ? path.slice(index + 1) : []
  return [...path.slice(0, index), segment, ...tail]
}

/** Drops the named segment along with everything nested below it. */
export function withoutViewSegment(
  path: readonly ViewSegment[],
  name: string,
): ViewSegment[] {
  const index = path.findIndex((segment) => segment.name === name)
  return index === -1 ? [...path] : path.slice(0, index)
}

/** Rewrites `?view=` in a search string, preserving every other parameter. */
export function viewSearch(
  search: string,
  path: readonly ViewSegment[],
): string {
  const params = new URLSearchParams(search)
  params.delete(VIEW_PARAM)

  const rest = params.toString()
  const view = formatViewPath(path)
  if (!view) return rest

  const encoded = `${VIEW_PARAM}=${view}`
  return rest ? `${rest}&${encoded}` : encoded
}
