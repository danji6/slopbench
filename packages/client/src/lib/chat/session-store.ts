import type { SessionListItem, SessionParticipant } from '@/lib/chat'

import type { PaginationMetadata, PaginationStatus } from './message-store'

export type SessionStoreInput = {
  results: SessionListItem[]
  loadMore: (numItems: number) => void
  status: PaginationStatus
  activeId: string | null
  streamingIds: Set<string>
}

export type SessionStore = ReturnType<typeof createSessionStore>

/** Granular external store for the session list. */
export function createSessionStore() {
  let ids: string[] = []
  let sessionsById = new Map<string, SessionListItem>()
  let paginationMeta: PaginationMetadata = {
    status: 'LoadingFirstPage',
    isLoadingFirstPage: true,
  }
  let activeId: string | null = null
  let streamingIds = new Set<string>()
  let latestLoadMore: (numItems: number) => void = () => {}

  const listeners = new Set<() => void>()

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const sync = (input: SessionStoreInput) => {
    let changed = false

    const nextMap = new Map<string, SessionListItem>()
    const nextIds: string[] = []

    for (const session of input.results) {
      const previous = sessionsById.get(session._id)
      const kept =
        previous && sessionDisplayEqual(previous, session) ? previous : session
      if (kept !== previous) changed = true
      nextMap.set(session._id, kept)
      nextIds.push(session._id)
    }

    if (!arrayEqual(ids, nextIds)) {
      ids = nextIds
      changed = true
    }
    sessionsById = nextMap

    if (activeId !== input.activeId) {
      activeId = input.activeId
      changed = true
    }

    if (!setEqual(streamingIds, input.streamingIds)) {
      streamingIds = input.streamingIds
      changed = true
    }

    const isLoadingFirstPage = input.status === 'LoadingFirstPage'
    if (
      paginationMeta.status !== input.status ||
      paginationMeta.isLoadingFirstPage !== isLoadingFirstPage
    ) {
      paginationMeta = { status: input.status, isLoadingFirstPage }
      changed = true
    }

    latestLoadMore = input.loadMore

    if (changed) listeners.forEach((listener) => listener())
  }

  return {
    subscribe,
    sync,
    loadMore: (numItems: number) => latestLoadMore(numItems),
    getIds: () => ids,
    getSession: (id: string): SessionListItem | null =>
      sessionsById.get(id) ?? null,
    getIsActive: (id: string): boolean => id === activeId,
    getIsStreaming: (id: string): boolean => streamingIds.has(id),
    getPaginationMetadata: () => paginationMeta,
  }
}

function sessionDisplayEqual(a: SessionListItem, b: SessionListItem): boolean {
  if (a === b) return true
  return (
    a._id === b._id &&
    a.title === b.title &&
    a.lastMessageAt === b.lastMessageAt &&
    a._creationTime === b._creationTime &&
    a.lastMessagePreview === b.lastMessagePreview &&
    a.firstMessagePreview === b.firstMessagePreview &&
    a.activeAgentId === b.activeAgentId &&
    a.hidden === b.hidden &&
    participantsEqual(a.participants, b.participants)
  )
}

function participantsEqual(
  a: SessionParticipant[],
  b: SessionParticipant[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((participant, index) => {
    const other = b[index]
    return (
      participant.id === other.id &&
      participant.kind === other.kind &&
      participant.name === other.name &&
      participant.avatarId === other.avatarId
    )
  })
}

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}
