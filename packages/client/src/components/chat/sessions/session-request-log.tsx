import { Code, Dialog, RippleButton, SettingsList } from '@/components/ui'
import { useActiveSession } from '@/hooks/chat'
import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'

export function SessionRequestLogSection() {
  const session = useActiveSession()
  const [open, setOpen] = useState(false)
  const metadata = session?.metadata
  const hasStoredLog = Boolean(metadata?.log)
  const logUrls = useQuery(
    api.sessions.getLogUrls,
    open && session && hasStoredLog ? { sessionId: session._id } : 'skip',
  )
  const logUrl = normalizeBrowserUrl(logUrls?.logUrl)
  const [storedLog, setStoredLog] = useState<{
    url?: string | null
    error?: string
    requestBody?: string
    responseBody?: string
  }>({})
  const visibleStoredLog = storedLog.url === logUrl ? storedLog : undefined
  const requestBody = visibleStoredLog?.requestBody
  const responseBody = visibleStoredLog?.responseBody
  const logBody = useMemo(
    () => buildRequestLogBody(requestBody, responseBody),
    [requestBody, responseBody],
  )
  const loadingLog =
    open &&
    hasStoredLog &&
    (logUrls === undefined || Boolean(logUrl)) &&
    !visibleStoredLog

  useEffect(() => {
    if (!open || !hasStoredLog || !logUrl) return

    const controller = new AbortController()

    void fetchLogBody(logUrl, controller.signal)
      .then((body) => {
        setStoredLog({ url: logUrl, ...parseStoredLogBody(body) })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setStoredLog({
          url: logUrl,
          error: err instanceof Error ? err.message : String(err),
        })
      })

    return () => controller.abort()
  }, [open, hasStoredLog, logUrl])

  return (
    <SettingsList>
      <SettingsList.Item unclickable label="Request log">
        <RippleButton
          variant="input"
          onClick={() => setOpen(true)}
          className="w-32"
        >
          View
        </RippleButton>
        <Dialog open={open} onOpenChange={setOpen}>
          <Dialog.Content className="sm:max-w-5xl">
            <Dialog.Header>
              <Dialog.Title>Request Log</Dialog.Title>
            </Dialog.Header>
            {loadingLog ? (
              <p className="text-muted-foreground text-sm">
                Loading request log…
              </p>
            ) : visibleStoredLog?.error ? (
              <p className="text-destructive text-sm">
                {visibleStoredLog.error}
              </p>
            ) : logBody ? (
              <Code
                text={logBody}
                language="json"
                hugParent
                innerClassName="max-h-[min(90svh,800px)]"
              />
            ) : hasStoredLog ? (
              <p className="text-muted-foreground text-sm">
                Request log is unavailable.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                No request has been captured yet. Send a message to populate it.
              </p>
            )}
          </Dialog.Content>
        </Dialog>
      </SettingsList.Item>
    </SettingsList>
  )
}

async function fetchLogBody(url: string | null, signal: AbortSignal) {
  if (!url) return undefined

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Failed to load request log.')
  return response.text()
}

function parseStoredLogBody(body: string | undefined) {
  if (!body) return {}

  try {
    const log = JSON.parse(body) as {
      requestBody?: unknown
      responseBody?: unknown
    }
    return {
      requestBody:
        typeof log.requestBody === 'string' ? log.requestBody : undefined,
      responseBody:
        typeof log.responseBody === 'string' ? log.responseBody : undefined,
    }
  } catch {
    return { requestBody: body }
  }
}

function buildRequestLogBody(requestBody?: string, responseBody?: string) {
  if (!requestBody && !responseBody) return null

  return JSON.stringify(
    {
      request: requestBody ? parseJsonBody(requestBody) : 'Not captured yet.',
      response: responseBody
        ? parseJsonBody(responseBody)
        : 'Awaiting response…',
    },
    null,
    2,
  )
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}
