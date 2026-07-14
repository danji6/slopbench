import { BellOffIcon, PlayIcon } from 'lucide-react'
import { useRef } from 'react'

import { ContextMenu, SendButton as SendButtonPrimitive, T } from '../../ui'

type SendButton = {
  isStop: boolean
  disabled: boolean
  canSendSilently: boolean
  canContinueAgent: boolean
  onSend: (silent: boolean) => void
  onStop?: () => void
  onContinueAgent?: () => void
}

/**
 * The send button, augmented with a right-click / long-press menu for secondary
 * send actions.
 */
export function SendButton({
  isStop,
  disabled,
  canSendSilently,
  canContinueAgent,
  onSend,
  onStop,
  onContinueAgent,
}: SendButton) {
  // Suppress click when the context menu is opened to avoid sending
  const suppressClickUntil = useRef(0)

  return (
    <ContextMenu
      disabled={!canSendSilently && !canContinueAgent}
      onOpen={() => {
        suppressClickUntil.current = Date.now() + 700
      }}
    >
      <ContextMenu.Trigger>
        <SendButtonPrimitive
          isStop={isStop}
          disabled={disabled}
          onClick={() => {
            if (Date.now() < suppressClickUntil.current) return
            if (isStop) onStop?.()
            else if (!disabled) onSend(false)
          }}
          size="icon"
          aria-label="Send"
          className="mr-1.5 ml-2 size-10"
        />
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        {canSendSilently && (
          <ContextMenu.Item onSelect={() => onSend(true)}>
            <BellOffIcon />
            Send silently
            <T.kbd className="ml-2">⌃↵</T.kbd>
          </ContextMenu.Item>
        )}
        {canContinueAgent && (
          <ContextMenu.Item onSelect={() => onContinueAgent?.()}>
            <PlayIcon />
            Continue
            {!canSendSilently && <T.kbd className="ml-2">↵</T.kbd>}
          </ContextMenu.Item>
        )}
      </ContextMenu.Content>
    </ContextMenu>
  )
}
