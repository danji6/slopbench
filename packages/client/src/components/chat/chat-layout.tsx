import { FadingGradient } from '@/components/ui'
import { useElementHeight } from '@/hooks/measure'

import { ChatScrollbar } from './chat-scrollbar'

export type ChatLayoutProps = {
  /** The main scrollable content with bottom padding compensation. */
  mainContent: (bottomPadding: number) => React.ReactNode
  /** Content that sits at the bottom of the layout. */
  dock: React.ReactNode
  /** Space at the bottom of the viewport the dock has to stay clear of. */
  bottomInset?: number
  /** Content above the dock or the footer when the dock is hidden. */
  dockHeader?: (stackHeight: number, footerHeight: number) => React.ReactNode
  /** Content below the dock. */
  dockFooter?: React.ReactNode
  dockFooterWidth?: string
  /** Whether to render a custom scrollbar. */
  scrollbar?: boolean
}

export function ChatLayout({
  mainContent,
  dock,
  bottomInset = 0,
  dockFooter,
  dockFooterWidth,
  dockHeader,
  scrollbar,
}: ChatLayoutProps) {
  const [bottomRef, bottomHeight] = useElementHeight<HTMLDivElement>()
  const [footerRef, footerHeight] = useElementHeight<HTMLDivElement>()

  return (
    <div
      data-slot="chat-layout"
      className="relative flex min-h-dvh flex-1 flex-col overflow-y-clip"
    >
      {scrollbar && <ChatScrollbar />}
      {mainContent(bottomHeight + bottomInset)}
      <div
        className="pointer-events-none sticky inset-x-0 bottom-0 z-10 h-0"
        style={{ bottom: bottomInset }}
      >
        {/* Offsets within the docked stack, which the inset already lifted */}
        {dockHeader?.(bottomHeight, footerHeight)}
        <div
          ref={bottomRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center"
        >
          {dock}
          <div
            ref={footerRef}
            className="relative -z-10 flex w-full justify-center pb-1"
          >
            <FadingGradient className="-top-8 -z-10 h-auto rounded-none" />
            <div
              className="flex min-h-6 items-center px-1 pt-1.5 pb-0.5"
              style={dockFooterWidth ? { width: dockFooterWidth } : undefined}
            >
              {dockFooter}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
