import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'

import { ChatScrollbar } from './chat-scrollbar'

export type ChatLayoutProps = {
  /** The main scrollable content with bottom padding compensation. */
  mainContent: (bottomPadding: number) => React.ReactNode
  /** Content that sits at the bottom of the layout. */
  dock: React.ReactNode
  /** Space at the bottom of the viewport the dock has to stay clear of. */
  bottomInset?: number
  /** Content above the dock. */
  dockHeader?: (bottomPadding: number) => React.ReactNode
  /** Content below the dock. */
  dockFooter?: React.ReactNode
  showDockFooter?: boolean
  dockFooterWidth?: string
  /** Whether to render a custom scrollbar. */
  scrollbar?: boolean
}

const FOOTER_SPRING = { type: 'spring', stiffness: 500, damping: 40 } as const
const FOOTER_BASELINE = '0.75rem'

export function ChatLayout({
  mainContent,
  dock,
  bottomInset = 0,
  dockFooter,
  showDockFooter = false,
  dockFooterWidth,
  dockHeader,
  scrollbar,
}: ChatLayoutProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [bottomHeight, setBottomHeight] = useState(0)

  useLayoutEffect(() => {
    const el = bottomRef.current
    if (!el) return
    // Synchronous first read before paint, then track subsequent changes
    setBottomHeight(el.getBoundingClientRect().height)
    const observer = new ResizeObserver(([entry]) => {
      setBottomHeight(
        entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-y-clip">
      {scrollbar && <ChatScrollbar />}
      {mainContent(bottomHeight + bottomInset)}
      <div
        className="pointer-events-none sticky inset-x-0 bottom-0 z-10 h-0"
        style={{ bottom: bottomInset }}
      >
        {/* Offsets within the docked stack, which the inset already lifted */}
        {dockHeader?.(bottomHeight)}
        <div
          ref={bottomRef}
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center',
            dockFooter ? 'pb-1' : 'pb-4',
          )}
        >
          {dock}
          {dockFooter && (
            <motion.div
              initial={false}
              animate={{
                height: showDockFooter ? 'auto' : FOOTER_BASELINE,
                opacity: showDockFooter ? 1 : 0,
              }}
              transition={FOOTER_SPRING}
              className="overflow-hidden"
              style={dockFooterWidth ? { width: dockFooterWidth } : undefined}
            >
              <div className="flex px-1 pt-1.5">{dockFooter}</div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
