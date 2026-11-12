import { createOptionalContext } from '@/hooks/context'
import type { ScrollCoordinator } from '@/lib/scroll-coordinator'
import { useLayoutEffect } from 'react'

/** Releases a provisional dock hold unless the reveal requested a scroll. */
export type FinishComposerReveal = (scrolled: boolean) => void

type MessageListContextValue = {
  scrollRef: React.RefObject<HTMLElement | null>
  scrollCoordinator?: ScrollCoordinator
  onLayoutChange: () => void
  onIntoViewSettle?: () => void
  releaseFollow: () => void
  resumeFollow: () => void
  trackPendingLayout?: () => () => void
  holdComposerForReveal?: (
    messageId: string,
  ) => FinishComposerReveal | undefined
  shellFocusBlocked?: boolean
  restoreComposerFocus?: (input: HTMLElement) => void
  bottomPadding: number
  topPadding: number
}

export const [MessageListContext, useMessageList] =
  createOptionalContext<MessageListContextValue>()

/** Keeps edge navigation active until a mounted row's initial data arrives. */
export function usePendingMessageLayout(pending: boolean) {
  const track = useMessageList()?.trackPendingLayout
  useLayoutEffect(() => {
    if (pending) return track?.()
  }, [pending, track])
}
