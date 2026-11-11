import { Button } from '../../ui'

type ComposerSendFailureProps = {
  sendDisabled: boolean
  sending: boolean
  onRetry: () => void
  onDismiss: () => void
}

export function ComposerSendFailure({
  sendDisabled,
  sending,
  onRetry,
  onDismiss,
}: ComposerSendFailureProps) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-3 text-xs">
      <span className="mr-auto">Message failed to send</span>
      <Button
        size="sm"
        variant="surface"
        disabled={sending || sendDisabled}
        onClick={onRetry}
      >
        Retry
      </Button>
      <Button size="sm" variant="ghost" disabled={sending} onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
