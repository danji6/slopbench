import { AlertMessage, RippleButton } from '@/components/ui'
import type { useAgentFileOperation } from '@/hooks/chat/skills'

export function FileOperationStatus({
  operation,
}: {
  operation: ReturnType<typeof useAgentFileOperation>
}) {
  return (
    <>
      {operation.busy && (
        <p role="status" className="text-muted-foreground text-sm">
          Updating files…
        </p>
      )}
      {operation.error && (
        <AlertMessage dismissible={false}>{operation.error}</AlertMessage>
      )}
      {operation.summary && (
        <p role="status" className="text-muted-foreground text-sm">
          {operation.summary.installed} installed, {operation.summary.skipped}{' '}
          already present, {operation.summary.failed} failed.
        </p>
      )}
      {!operation.busy && operation.retry && (
        <RippleButton
          type="button"
          variant="secondary"
          onClick={() => void operation.retry?.()}
        >
          Retry
        </RippleButton>
      )}
    </>
  )
}
