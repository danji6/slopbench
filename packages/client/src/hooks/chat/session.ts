import type { SessionMode } from '@/lib/chat/modes'
import {
  nextSessionMode,
  resolveSessionMode,
  toggledSessionMode,
} from '@/lib/chat/modes'
import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo } from 'react'
import { useLocation, useSearch } from 'wouter'

type OptimisticSessionPatch = Pick<
  Partial<Doc<'sessions'>>,
  'settings' | 'mode'
> & {
  activeAgentId?: Id<'agents'>
  title?: string
}

function mergePatch<T extends { settings?: Doc<'sessions'>['settings'] }>(
  session: T,
  patch: OptimisticSessionPatch,
): T {
  return {
    ...session,
    ...patch,
    ...(patch.settings
      ? { settings: { ...session.settings, ...patch.settings } }
      : {}),
  }
}

export function useActiveSessionId(): string | null {
  const search = useSearch()
  return new URLSearchParams(search).get('id')
}

export function useActiveSessionQuery() {
  const activeSessionId = useActiveSessionId()
  return useQuery(
    api.sessions.get,
    activeSessionId ? { sessionId: activeSessionId as Id<'sessions'> } : 'skip',
  )
}

export function useActiveSession() {
  return useActiveSessionQuery() ?? null
}

/** The active session's composer mode, with setters cycling/toggling it. */
export function useSessionMode() {
  const session = useActiveSession()
  const sessionId = session?._id
  const mode = resolveSessionMode(session?.mode)

  const mutate = useMutation(api.sessions.setMode).withOptimisticUpdate(
    (store, args) =>
      optimisticallyPatchSession(store, args.sessionId, {
        // The backend stores 'plan' or clears the field back to normal
        mode: args.mode === 'normal' ? undefined : args.mode,
      }),
  )

  const setMode = useCallback(
    async (target: SessionMode) => {
      if (sessionId) await mutate({ sessionId, mode: target })
    },
    [mutate, sessionId],
  )

  const cycleMode = useCallback(
    () => setMode(nextSessionMode(mode)),
    [mode, setMode],
  )

  const toggleMode = useCallback(
    (target: SessionMode) => setMode(toggledSessionMode(mode, target)),
    [mode, setMode],
  )

  return { mode, setMode, cycleMode, toggleMode }
}

/** Session ids that currently have an in-flight stream. */
export function useActiveStreamSessionIds(): Set<string> {
  const ids = useQuery(api.streams.activeSessionIds, {})
  return useMemo(() => new Set(ids ?? []), [ids])
}

export function useValidatedSessionId(): string | null {
  const activeSessionId = useActiveSessionId()
  const [, navigate] = useLocation()

  const session = useQuery(
    api.sessions.get,
    activeSessionId ? { sessionId: activeSessionId as Id<'sessions'> } : 'skip',
  )

  useEffect(() => {
    if (activeSessionId && session === null) {
      navigate('/', { replace: true })
    }
  }, [activeSessionId, session, navigate])

  return activeSessionId && session !== null ? activeSessionId : null
}

export type ActiveSessionStatus = 'loading' | 'loaded' | 'none'

export function useActiveSessionStatus(): ActiveSessionStatus {
  const activeSessionId = useActiveSessionId()
  const session = useQuery(
    api.sessions.get,
    activeSessionId ? { sessionId: activeSessionId as Id<'sessions'> } : 'skip',
  )
  if (!activeSessionId) return 'none'
  return session === undefined ? 'loading' : 'loaded'
}

/** The current user's own membership row for the active session. */
export function useMyMembership() {
  const session = useActiveSession()
  return useQuery(
    api.userSessions.mine,
    session ? { sessionId: session._id } : 'skip',
  )
}

/** Timestamp until the user can send again. */
export function useSendCooldownUntil(): number | null {
  const session = useActiveSession()
  const membership = useMyMembership()
  const slowModeSeconds = session?.settings?.slowModeSeconds ?? 0

  return slowModeSeconds <= 0 || !membership?.lastSendAt
    ? null
    : membership.lastSendAt + slowModeSeconds * 1000
}

export function optimisticallyPatchSession(
  store: OptimisticLocalStore,
  sessionId: Id<'sessions'>,
  patch: OptimisticSessionPatch,
) {
  const session = store.getQuery(api.sessions.get, { sessionId })
  if (session) {
    store.setQuery(api.sessions.get, { sessionId }, mergePatch(session, patch))
  }

  for (const { args, value } of store.getAllQueries(api.sessions.list)) {
    if (!value) continue
    store.setQuery(api.sessions.list, args, {
      ...value,
      page: value.page.map((item) =>
        item._id === sessionId ? mergePatch(item, patch) : item,
      ),
    })
  }
}
