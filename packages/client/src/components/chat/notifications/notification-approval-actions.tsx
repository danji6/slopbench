import { RippleButton } from '@/components/ui'
import type {
  NotificationApprovalAction,
  NotificationApprovalOption,
} from '@sb/core/notification-actions'
import { useState } from 'react'

type NotificationApprovalActionsProps = {
  options: NotificationApprovalOption[]
  onRespond: (action: NotificationApprovalAction) => Promise<void>
}

/** Renders the same approval choices in inbox rows and notification toasts. */
export function NotificationApprovalActions({
  options,
  onRespond,
}: NotificationApprovalActionsProps) {
  const [pending, setPending] = useState(false)
  async function respond(action: NotificationApprovalAction) {
    if (pending) return
    setPending(true)
    try {
      await onRespond(action)
    } catch {
      // The shared response handler reports the error; leave the choices retryable.
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap justify-end gap-1">
      {options.map((option) => (
        <RippleButton
          key={option.action}
          variant={option.action === 'allow' ? 'primary' : 'stealth'}
          size="sm"
          title={option.description}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation()
            void respond(option.action)
          }}
        >
          {option.label}
        </RippleButton>
      ))}
    </div>
  )
}
