import { Code, Dialog, RippleButton, SettingsList } from '@/components/ui'
import { useActiveSession, useActiveSessionState } from '@/hooks/chat'
import { useRequestLogSnapshot } from '@/hooks/chat/request-log'
import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import { extractErrorMessage } from '@/lib/errors'
import { api } from '@cv/convex/_generated/api'
import type { Id } from '@cv/convex/_generated/dataModel'
import type { CacheDiagnostic } from '@cv/convex/types'
import { useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'

type OpenedLog = {
  sessionId: Id<'sessions'>
  hasStoredLog: boolean
}

type StoredLog = {
  url?: string | null
  error?: string
  requestBody?: string
  responseBody?: string
}

export function SessionRequestLogSection() {
  const session = useActiveSession()
  const state = useActiveSessionState()
  const [opened, setOpened] = useState<OpenedLog | null>(null)
  const open = Boolean(opened)
  const hasStoredLog = opened?.hasStoredLog ?? false
  const logUrls = useQuery(
    api.sessions.getLogUrls,
    opened ? { sessionId: opened.sessionId } : 'skip',
  )
  const snapshot = useRequestLogSnapshot(logUrls, open)
  const logUrl = normalizeBrowserUrl(snapshot?.logUrl)
  const cacheDiagnostics = snapshot?.cacheDiagnostics
  const [storedLog, setStoredLog] = useState<StoredLog>({})
  const visibleStoredLog = storedLog.url === logUrl ? storedLog : undefined
  const requestBody = visibleStoredLog?.requestBody
  const responseBody = visibleStoredLog?.responseBody

  const logBody = useMemo(
    () => buildRequestLogBody(requestBody, responseBody, cacheDiagnostics),
    [requestBody, responseBody, cacheDiagnostics],
  )

  const pendingLog =
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
          error: extractErrorMessage(err),
        })
      })

    return () => controller.abort()
  }, [open, hasStoredLog, logUrl])

  return (
    <SettingsList>
      <SettingsList.Item unclickable label="Request log">
        <RippleButton
          variant="input"
          onClick={() =>
            session &&
            setOpened({
              sessionId: session._id,
              hasStoredLog: Boolean(state?.hasLog),
            })
          }
          className="w-32"
        >
          View
        </RippleButton>
        <Dialog open={open} onOpenChange={(next) => !next && setOpened(null)}>
          <Dialog.Content className="grid h-[calc(100svh-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <Dialog.Header>
              <Dialog.Title>Request Log</Dialog.Title>
            </Dialog.Header>
            {pendingLog ? null : visibleStoredLog?.error &&
              !cacheDiagnostics?.length ? (
              <p className="text-destructive text-sm">
                {visibleStoredLog.error}
              </p>
            ) : logBody ? (
              <Code
                text={logBody}
                language="json"
                hugParent
                noLoadingIndicator
                className="h-full"
                innerClassName="h-full"
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

function buildRequestLogBody(
  requestBody?: string,
  responseBody?: string,
  cacheDiagnostics?: CacheDiagnostic[],
) {
  if (!requestBody && !responseBody && !cacheDiagnostics?.length) return null

  return JSON.stringify(
    {
      request: requestBody ? parseJsonBody(requestBody) : 'Not captured yet.',
      response: responseBody
        ? parseJsonBody(responseBody)
        : 'Awaiting response…',
      ...(cacheDiagnostics?.length ? { cacheDiagnostics } : {}),
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
