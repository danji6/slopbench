import { convexSiteUrl, getConvexToken } from '@/hooks/http'
import type { ShellJobStatus, ShellJobSummary } from '@/lib/chat'
import { type SseFrame, readSse } from '@/lib/sse'
import { sleep } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { useCallback, useEffect, useRef, useState } from 'react'

const LIST_INTERVAL_MS = 2500
const RECONNECT_DELAY_MS = 500
// Matches the sidecar's terminal-tail cap (see model/tool/shell.ts)
const TERM_TAIL_CHARS = 48_000

export type SessionJobs = {
  jobs: ShellJobSummary[]
  /** Optimistically remove a job. */
  dropJob: (jobId: string) => void
}

/** Polls the sidecar for the session's jobs while `enabled`. */
export function useSessionJobs(
  sessionId: Id<'sessions'> | null,
  enabled = true,
): SessionJobs {
  const list = useAction(api.actions.terminals.list)
  const [jobs, setJobs] = useState<ShellJobSummary[]>([])
  const dropped = useRef<Set<string>>(new Set())

  const dropJob = useCallback((jobId: string) => {
    dropped.current.add(jobId)
    setJobs((prev) => prev.filter((job) => job.jobId !== jobId))
  }, [])

  useEffect(() => {
    if (!sessionId || !enabled) return

    let active = true
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const { jobs } = await list({ sessionId })
        if (active) {
          // Keep dropped ids hidden until the sidecar stops reporting them
          const present = new Set(jobs.map((job) => job.jobId))
          for (const id of dropped.current) {
            if (!present.has(id)) dropped.current.delete(id)
          }
          setJobs(jobs.filter((job) => !dropped.current.has(job.jobId)))
        }
      } catch {
        // Keep the last known list
      }
      if (active) timer = setTimeout(tick, LIST_INTERVAL_MS)
    }

    void tick()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [sessionId, enabled, list])

  return { jobs: sessionId && enabled ? jobs : [], dropJob }
}

export type JobTail = {
  term: string
  termOffset: number
  status: ShellJobStatus | undefined
}

const EMPTY_TAIL: JobTail = { term: '', termOffset: 0, status: undefined }

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

    const update = (next: JobTail) => {
      const prev = tailCache.get(key)
      tailCache.set(key, next)

      // Skip re-renders when nothing changed
      if (
        prev &&
        prev.term === next.term &&
        prev.termOffset === next.termOffset &&
        prev.status === next.status
      ) {
        return
      }
      setTail(next)
    }

    const emit = () =>
      update({ term: buffer, termOffset: offset - buffer.length, status })

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
        const { background } = JSON.parse(frame.data) as { background: boolean }
        status = background ? 'background' : 'running'
        emit()
        return true
      }
      const { status: next } = JSON.parse(frame.data) as {
        status: ShellJobStatus
      }
      status = next
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
