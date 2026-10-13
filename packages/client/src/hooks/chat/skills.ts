import { fileOperationStore } from '@/lib/chat/file-operation-store'
import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { FileOperationArgs } from '@sb/convex/model/skills/operations'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { useIsAdmin } from './tools'

export function useHomeOperation(agentId?: Id<'agents'>) {
  const admin = useIsAdmin()

  const home = useQuery(
    api.skills.getHome,
    admin && agentId ? { agentId } : 'skip',
  )

  const [identity, setIdentity] = useState({
    agentId,
    key: home?.homeId ?? agentId ?? 'library',
  })

  const key =
    identity.agentId === agentId
      ? (home?.homeId ?? identity.key)
      : (home?.homeId ?? agentId ?? 'library')

  if (identity.agentId !== agentId || identity.key !== key)
    setIdentity({ agentId, key })

  const operation = useAgentFileOperation(key, home?.operationId)

  return { home, operation }
}

/** Holds busy through the mutation/query handoff and shares it across mounted controls. */
export function useAgentFileOperation(
  key: string,
  activeId?: Id<'agentFileOperations'>,
) {
  const admin = useIsAdmin()
  const store = useMemo(() => fileOperationStore(key), [key])
  const state = useSyncExternalStore(store.subscribe, store.read)
  const start = useMutation(api.skills.start)
  const retry = useMutation(api.skills.retry)
  const id = activeId ?? state.id
  const status = useQuery(api.skills.operation, admin && id ? { operationId: id } : 'skip') // prettier-ignore
  const running = status?.status === 'queued' || status?.status === 'running'
  const busy = state.pending || running || !!(activeId && !status)

  useEffect(() => {
    if (activeId && state.id !== activeId) {
      store.update({ id: activeId, pending: true, dismissed: false })
      return
    }

    const changed =
      id &&
      status !== undefined &&
      !running &&
      state.pending &&
      !state.submitting &&
      (state.ignoreVersion === undefined ||
        !status ||
        status.updatedAt !== state.ignoreVersion)

    if (changed) {
      store.update({
        pending: false,
        dismissed: state.restoring,
        restoring: false,
      })
    }
  }, [
    activeId,
    id,
    running,
    state.id,
    state.pending,
    state.restoring,
    state.submitting,
    state.ignoreVersion,
    status,
    store,
  ])

  async function run(args: FileOperationArgs) {
    if (busy) return
    store.update({
      pending: true,
      submitting: true,
      id: undefined,
      error: undefined,
      dismissed: true,
    })
    try {
      const next = await start(args)
      store.update({ id: next, submitting: false, dismissed: false })
    } catch (error) {
      store.update({
        pending: false,
        submitting: false,
        error: extractErrorMessage(error),
        dismissed: false,
      })
    }
  }

  async function retryOperation() {
    if (!id || busy) return
    store.update({
      pending: true,
      submitting: true,
      ignoreVersion: status?.updatedAt,
      error: undefined,
      dismissed: true,
    })
    try {
      await retry({ operationId: id })
      store.update({ submitting: false, dismissed: false })
    } catch (error) {
      store.update({
        pending: false,
        submitting: false,
        error: extractErrorMessage(error),
        dismissed: false,
      })
    }
  }

  return {
    run,
    busy,
    error:
      state.dismissed || busy
        ? undefined
        : (state.error ??
          (status?.error ? extractErrorMessage(status.error) : undefined)),
    summary: state.dismissed || busy ? undefined : status?.summary,
    retry:
      !state.dismissed && status?.status === 'failed'
        ? retryOperation
        : undefined,
    dismiss: () => store.update({ dismissed: true, error: undefined }),
  }
}
