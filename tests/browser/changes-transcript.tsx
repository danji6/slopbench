import { GrowOnly } from '@/components/chat/messages/grow-only'
import { MessageListContext } from '@/components/chat/messages/message-list/message-list-context'
import { useScroller } from '@/hooks/scroller'
import { useEffect, useRef } from 'react'
import { WindowVirtualizer } from 'virtua'

const rows = Array.from({ length: 22 }, (_, index) => index)

/** Exercises summary expansion with the production scroller and virtualizer. */
export function ChangesTranscript({ children }: { children: React.ReactNode }) {
  const {
    coordinator,
    scrollRef,
    sentinelRef,
    setReady,
    scrollToBottom,
    holdLayoutPosition,
    holdPosition,
    unlockScroll,
  } = useScroller({ mode: 'window', bottomInset: 80 })
  const docScrollRef = useRef<HTMLElement | null>(document.documentElement)
  useEffect(() => {
    setReady(true)
    scrollToBottom(true)
  }, [setReady, scrollToBottom])

  return (
    <MessageListContext
      value={{
        scrollRef: docScrollRef,
        onLayoutChange: holdLayoutPosition,
        releaseFollow: holdPosition,
        resumeFollow: () => unlockScroll(true),
        trackPendingLayout: coordinator.trackPendingLayout,
        bottomPadding: 80,
        topPadding: 16,
      }}
    >
      <div
        ref={scrollRef as React.RefObject<HTMLDivElement | null>}
        className="pb-20"
      >
        <WindowVirtualizer data={rows}>
          {(row) => (
            <article data-row-key={`row-${row}`}>
              {row === 20 ? (
                <GrowOnly data-testid="summary-row">{children}</GrowOnly>
              ) : (
                <div style={{ height: row === 21 ? 220 : 80 }}>
                  Message {row}
                </div>
              )}
            </article>
          )}
        </WindowVirtualizer>
        <div ref={sentinelRef} className="h-px" />
      </div>
    </MessageListContext>
  )
}
