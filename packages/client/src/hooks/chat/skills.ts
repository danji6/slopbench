import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { FileOperationArgs } from '@sb/convex/model/skills/operations'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { useIsAdmin } from './tools'

/** Starts a scheduled mutation operation and observes its durable progress reactively. */
export function useAgentFileOperation(
  key: string,
  activeId?: Id<'agentFileOperations'>,
) {
  const admin = useIsAdmin()
  const storageKey = `agent-files:${key}`

  // prettier-ignore
  const [operationId, setOperationId] = useState<Id<'agentFileOperations'> | undefined>(
    () => (localStorage.getItem(storageKey) as Id<'agentFileOperations'> | undefined) || undefined
  )

  useEffect(() => {
    if (activeId) {
      localStorage.setItem(storageKey, activeId)
    }
  }, [activeId, storageKey])

  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const start = useMutation(api.skills.start)
  const retry = useMutation(api.skills.retry)
  const id = activeId ?? operationId
  const status = useQuery(
    api.skills.operation,
    admin && id ? { operationId: id } : 'skip',
  )

  if (activeId && activeId !== operationId) {
    setOperationId(activeId)
  }

  const busy =
    starting || status?.status === 'queued' || status?.status === 'running'

  async function run(args: FileOperationArgs) {
    setStarting(true)
    setError(undefined)
    try {
      const next = await start(args)
      localStorage.setItem(storageKey, next)
      setOperationId(next)
    } catch (error) {
      setError(extractErrorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  async function retryOperation() {
    if (!id) {
      return
    }
    try {
      await retry({ operationId: id })
      setError(undefined)
    } catch (error) {
      setError(extractErrorMessage(error))
    }
  }

  return {
    run,
    busy,
    error:
      error ?? (status?.error ? extractErrorMessage(status.error) : undefined),
    summary: status?.summary,
    retry: status?.status === 'failed' ? retryOperation : undefined,
  }
}

/** Keeps the visible result set bounded without restricting the library size. */
export function useSkillPagination() {
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  return {
    cursor: cursors.at(-1) ?? null,
    canBack: cursors.length > 1,
    back: () => setCursors((value) => value.slice(0, -1)),
    next: (cursor: string) => setCursors((value) => [...value, cursor]),
    reset: () => setCursors([null]),
  }
}
