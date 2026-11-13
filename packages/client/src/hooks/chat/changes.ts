import { normalizeBrowserUrl } from '@/lib/auth/site-url'
import { readTextPreview } from '@/lib/text-file-preview'
import { api } from '@cv/convex/_generated/api'
import type { Id } from '@cv/convex/_generated/dataModel'
import {
  useQuery as useCachedQuery,
  usePaginatedQuery,
} from 'convex-helpers/react/cache/hooks'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

const diffCache = new Map<string, string>()
type DiffResult = { key: string; text?: string; error?: string }

/** Retains reactive summaries and file pages through virtualized row remounts. */
export function useTurnChanges(messageId: string, version: number) {
  const summary = useCachedQuery(api.chat.changeSummary, {
    messageId: messageId as Id<'messages'>,
    version,
  })

  const filePage = usePaginatedQuery(
    api.chat.changeFiles,
    summary?.phase === 'ready' || summary?.phase === 'restoring'
      ? { changeSetId: summary._id }
      : 'skip',
    { initialNumItems: 5 },
  )

  const restore = useMutation(api.chat.restoreChanges)
  const [error, setError] = useState<string>()

  const act = async () => {
    if (!summary) return
    setError(undefined)
    try {
      await restore({
        changeSetId: summary._id,
        revision: summary.revision,
        direction: summary.state === 'applied' ? 'revert' : 'reapply',
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    summary,
    files: filePage.results,
    loadMore: filePage.loadMore,
    fileStatus: filePage.status,
    act,
    error,
  }
}

/** Loads immutable previews on demand, cancelling stale requests on row changes. */
export function useChangeDiff(
  changeSetId: Id<'changeSets'>,
  fileKey: string,
  active: boolean,
) {
  const key = `${changeSetId}:${fileKey}`
  const [result, setResult] = useState<DiffResult>()
  const cached = diffCache.get(key)
  const storageUrl = useQuery(
    api.chat.changeDiff,
    active && cached === undefined ? { changeSetId, fileKey } : 'skip',
  )
  const url = storageUrl ? normalizeBrowserUrl(storageUrl) : storageUrl
  useEffect(() => {
    if (!active || cached !== undefined || !url) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ])
    void readTextPreview(url, signal, 512 * 1024).then(
      ({ text }) => {
        if (signal.aborted) return
        if (diffCache.size >= 40)
          diffCache.delete(diffCache.keys().next().value!)
        diffCache.set(key, text)
        setResult({ key, text })
      },
      () => {
        if (!controller.signal.aborted)
          setResult({ key, error: 'Could not load this diff.' })
      },
    )
    return () => controller.abort()
  }, [active, cached, key, url])
  return {
    text: cached ?? (result?.key === key ? result.text : undefined),
    error:
      result?.key === key
        ? result.error
        : active && url === null
          ? 'Diff is unavailable.'
          : undefined,
  }
}
