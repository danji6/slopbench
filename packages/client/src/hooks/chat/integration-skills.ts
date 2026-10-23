import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { useState } from 'react'

type SkillPreview = FunctionReturnType<typeof api.actions.integrations.skills>

/** Loads explicitly requested skill metadata and preserves its pagination fingerprint. */
export function useIntegrationSkills(integrationId: Id<'integrations'>) {
  const preview = useAction(api.actions.integrations.skills)
  const [page, setPage] = useState<SkillPreview>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load(offset = 0) {
    setLoading(true)
    setError('')
    try {
      setPage(
        await preview({
          integrationId,
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
