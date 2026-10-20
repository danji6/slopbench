import { RippleButton } from '@/components/ui'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation, usePaginatedQuery } from 'convex/react'
import { useState } from 'react'

/** Shows saved session connections; reconnect starts lazily on the next tool call. */
export function McpRuntimes({ serverKey }: { serverKey: string }) {
  const {
    results: rows,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.mcp.runtimes,
    { serverKey },
    { initialNumItems: 10 },
  )
  const control = useMutation(api.mcp.controlRuntime)
  const inspect = useAction(api.actions.mcp.runtimeStatus)
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(
    runtimeId: Id<'mcpRuntimes'>,
    operation: 'inspect' | 'disconnect' | 'reconnect',
  ) {
    setBusy(true)
    try {
      if (operation === 'inspect') {
        const status = await inspect({ runtimeId })
        setDetails(
          status
            ? [status.state, status.reason, status.stderr]
                .filter(Boolean)
                .join('\n')
            : 'No active process. Check the saved connection state below.',
        )
      } else {
        await control({ runtimeId, reconnect: operation === 'reconnect' })
        setDetails(
          operation === 'reconnect'
            ? 'Reconnect prepared for the next tool call.'
            : 'Disconnected. Cleanup is scheduled.',
        )
      }
    } catch (error) {
      setDetails(
        error instanceof Error ? error.message : 'Connection operation failed',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!rows?.length) return null

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      <span className="text-muted-foreground text-xs">Session connections</span>
      {rows.map((row) => (
        <div
          key={row._id}
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate" title={row.sessionId}>
            {row.sessionId}: {row.state}
          </span>
          {(['inspect', 'disconnect', 'reconnect'] as const).map(
            (operation) => (
              <RippleButton
                key={operation}
                type="button"
                size="sm"
                variant="stealth"
                disabled={busy}
                onClick={() => act(row._id, operation)}
              >
                {operation}
              </RippleButton>
            ),
          )}
          {row.reason && (
            <p className="text-muted-foreground w-full">{row.reason}</p>
          )}
        </div>
      ))}
      {status === 'CanLoadMore' && (
        <RippleButton type="button" size="sm" onClick={() => loadMore(10)}>
          Load more connections
        </RippleButton>
      )}
      {details && (
        <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">
          {details}
        </pre>
      )}
    </div>
  )
}
