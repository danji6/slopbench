import { createOptionalContext } from '@/hooks/context'
import { useLayoutEffect } from 'react'

type MessageListContextValue = {
  scrollRef: React.RefObject<HTMLElement | null>
  onLayoutChange: () => void
  onIntoViewSettle?: () => void
  releaseFollow: () => void
  resumeFollow: () => void
  trackPendingLayout?: () => () => void
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
