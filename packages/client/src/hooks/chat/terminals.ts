import { convexSiteUrl, getConvexToken } from '@/hooks/http'
import type { ShellJobStatus, ShellJobSummary } from '@/lib/chat'
import {
  type ListShellJobs,
  dropShellJob,
  findShellJob,
  getShellJobs,
  retainShellJobs,
  subscribeToShellJobs,
} from '@/lib/chat/shell-jobs-store'
import { type SseFrame, readSse } from '@/lib/sse'
import { sleep } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

const RECONNECT_DELAY_MS = 500
// Matches the sidecar's terminal-tail cap (see model/tool/shell.ts)
const TERM_TAIL_CHARS = 48_000

export type SessionJobs = {
  jobs: ShellJobSummary[]
  /** Optimistically remove a job. */
  dropJob: (jobId: string) => void
}

/** Subscribes to the session's sidecar jobs, polled once for all consumers. */
export function useSessionJobs(
  sessionId: Id<'sessions'> | null,
  enabled = true,
): SessionJobs {
  const list = useAction(api.actions.terminals.list) as ListShellJobs
  const jobs = useSyncExternalStore(subscribeToShellJobs, getShellJobs)

  useEffect(
    () => retainShellJobs(enabled ? sessionId : null, list),
    [sessionId, enabled, list],
  )

  return { jobs: sessionId && enabled ? jobs : [], dropJob: dropShellJob }
}

/**
 * The live job a tool call is running, if any. Lets a terminal reattach to a
 * job the persisted tool output knows nothing about.
 */
export function useLiveShellJob(
  sessionId: Id<'sessions'> | null,
  enabled: boolean,
  toolCallId: string | undefined,
  jobId?: string,
): ShellJobSummary | undefined {
  const { jobs } = useSessionJobs(sessionId, enabled)

  return useMemo(
    () => findShellJob(jobs, jobId, toolCallId),
    [jobs, toolCallId, jobId],
  )
}

export type JobTail = {
  term: string
  termOffset: number
  status: ShellJobStatus | undefined
  /** Sidecar reports the terminal is blocked waiting for input. */
  waiting: boolean
}

const EMPTY_TAIL: JobTail = {
  term: '',
  termOffset: 0,
  status: undefined,
  waiting: false,
}

// Cache tails to keep the DOM stable
const tailCache = new Map<string, JobTail>()

/**
 * Tails a running job's output via SSE stream proxied by Convex.
 * Reconnects from the last offset when the stream closes.
 */
export function useJobTail(
  sessionId: Id<'sessions'> | null,
  jobId: string,
  enabled: boolean,
): JobTail {
  const cacheKey = `${sessionId}:${jobId}`
  const [tail, setTail] = useState<JobTail>(
    () => tailCache.get(cacheKey) ?? EMPTY_TAIL,
  )

  useEffect(() => {
    if (!enabled || !sessionId || !jobId) return

    const key = `${sessionId}:${jobId}`
    let active = true
    let controller: AbortController | null = null
    let offset = 0
    let buffer = ''
    let status: ShellJobStatus | undefined = tailCache.get(key)?.status
    let waiting = tailCache.get(key)?.waiting ?? false

    const update = (next: JobTail) => {
      const prev = tailCache.get(key)
      tailCache.set(key, next)

      // Skip re-renders when nothing changed
      if (
        prev &&
        prev.term === next.term &&
        prev.termOffset === next.termOffset &&
        prev.status === next.status &&
        prev.waiting === next.waiting
      ) {
        return
      }
      setTail(next)
    }

    const emit = () =>
      update({
        term: buffer,
        termOffset: offset - buffer.length,
        status,
        waiting,
      })

    const handle = (frame: SseFrame): boolean => {
      if (frame.event === 'chunk') {
        const { text, nextOffset } = JSON.parse(frame.data) as {
          text: string
          nextOffset: number
        }
        offset = nextOffset
        buffer = (buffer + text).slice(-TERM_TAIL_CHARS)
        emit()
        return true
      }
      if (frame.event === 'meta') {
        const meta = JSON.parse(frame.data) as {
          background: boolean
          waiting?: boolean
        }
        status = meta.background ? 'background' : 'running'
        waiting = meta.waiting ?? false
        emit()
        return true
      }
      const { status: next } = JSON.parse(frame.data) as {
        status: ShellJobStatus
      }
      status = next
      waiting = false
      emit()
      return false
    }

    const run = async () => {
      while (active) {
        controller = new AbortController()
        let response: Response
        try {
          const token = await getConvexToken()
          response = await fetch(streamUrl(sessionId, jobId, offset), {
            headers: {
              Accept: 'text/event-stream',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            credentials: 'include',
            signal: controller.signal,
          })
        } catch {
          if (!active) return
          await sleep(RECONNECT_DELAY_MS)
          continue
        }

        if (response.status === 404) {
          status = 'lost'
          emit()
          return
        }
        if (!response.ok || !response.body) {
          if (!active) return
          await sleep(RECONNECT_DELAY_MS)
          continue
        }

        let receivedAny = false
        try {
          for await (const event of readSse(response.body)) {
            if (!active) return
            receivedAny = true
            if (!handle(event)) return
          }
        } catch {
          receivedAny = false // treat a mid-stream error as a failed attempt
        }
        if (!active) return
        if (!receivedAny) await sleep(RECONNECT_DELAY_MS)
      }
    }

    void run()
    return () => {
      active = false
      controller?.abort()
    }
  }, [sessionId, jobId, enabled])

  return tail
}

function streamUrl(sessionId: string, jobId: string, offset: number): string {
  const query = new URLSearchParams({
    sessionId,
    jobId,
    offset: String(offset),
  })
  return `${convexSiteUrl()}/shell/stream?${query.toString()}`
}
