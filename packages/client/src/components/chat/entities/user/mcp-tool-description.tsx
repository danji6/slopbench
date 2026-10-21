import { RippleButton, Textarea } from '@/components/ui'
import { RotateCcwIcon } from 'lucide-react'
import { useId } from 'react'

type Props = {
  description?: string
  override?: string
  onChange: (value: string | undefined) => void
  loading?: boolean
  error?: string
  onRetry?: () => void
}

/** Edits an override only after the complete original description is available. */
export function McpToolDescription({
  description,
  override,
  onChange,
  loading,
  error,
  onRetry,
}: Props) {
  const id = useId()
  const originalLoaded = description !== undefined && !loading && !error
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-muted-foreground text-xs">
          Tool description:
        </label>
        <RippleButton
          type="button"
          size="sm"
          variant="stealth"
          aria-label="Reset tool description to original"
          disabled={override === undefined || !originalLoaded}
          className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
          onClick={() => onChange(undefined)}
        >
          <RotateCcwIcon className="size-3.5" />
          Reset
        </RippleButton>
      </div>
      <Textarea
        id={id}
        value={override ?? description ?? ''}
        disabled={!originalLoaded}
        aria-busy={loading || undefined}
        placeholder={originalLoaded ? 'No description provided' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="max-h-48 min-h-20 text-sm"
      />
      {loading && (
        <p className="text-muted-foreground text-xs" role="status">
          Loading full description…
        </p>
      )}
      {error && (
        <div className="flex items-center gap-2">
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
          {onRetry && (
            <RippleButton
              type="button"
              size="sm"
              variant="stealth"
              onClick={onRetry}
            >
              Retry
            </RippleButton>
          )}
        </div>
      )}
    </div>
  )
}
