import type { UIMessage } from 'ai'

import type { MessageRecord, PartMetadata } from './types'

export type RetainedState = {
  ids: string[]
  messagesById: Map<string, UIMessage>
  messageMetaByMessage: Map<string, MessageRecord>
  partMetaByMessage: Map<string, PartMetadata>
}

export type MergeInput = {
  results: UIMessage[]
  messageMetaByMessage: Map<string, MessageRecord>
  partMetaByMessage: Map<string, PartMetadata>
}

/**
 * Merges a bounded live window into the retained set so the display list only
 * ever grows. This prevents layout thrashing when an older page unloads.
 */
export function mergeRetained(
  prev: RetainedState,
  input: MergeInput,
): MergeInput {
  const incomingSet = new Set(input.results.map((message) => message.id))
  const cut = prev.ids.findIndex((id) => incomingSet.has(id))
  const boundaryId = cut === -1 ? null : prev.ids[cut]
  const keptOlder = cut === -1 ? [] : prev.ids.slice(0, cut)

  const merged = boundaryId
    ? mergeBoundarySegments(prev, input, boundaryId)
    : input

  if (keptOlder.length === 0) return merged

  const results: UIMessage[] = []
  const messageMetaByMessage = new Map(merged.messageMetaByMessage)
  const partMetaByMessage = new Map(merged.partMetaByMessage)

  for (const id of keptOlder) {
    const message = prev.messagesById.get(id)
    if (!message) continue
    results.push(message)
    const meta = prev.messageMetaByMessage.get(id)
    if (meta) messageMetaByMessage.set(id, meta)
    const partMeta = prev.partMetaByMessage.get(id)
    if (partMeta) partMetaByMessage.set(id, partMeta)
  }

  results.push(...merged.results)

  return { results, messageMetaByMessage, partMetaByMessage }
}

/**
 * The boundary message may have lost its oldest segments as the live window
 * slid. Prepend the retained slices so its content also only ever grows.
 * A version change (retry) always takes the incoming content instead.
 */
function mergeBoundarySegments(
  prev: RetainedState,
  input: MergeInput,
  boundaryId: string,
): MergeInput {
  const prevRecord = prev.messageMetaByMessage.get(boundaryId)
  const record = input.messageMetaByMessage.get(boundaryId)
  const prevMessage = prev.messagesById.get(boundaryId)
  const index = input.results.findIndex((message) => message.id === boundaryId)
  const message = input.results[index]
  if (!prevRecord || !record || !prevMessage || !message) return input
  if (prevRecord.selectedVersion !== record.selectedVersion) return input

  const incomingMin = record.segments[0]?.index
  if (incomingMin === undefined) return input
  const olderSegments = prevRecord.segments.filter(
    (segment) => segment.index < incomingMin,
  )
  if (olderSegments.length === 0) return input

  const olderPartCount = olderSegments.reduce(
    (sum, segment) => sum + segment.partCount,
    0,
  )
  const olderParts = prevMessage.parts.slice(0, olderPartCount)

  const results = [...input.results]
  results[index] = { ...message, parts: [...olderParts, ...message.parts] }

  const messageMetaByMessage = new Map(input.messageMetaByMessage)
  messageMetaByMessage.set(boundaryId, {
    ...record,
    segments: [...olderSegments, ...record.segments],
    hasOlderSegments: prevRecord.hasOlderSegments,
  })

  return { ...input, results, messageMetaByMessage }
}
