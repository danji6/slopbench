import { createOptionalContext } from '@/hooks/context'

type MessageListContextValue = {
  scrollRef: React.RefObject<HTMLElement | null>
  onLayoutChange: () => void
  onIntoViewSettle?: () => void
  releaseFollow: () => void
  resumeFollow: () => void
  bottomPadding: number
  topPadding: number
}

export const [MessageListContext, useMessageList] =
  createOptionalContext<MessageListContextValue>()
