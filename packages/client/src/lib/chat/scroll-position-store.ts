import { createLocalStorageStore } from '../local-storage-store'

const STORAGE_KEY = 'chat-scroll-positions'

/** How many sessions retain a saved scroll position before the oldest is evicted. */
const MAX_ENTRIES = 100

export type SavedScroll = {
  anchorId: string
  creationTime: number
  segmentIndex?: number
  /** Stable key of the exact row, for sub-message alignment. */
  rowKey?: string
  /** Offset (px) of the anchor's top from the nav-padding line. */
  offset: number
  /** Whether the user was pinned to the bottom when they left. */
  following: boolean
  /** Last touched timestamp, for LRU eviction. */
  updatedAt: number
}

type ScrollPositions = Record<string, SavedScroll>

const store = createLocalStorageStore<ScrollPositions>(STORAGE_KEY)

export function getSavedScroll(sessionId: string): SavedScroll | undefined {
  return store.get()[sessionId]
}

export function setSavedScroll(
  sessionId: string,
  position: Omit<SavedScroll, 'updatedAt'>,
): void {
  const entry: SavedScroll = { ...position, updatedAt: Date.now() }
  const next: ScrollPositions = { ...store.get(), [sessionId]: entry }

  const patch: Partial<ScrollPositions> = { [sessionId]: entry }
  for (const key of evictableKeys(next)) patch[key] = undefined
  store.set(patch)
}

export function clearSavedScroll(sessionId: string): void {
  store.set({ [sessionId]: undefined } as Partial<ScrollPositions>)
}

function evictableKeys(positions: ScrollPositions): string[] {
  const keys = Object.keys(positions)
  if (keys.length <= MAX_ENTRIES) return []
  return keys
    .sort((a, b) => positions[a].updatedAt - positions[b].updatedAt)
    .slice(0, keys.length - MAX_ENTRIES)
}
