import type { UIMessage } from 'ai'
import { dequal } from 'dequal'

import { mergeRetained } from './message-merge'
import { type MessageRow, buildRows, rowKeysEqual } from './rows'
import type { MessageRecord, PartMetadata } from './types'

export type PaginationStatus =
  'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'

export type PaginationMetadata = {
  status: PaginationStatus
  isLoadingFirstPage: boolean
}

export type MessageWindowMetadata = {
  isLoadingFirstPage: boolean
  canLoadOlder: boolean
  canLoadNewer: boolean
  isAtLiveTail: boolean
  isLoadingOlder: boolean
  isLoadingNewer: boolean
  /** True for a load that swaps the window's content rather than growing it. */
  isSliding: boolean
}

export type WindowAnchor = {
  _id: string
  _creationTime: number
  /** Anchors message at this segment. */
  segmentIndex?: number
}

export type WindowControls = {
  /** @returns true if the content was swapped. */
  extendOlder: () => boolean
  /** @returns true if the content was swapped. */
  extendNewer: () => boolean
  returnToLatest: () => void
  returnToOldest: () => void
  anchorAround: (anchor: WindowAnchor) => void
}

const NOOP_CONTROLS: WindowControls = {
  extendOlder: () => false,
  extendNewer: () => false,
  returnToLatest: () => {},
  returnToOldest: () => {},
  anchorAround: () => {},
}

const INITIAL_WINDOW_META: MessageWindowMetadata = {
  isLoadingFirstPage: true,
  canLoadOlder: false,
  canLoadNewer: false,
  isAtLiveTail: true,
  isLoadingOlder: false,
  isLoadingNewer: false,
  isSliding: false,
}

export type MessageStoreInput = {
  sessionId: string | null
  results: UIMessage[]
  controls: WindowControls
  meta: MessageWindowMetadata
  /** Drops retained messages when changed. */
  resetKey: number
  messageMetaByMessage: Map<string, MessageRecord>
  partMetaByMessage: Map<string, PartMetadata>
  /** Whether consecutive messages by the same sender are collapsed into a single one. */
  groupBySender: boolean
}

export type MessageStore = ReturnType<typeof createMessageStore>

export function createMessageStore() {
  let ids: string[] = []
  let messagesById = new Map<string, UIMessage>()
  let results: UIMessage[] = []
  let messageMetaByMessage = new Map<string, MessageRecord>()
  let partMetaByMessage = new Map<string, PartMetadata>()
  let rows: MessageRow[] = []
  let windowMeta: MessageWindowMetadata = INITIAL_WINDOW_META
  let controls: WindowControls = NOOP_CONTROLS
  let lastSessionId: string | null = null
  let lastWasLive = false
  let lastResetKey = 0
  let groupBySender = false

  const listeners = new Set<() => void>()

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const rebuildRows = (): boolean => {
    const nextRows = buildRows(
      ids,
      (id) => messagesById.get(id) ?? null,
      (id) => messageMetaByMessage.get(id),
      { groupBySender },
    )
    if (rowKeysEqual(rows, nextRows)) return false
    rows = nextRows
    return true
  }

  /**
   * Drops a deleted message from the retained state. Required because
   * reactive queries can't see messages that slid out of the live
   * window and thus deletions stay out of sync.
   */
  const evict = (messageId: string) => {
    if (!messagesById.has(messageId)) return
    ids = ids.filter((id) => id !== messageId)
    messagesById = mapWithout(messagesById, messageId)
    results = results.filter((message) => message.id !== messageId)
    messageMetaByMessage = mapWithout(messageMetaByMessage, messageId)
    partMetaByMessage = mapWithout(partMetaByMessage, messageId)
    rebuildRows()
    listeners.forEach((listener) => listener())
  }

  const sync = (input: MessageStoreInput) => {
    let changed = false

    const isLive = input.meta.isAtLiveTail
    const reset = input.resetKey !== lastResetKey
    const merge =
      isLive && lastWasLive && lastSessionId === input.sessionId && !reset
    lastWasLive = isLive
    lastSessionId = input.sessionId
    lastResetKey = input.resetKey

    const merged = merge
      ? mergeRetained(
          { ids, messagesById, messageMetaByMessage, partMetaByMessage },
          input,
        )
      : input

    const nextMap = new Map<string, UIMessage>()
    const nextIds: string[] = []
    const stabilized: UIMessage[] = []

    for (const message of merged.results) {
      const previous = messagesById.get(message.id)
      const kept =
        previous && messagesEqual(previous, message) ? previous : message
      if (kept !== previous) changed = true
      nextMap.set(message.id, kept)
      nextIds.push(message.id)
      stabilized.push(kept)
    }

    if (!arrayEqual(ids, nextIds)) {
      ids = nextIds
      changed = true
    }
    messagesById = nextMap
    results = stabilized

    const nextMessageMeta = stableMap(
      messageMetaByMessage,
      merged.messageMetaByMessage,
    )
    if (nextMessageMeta !== messageMetaByMessage) {
      messageMetaByMessage = nextMessageMeta
      changed = true
    }
    const nextPartMeta = stableMap(partMetaByMessage, merged.partMetaByMessage)
    if (nextPartMeta !== partMetaByMessage) {
      partMetaByMessage = nextPartMeta
      changed = true
    }

    groupBySender = input.groupBySender
    if (rebuildRows()) changed = true

    if (!dequal(windowMeta, input.meta)) {
      windowMeta = input.meta
      changed = true
    }

    controls = input.controls

    if (changed) listeners.forEach((listener) => listener())
  }

  return {
    subscribe,
    sync,
    evict,
    getIds: () => ids,
    getRows: () => rows,
    getWindowMetadata: () => windowMeta,
    getControls: () => controls,
    getResults: () => results,
    getMessage: (id: string): UIMessage | null => messagesById.get(id) ?? null,
    getIsLast: (id: string): boolean =>
      ids.length > 0 && ids[ids.length - 1] === id,
    getagentId: (id: string): string | undefined =>
      agentIdFromMetadata(messageMetaByMessage.get(id)),
    getMessageMetadata: (id: string): MessageRecord | undefined =>
      messageMetaByMessage.get(id),
    getMessageMetaMap: (): Map<string, MessageRecord> => messageMetaByMessage,
    getPartMetadata: (id: string): PartMetadata | undefined =>
      partMetaByMessage.get(id),
  }
}

function agentIdFromMetadata(
  metadata: MessageRecord | undefined,
): string | undefined {
  return metadata?.sender.type === 'agent' ? metadata.sender.id : undefined
}

function mapWithout<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}

/** Performs deep comparison so that consumers don't re-render on unrelated changes. */
function stableMap<T>(
  previous: Map<string, T>,
  next: Map<string, T>,
): Map<string, T> {
  const result = new Map<string, T>()
  let changed = previous.size !== next.size

  for (const [id, value] of next) {
    const prior = previous.get(id)
    const kept = prior !== undefined && dequal(prior, value) ? prior : value
    if (kept !== prior) changed = true
    result.set(id, kept)
  }

  return changed ? result : previous
}

function messagesEqual(a: UIMessage, b: UIMessage): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.role !== b.role) return false
  if (messageStatus(a) !== messageStatus(b)) return false
  if (a.parts.length !== b.parts.length) return false
  if (a.parts.some((a, i) => !dequal(a, b.parts[i]))) return false
  return true
}

function messageStatus(message: UIMessage): string | undefined {
  return (message as { status?: string }).status
}

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
