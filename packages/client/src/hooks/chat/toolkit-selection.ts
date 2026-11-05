import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { useState } from 'react'

import { useIsAdmin } from './tools'

export type ToolkitSelectionContext = { agentId?: Id<'agents'> }

/** Saves the agent's toolkit selection independently of individual tool selections. */
export function useToolkitSelection({ agentId }: ToolkitSelectionContext) {
  const admin = useIsAdmin()
  const rows = useQuery(
    api.toolkits.list,
    admin && agentId ? { agentId } : 'skip',
  )
  const select = useMutation(api.toolkits.select)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function change(toolkitId: Id<'toolkits'>, enabled: boolean) {
    if (!agentId) return
    setSaving(true)
    setError('')
    try {
      await select({ toolkitId, agentId, enabled })
    } catch (cause) {
      setError(extractErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return { admin, rows, error, saving, change }
}
