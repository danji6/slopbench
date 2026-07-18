import type { Id } from '../../_generated/dataModel'

/** Size threshold for tool outputs to be offloaded as blobs to the storage. */
export const OFFLOAD_THRESHOLD = 8_000

const PREVIEW_STRING_HEAD = 1_500
const PREVIEW_STRING_TAIL = 1_500
const PREVIEW_TERM_TAIL = 8_000
const PREVIEW_MARKER = '\n[... truncated, load full output ...]\n'

type ToolPartRecord = {
  type: string
  state?: string
  output?: unknown
  preliminary?: boolean
  toolCallId?: string
  outputRef?: Id<'_storage'>
}

function asRecord(part: unknown): ToolPartRecord | null {
  if (typeof part !== 'object' || part === null) return null
  if (
    !('type' in part) ||
    typeof (part as { type: unknown }).type !== 'string'
  ) {
    return null
  }
  return part as ToolPartRecord
}

export function isOffloadableToolPart(part: unknown): part is ToolPartRecord {
  const record = asRecord(part)
  return Boolean(
    record &&
    record.type.startsWith('tool-') &&
    record.state === 'output-available' &&
    record.output !== undefined &&
    record.preliminary !== true &&
    typeof record.toolCallId === 'string' &&
    !record.outputRef,
  )
}

export function hasOutputRef(
  part: unknown,
): part is ToolPartRecord & { outputRef: Id<'_storage'> } {
  return Boolean(asRecord(part)?.outputRef)
}

export function serializeToolOutput(output: unknown): string {
  return JSON.stringify(output)
}

/** Compact replacement output for fallback render. */
export function makeOutputPreview(output: unknown): unknown {
  if (typeof output === 'string') return truncateString(output)
  if (!output || typeof output !== 'object') return output

  const record = output as Record<string, unknown>
  const next: Record<string, unknown> = { ...record, truncated: true }

  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') continue
    if (key === 'term' && typeof record.termOffset === 'number') {
      next.term = value.slice(-PREVIEW_TERM_TAIL)
      next.termOffset =
        record.termOffset + (value.length - (next.term as string).length)
      continue
    }
    next[key] = truncateString(value)
  }

  return next
}

/** Signature of every tool part's lifecycle state. */
export function toolStateSignature(parts: unknown[]): string {
  const entries: string[] = []
  for (const part of parts) {
    const record = asRecord(part)
    if (!record) continue
    if (!record.type.startsWith('tool-') && record.type !== 'dynamic-tool') {
      continue
    }
    entries.push(
      `${record.toolCallId}:${record.state}:${record.preliminary === true}`,
    )
  }
  return entries.join('|')
}

export function collectToolOutputStorageIds(
  parts: unknown[],
): Id<'_storage'>[] {
  const ids: Id<'_storage'>[] = []
  for (const part of parts) {
    if (hasOutputRef(part)) ids.push(part.outputRef)
  }
  return ids
}

function truncateString(
  value: string,
  head = PREVIEW_STRING_HEAD,
  tail = PREVIEW_STRING_TAIL,
): string {
  if (value.length <= head + tail + PREVIEW_MARKER.length) return value
  return value.slice(0, head) + PREVIEW_MARKER + value.slice(-tail)
}
