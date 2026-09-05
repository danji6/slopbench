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

export type RetainedLimits = {
  maxBytes: number
  maxMessages: number
}

/**
 * Merges a bounded live page into the retained set. The caller applies the
 * full window limit afterward; retaining overlap prevents layout thrashing.
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

/** Keeps the newest suffix of a retained window within its hard limits. */
export function limitRetained(
  input: MergeInput,
  { maxBytes, maxMessages }: RetainedLimits,
): MergeInput {
  if (input.results.length === 0) return input

  let totalBytes = 0
  let keptMessages = 0
  let keptSegments = 0
  let firstMessage = input.results.length - 1
  let firstSegment = 0

  outer: for (let i = input.results.length - 1; i >= 0; i -= 1) {
    if (keptMessages >= maxMessages) break

    const record = input.messageMetaByMessage.get(input.results[i].id)
    const segments = record?.segments ?? []
    if (segments.length === 0) {
      firstMessage = i
      firstSegment = 0
      keptMessages += 1
      continue
    }

    let included = false
    for (let j = segments.length - 1; j >= 0; j -= 1) {
      const sizeBytes = segments[j].sizeBytes ?? 0
      if (keptSegments > 0 && totalBytes + sizeBytes > maxBytes) break outer

      totalBytes += sizeBytes
      keptSegments += 1
      included = true
      firstMessage = i
      firstSegment = j
    }
    if (included) keptMessages += 1
  }

  if (firstMessage === 0 && firstSegment === 0) return input

  const results = input.results.slice(firstMessage)
  const messageMetaByMessage = selectMap(input.messageMetaByMessage, results)
  const partMetaByMessage = selectMap(input.partMetaByMessage, results)

  if (firstSegment > 0) {
    const message = results[0]
    const record = messageMetaByMessage.get(message.id)
    if (record) {
      const droppedPartCount = record.segments
        .slice(0, firstSegment)
        .reduce((sum, segment) => sum + segment.partCount, 0)
      const segments = record.segments.slice(firstSegment)
      results[0] = {
        ...message,
        parts: message.parts.slice(droppedPartCount),
      }
      messageMetaByMessage.set(message.id, {
        ...record,
        sizeBytes: segments.reduce(
          (sum, segment) => sum + segment.sizeBytes,
          0,
        ),
        segments,
        hasOlderSegments: true,
      })
    }
  }

  return { results, messageMetaByMessage, partMetaByMessage }
}

function selectMap<T>(map: Map<string, T>, messages: UIMessage[]) {
  const selected = new Map<string, T>()
  for (const message of messages) {
    const value = map.get(message.id)
    if (value !== undefined) selected.set(message.id, value)
  }
  return selected
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
  const segments = [...olderSegments, ...record.segments]
  messageMetaByMessage.set(boundaryId, {
    ...record,
    sizeBytes: segments.reduce((sum, segment) => sum + segment.sizeBytes, 0),
    segments,
    hasOlderSegments: prevRecord.hasOlderSegments,
  })

  return { ...input, results, messageMetaByMessage }
}
