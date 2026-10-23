import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { useState } from 'react'

import { useIsAdmin } from './tools'

export type IntegrationSelectionContext = { agentId?: Id<'agents'> }

/** Saves the agent's integration selection independently of individual tool selections. */
export function useIntegrationSelection({
  agentId,
}: IntegrationSelectionContext) {
  const admin = useIsAdmin()
  const rows = useQuery(
    api.integrations.list,
    admin && agentId ? { agentId } : 'skip',
  )
  const select = useMutation(api.integrations.select)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function change(integrationId: Id<'integrations'>, enabled: boolean) {
    if (!agentId) return
    setSaving(true)
    setError('')
    try {
      await select({ integrationId, agentId, enabled })
    } catch (cause) {
      setError(extractErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return { admin, rows, error, saving, change }
}
