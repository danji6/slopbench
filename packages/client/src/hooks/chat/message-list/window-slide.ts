import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { useCallback, useLayoutEffect, useRef } from 'react'

import { type OlderPagesOptions, useOlderMessagePages } from './older-pages'
import { useWindowPosition } from './window-position'

type WindowSlideOptions = {
  extendOlder: OlderPagesOptions['extendOlder']
  extendNewer: () => boolean
  isSliding: boolean
  older: Omit<OlderPagesOptions, 'extendOlder' | 'coordinator' | 'onCancel'>
}

/** Loads bounded pages while preserving visible content throughout the operation. */
export function useWindowSlide(
  deps: ScrollDeps,
  {
    extendOlder,
    extendNewer,
    isSliding,
    older: olderOptions,
  }: WindowSlideOptions,
) {
  const {
    metaRef,
    scroller: { coordinator },
  } = deps
  const position = useWindowPosition(deps)
  const { start, finish, cancel: cancelPosition, slidePendingRef } = position
  const {
    loadOlder: requestOlder,
    cancel: cancelOlder,
    isLoadingOlder: olderLoading,
    isSliding: olderSliding,
  } = useOlderMessagePages({
    ...olderOptions,
    extendOlder,
    coordinator,
    onCancel: cancelPosition,
  })

  const loadOlder = useCallback(() => {
    const meta = metaRef.current
    if (!meta.canLoadOlder || meta.isLoadingOlder || meta.isLoadingNewer) return
    if (requestOlder()) start('older')
  }, [metaRef, requestOlder, start])

  const loadNewer = useCallback(() => {
    const meta = metaRef.current
    if (!meta.canLoadNewer || meta.isLoadingNewer) return
    cancelOlder()
    if (extendNewer()) start('newer')
  }, [metaRef, cancelOlder, extendNewer, start])

  const prevSlidingRef = useRef(isSliding)
  const prevOlderRef = useRef(olderLoading)
  useLayoutEffect(() => {
    const wasSliding = prevSlidingRef.current
    const wasOlder = prevOlderRef.current
    prevSlidingRef.current = isSliding
    prevOlderRef.current = olderLoading
    const completed = (wasOlder && !olderLoading) || (wasSliding && !isSliding)
    if (completed && !olderLoading && slidePendingRef.current) finish()
  }, [isSliding, olderLoading, slidePendingRef, finish])

  return {
    loadOlder,
    loadNewer,
    slidePendingRef,
    pendingPageRef: position.pendingPageRef,
    isPositioning: position.isPositioning,
    isLoadingOlder:
      olderLoading ||
      olderOptions.meta.isLoadingOlder ||
      position.isPositioningOlder,
    isSliding: olderSliding || isSliding,
  }
}

export type WindowSlide = ReturnType<typeof useWindowSlide>
