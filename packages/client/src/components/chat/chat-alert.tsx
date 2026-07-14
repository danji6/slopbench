import { AlertMessage, Button } from '@/components/ui'
import type { AlertMessageProps } from '@/components/ui'
import { useActiveSession } from '@/hooks/chat'
import { ChatWarning, RateLimitError } from '@/lib/chat/errors'
import { formatLongDuration } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'

export type ChatAlertProps = AlertMessageProps & {
  error: Error | null
  onDismiss?: () => void
}

export function ChatAlert({ error, onDismiss, ...props }: ChatAlertProps) {
  const session = useActiveSession()
  const retryStreamNow = useMutation(api.chat.retryStreamNow)
  const isRateLimited = error instanceof RateLimitError
  const isWarning = isRateLimited || error instanceof ChatWarning
  const variant = isWarning ? 'warning' : 'error'
  const [countdown, setCountdown] = useState<{
    retryAt?: number
    remaining: number
  } | null>(null)

  useEffect(() => {
    if (!(error instanceof RateLimitError)) {
      return
    }

    const updateCountdown = () => {
      const remaining =
        error.retryAt === undefined
          ? error.nextRetryDelay
          : Math.max(0, error.retryAt - Date.now())
      setCountdown({ retryAt: error.retryAt, remaining })
    }

    const timeout = setTimeout(updateCountdown, 0)
    const interval = setInterval(updateCountdown, 1000)

    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [error])

  if (!error) {
    return null
  }

  const retryNow = async () => {
    if (!session || !(error instanceof RateLimitError)) return
    await retryStreamNow({ sessionId: session._id })
  }

  const displayCountdown =
    isRateLimited && countdown?.retryAt === error.retryAt
      ? (countdown?.remaining ?? null)
      : null

  if (displayCountdown != null && displayCountdown >= 0) {
    return (
      <AlertMessage
        onDismiss={onDismiss}
        variant={variant}
        dismissible={false}
        childrenClassName="flex items-center"
        {...props}
      >
        <span className="flex-1">
          Rate limited, retrying in {formatLongDuration(displayCountdown)}...
        </span>
        <Button
          size="sm"
          variant="surface"
          onClick={() => void retryNow()}
          className="bg-warning/10 text-warning hover:bg-warning/20 h-6 rounded-full px-2 py-2 text-xs"
        >
          Retry now
        </Button>
      </AlertMessage>
    )
  }

  return (
    <AlertMessage onDismiss={onDismiss} variant={variant} {...props}>
      {error.message}
    </AlertMessage>
  )
}
