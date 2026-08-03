import { extractErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useConvexAuth } from 'convex/react'
import { RotateCwIcon } from 'lucide-react'
import {
  ErrorBoundary as Boundary,
  type FallbackProps,
} from 'react-error-boundary'
import { toast } from 'sonner'

import { AlertMessage } from './alert-message'
import { RippleButton } from './ripple-button'

export type { FallbackProps }

export type ErrorBoundaryProps = {
  children: React.ReactNode
  /** What on changing makes the subtree worth rendering again. */
  resetKeys?: unknown[]
  fallback?: (props: FallbackProps) => React.ReactNode
  onError?: (error: unknown) => void
}

/** Contains a render-time throw to the subtree it wraps. */
export function ErrorBoundary({
  children,
  resetKeys = [],
  fallback = (props) => <ErrorFallback {...props} />,
  onError,
}: ErrorBoundaryProps) {
  const { isAuthenticated } = useConvexAuth()

  return (
    <Boundary
      resetKeys={[isAuthenticated, ...resetKeys]}
      fallbackRender={fallback}
      onError={onError}
    >
      {children}
    </Boundary>
  )
}

/** For a dialog mounted on its own with nothing preserve. */
export function DialogErrorBoundary({
  children,
  resetKeys,
}: Pick<ErrorBoundaryProps, 'children' | 'resetKeys'>) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      fallback={() => null}
      onError={(error) => toast.error(extractErrorMessage(error))}
    >
      {children}
    </ErrorBoundary>
  )
}

/** Inline failure notice for a panel the rest of the app can live without. */
export function ErrorFallback({
  error,
  resetErrorBoundary,
  className,
}: FallbackProps & { className?: string }) {
  return (
    <AlertMessage dismissible={false} className={cn('m-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <span>{extractErrorMessage(error)}</span>
        <RippleButton
          variant="stealth"
          size="sm"
          onClick={resetErrorBoundary}
          className="shrink-0"
        >
          <RotateCwIcon />
          Try again
        </RippleButton>
      </div>
    </AlertMessage>
  )
}

/** Last resort for a throw nothing else caught. */
export function AppErrorFallback({ error }: FallbackProps) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          {extractErrorMessage(error)}
        </p>
      </div>
      <RippleButton onClick={() => window.location.reload()}>
        <RotateCwIcon />
        Reload
      </RippleButton>
    </div>
  )
}
