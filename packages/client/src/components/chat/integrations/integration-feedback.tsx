import type { IntegrationFeedback as Feedback } from '@/lib/chat/integrations'
import { extractErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

type Props = { feedback?: Feedback }

/** Displays command feedback next to the control that initiated it. */
export function IntegrationFeedback({ feedback }: Props) {
  if (!feedback) return null
  return (
    <p
      role={feedback.error ? 'alert' : 'status'}
      className={cn(
        'mt-1 max-w-sm text-xs wrap-break-word',
        feedback.error ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {feedback.error
        ? extractErrorMessage(feedback.message)
        : feedback.message}
    </p>
  )
}
