import { AnimatedToolbar } from '@/components/ui/animated-toolbar'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, KeyboardIcon, SaveIcon, XIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'

import { ChatPill, type ChatPillProps } from './chat-pill'

const DOCK_HEADER_GAP = 16

export type ChatToolbarProps = ChatPillProps & {
  /** Scroll/Pin group, shown when the viewport isn't at the bottom. */
  showScroll?: boolean
  onScrollToBottom?: () => void
  pinnable?: boolean
  pinned?: boolean
  onPinChange?: (pinned: boolean) => void
  /** Shows a dot when a stream or new messages arrive below the viewport. */
  activity?: boolean
  /** Save/Cancel group, shown while a message is being edited. */
  editing?: boolean
  onEditSave?: () => void
  onEditCancel?: () => void
}

export function ChatToolbar({
  showScroll = false,
  onScrollToBottom,
  pinnable = true,
  pinned = false,
  onPinChange,
  activity = false,
  editing = false,
  onEditSave,
  onEditCancel,
  ...props
}: ChatToolbarProps) {
  return (
    <ChatPill data-slot="chat-toolbar" {...props}>
      <AnimatedToolbar.Item visible={showScroll}>
        <ChatPill.Button
          onClick={onScrollToBottom}
          aria-label="Scroll to bottom"
          className={cn(
            'rounded-s-full',
            !pinnable && !editing && 'rounded-e-full',
          )}
        >
          <ChevronDownIcon />
          {activity && (
            <span className="bg-primary ring-m3-surface-container-low absolute top-2 right-3.5 size-2 rounded-full ring-2" />
          )}
        </ChatPill.Button>
        <AnimatedToolbar.Item visible={pinnable}>
          <ChatPill.Separator />
          <ChatPill.Button
            variant={pinned ? 'secondary' : 'stealth'}
            onClick={() => onPinChange?.(!pinned)}
            aria-label="Pin chat input"
            className={cn(!editing && 'rounded-e-full')}
          >
            <KeyboardIcon />
          </ChatPill.Button>
        </AnimatedToolbar.Item>
      </AnimatedToolbar.Item>
      <AnimatedToolbar.Item visible={editing && showScroll}>
        <ChatPill.Separator />
      </AnimatedToolbar.Item>
      <AnimatedToolbar.Item visible={editing}>
        <ChatPill.Button
          onClick={onEditCancel}
          aria-label="Cancel edit"
          className={cn(!showScroll && 'rounded-s-full')}
        >
          <XIcon />
        </ChatPill.Button>
        <ChatPill.Separator />
        <ChatPill.Button
          onClick={onEditSave}
          aria-label="Save edit"
          className="rounded-e-full"
        >
          <SaveIcon />
        </ChatPill.Button>
      </AnimatedToolbar.Item>
    </ChatPill>
  )
}

type ChatDockHeaderProps = {
  dockWidth: string
  docked: boolean
  stackHeight: number
  footerHeight: number
  widgetsHeight: number
  alertHeight: number
  toolbar?: ChatToolbarProps
  review?: React.ReactNode
}

function dockHeaderBottom({
  docked,
  stackHeight,
  footerHeight,
  widgetsHeight,
  alertHeight,
}: ChatDockHeaderProps) {
  if (!docked) return footerHeight + DOCK_HEADER_GAP
  // The toolbar shares the widgets' row, which already clears the alert.
  if (widgetsHeight) return stackHeight - widgetsHeight
  return stackHeight + alertHeight + DOCK_HEADER_GAP
}

export function ChatDockHeader(props: ChatDockHeaderProps) {
  const { dockWidth, toolbar, review } = props
  const bottom = dockHeaderBottom(props)
  const sideInset = `calc((100% - (${dockWidth})) / 2 + var(--spacing))`

  return (
    <AnimatePresence>
      {review && (
        <div
          key="review-approval"
          className="absolute"
          style={{ bottom, left: sideInset }}
        >
          {review}
        </div>
      )}
      {toolbar && (
        <ChatToolbar
          key="chat-toolbar"
          {...toolbar}
          bottom={bottom}
          className="pointer-events-auto absolute"
          style={{ right: sideInset }}
        />
      )}
    </AnimatePresence>
  )
}
