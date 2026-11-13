import { extractErrorMessage } from '@/lib/errors'
import { api } from '@cv/convex/_generated/api'
import type { Id } from '@cv/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useState } from 'react'

type SkillPreview = FunctionReturnType<typeof api.actions.toolkits.skills>

/** Loads explicitly requested skill metadata and preserves its pagination fingerprint. */
export function useToolkitSkills(toolkitId: Id<'toolkits'>) {
  const preview = useAction(api.actions.toolkits.skills)
  const [page, setPage] = useState<SkillPreview>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load(offset = 0) {
    setLoading(true)
    setError('')
    try {
      setPage(
        await preview({
          toolkitId,
          offset,
          ...(offset ? { fingerprint: page?.fingerprint } : {}),
        }),
      )
    } catch (cause) {
      setError(extractErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  return { page, loading, error, load }
}
