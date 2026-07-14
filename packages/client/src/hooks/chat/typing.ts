import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Minimum gap between typing heartbeats. Must stay below the server TTL. */
const HEARTBEAT_INTERVAL_MS = 3000
/** Idle time after the last keystroke before we clear our own typing row. */
const IDLE_CLEAR_MS = 3500
/** Grace period before clearing the typing signal. */
const GRACE_MS = 500

type Timeout = ReturnType<typeof setTimeout>
type TypingUser = { userId: Id<'users'>; name: string; expiresAt: number }
const EMPTY: TypingUser[] = []

export function useTypingIndicator(sessionId?: Id<'sessions'>) {
  const data = useQuery(api.typing.list, sessionId ? { sessionId } : 'skip')
  const rows = useMemo(() => data ?? EMPTY, [data])
  const heartbeat = useMutation(api.typing.heartbeat)
  const clear = useMutation(api.typing.clear)
  const lastSent = useRef(0)
  const idleTimer = useRef<Timeout>(undefined)
  const graceTimer = useRef<Timeout>(undefined)
  const clearTimer = useRef<Timeout>(undefined)

  const [now, setNow] = useState(() => Date.now())
  const typingUsers = useMemo(
    () => rows.filter((row) => row.expiresAt > now),
    [rows, now],
  )

  useEffect(() => {
    const next = rows
      .map((row) => row.expiresAt)
      .filter((expiresAt) => expiresAt > Date.now())
    if (next.length === 0) return
    const delay = Math.max(Math.min(...next) - Date.now(), 0)
    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [rows, now])

  const clearTyping = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (graceTimer.current) clearTimeout(graceTimer.current)
    if (clearTimer.current) clearTimeout(clearTimer.current)

    graceTimer.current = undefined
    clearTimer.current = undefined

    if (!sessionId) return

    const announced = lastSent.current !== 0
    lastSent.current = 0
    if (announced) void clear({ sessionId })
  }, [sessionId, clear])

  const stopTyping = useCallback(() => {
    if (!sessionId) return
    if (graceTimer.current) {
      clearTimeout(graceTimer.current)
      graceTimer.current = undefined
      return
    }
    if (lastSent.current === 0 || clearTimer.current) return

    clearTimer.current = setTimeout(() => {
      clearTimer.current = undefined
      lastSent.current = 0
      void clear({ sessionId })
    }, GRACE_MS)
  }, [sessionId, clear])

  const notify = useCallback(() => {
    if (!sessionId) return
    if (clearTimer.current) {
      clearTimeout(clearTimer.current)
      clearTimer.current = undefined
    }

    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(clearTyping, IDLE_CLEAR_MS)

    const nowMs = Date.now()
    // Already announced: throttle between heartbeats
    if (lastSent.current !== 0) {
      if (nowMs - lastSent.current < HEARTBEAT_INTERVAL_MS) return
      lastSent.current = nowMs
      void heartbeat({ sessionId })
      return
    }

    // Not yet announced: wait out the grace period first
    if (graceTimer.current) return
    graceTimer.current = setTimeout(() => {
      graceTimer.current = undefined
      lastSent.current = Date.now()
      void heartbeat({ sessionId })
    }, GRACE_MS)
  }, [sessionId, heartbeat, clearTyping])

  useEffect(() => () => clearTyping(), [clearTyping])

  return { typingUsers, notify, clearTyping, stopTyping }
}
