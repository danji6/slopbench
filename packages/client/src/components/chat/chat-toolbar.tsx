import { AnimatedToolbar } from '@/components/ui/animated-toolbar'
import { ChevronDownIcon, KeyboardIcon, SaveIcon, XIcon } from 'lucide-react'

import { ChatPill, type ChatPillProps } from './chat-pill'

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
          className="relative"
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
          >
            <KeyboardIcon />
          </ChatPill.Button>
        </AnimatedToolbar.Item>
      </AnimatedToolbar.Item>
      <AnimatedToolbar.Item visible={editing && showScroll}>
        <ChatPill.Separator />
      </AnimatedToolbar.Item>
      <AnimatedToolbar.Item visible={editing}>
        <ChatPill.Button onClick={onEditCancel} aria-label="Cancel edit">
          <XIcon />
        </ChatPill.Button>
        <ChatPill.Separator />
        <ChatPill.Button onClick={onEditSave} aria-label="Save edit">
          <SaveIcon />
        </ChatPill.Button>
      </AnimatedToolbar.Item>
    </ChatPill>
  )
}
