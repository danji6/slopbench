import type { McpProgress as Progress } from '@sb/core/types/mcp-operation'

/** Shows server progress without inventing a percentage for unbounded work. */
export function McpProgress({ progress }: { progress?: Progress }) {
  if (!progress) return null
  const { total, message } = progress
  const bounded = total !== undefined && total > 0
  return (
    <span role="status" className="text-muted-foreground text-xs">
      {message && <span>{message} · </span>}
      {bounded ? `${progress.progress} / ${total}` : progress.progress}
    </span>
  )
}
