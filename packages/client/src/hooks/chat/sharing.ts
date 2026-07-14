import { api } from '@sb/convex/_generated/api'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation, useQuery } from 'convex/react'
import { useCallback } from 'react'

import { useIsSessionOwner } from './participants'
import { optimisticallyPatchSession, useActiveSession } from './session'

export function useSessionShares(): Doc<'sessionShares'>[] | undefined {
  const session = useActiveSession()
  const isOwner = useIsSessionOwner()
  return useQuery(
    api.sessionShares.list,
    session && isOwner ? { sessionId: session._id } : 'skip',
  )
}

export function useCreateOrRotateToken() {
  const session = useActiveSession()
  const createOrRotate = useMutation(
    api.sessionShares.createOrRotate,
  ).withOptimisticUpdate((store, { sessionId }) => {
    optimisticallyRevokeShares(store, sessionId, (share) => !share.revokedAt)
  })
  return useCallback(
    () => (session ? createOrRotate({ sessionId: session._id }) : undefined),
    [session, createOrRotate],
  )
}

export function useRevokeToken() {
  const session = useActiveSession()
  const revoke = useMutation(api.sessionShares.revoke).withOptimisticUpdate(
    (store, { sessionId, shareId }) => {
      optimisticallyRevokeShares(
        store,
        sessionId,
        (share) => share._id === shareId,
      )
    },
  )
  return useCallback(
    (shareId: Id<'sessionShares'>) =>
      session ? revoke({ sessionId: session._id, shareId }) : undefined,
    [session, revoke],
  )
}

export function useRedeemToken() {
  const redeem = useMutation(api.sessionShares.redeem)
  return useCallback(
    (token: string) => redeem({ token: token.trim() }),
    [redeem],
  )
}

type SessionSettings = NonNullable<Doc<'sessions'>['settings']>

export function useUpdateSessionSettings() {
  const session = useActiveSession()
  const update = useMutation(api.sessions.update).withOptimisticUpdate(
    (store, { sessionId, settings }) => {
      if (settings) optimisticallyPatchSession(store, sessionId, { settings })
    },
  )
  return useCallback(
    (settings: Partial<SessionSettings>) =>
      session ? update({ sessionId: session._id, settings }) : undefined,
    [session, update],
  )
}

export function useSetDisabled() {
  const session = useActiveSession()
  const setDisabled = useMutation(
    api.sessions.setDisabled,
  ).withOptimisticUpdate((store, { sessionId, disabled }) => {
    optimisticallyPatchSession(store, sessionId, { settings: { disabled } })
  })
  return useCallback(
    (disabled: boolean) =>
      session ? setDisabled({ sessionId: session._id, disabled }) : undefined,
    [session, setDisabled],
  )
}

function optimisticallyRevokeShares(
  store: OptimisticLocalStore,
  sessionId: Id<'sessions'>,
  shouldRevoke: (share: Doc<'sessionShares'>) => boolean,
) {
  const shares = store.getQuery(api.sessionShares.list, { sessionId })
  if (shares === undefined) return

  const revokedAt = 1
  store.setQuery(
    api.sessionShares.list,
    { sessionId },
    shares.map((share) =>
      shouldRevoke(share) ? { ...share, revokedAt } : share,
    ),
  )
}
