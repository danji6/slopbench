import type { useScroller } from '@/hooks/scroller'
import type { MessageRow } from '@/lib/chat/rows'
import type { RefObject } from 'react'
import type { WindowVirtualizerHandle } from 'virtua'

export type WindowMeta = {
  canLoadOlder: boolean
  canLoadNewer: boolean
  isAtLiveTail: boolean
  isLoadingOlder: boolean
  isLoadingNewer: boolean
}

/** Shared scroll primitives every message-list hook leans on. */
export type ScrollDeps = {
  scroller: ReturnType<typeof useScroller>
  virtuaRef: RefObject<WindowVirtualizerHandle | null>
  rowsRef: RefObject<MessageRow[]>
  metaRef: RefObject<WindowMeta>
  docScrollRef: RefObject<HTMLElement | null>
  /** Resolved nav padding (top). */
  topPadding: number
}
