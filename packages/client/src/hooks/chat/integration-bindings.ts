import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { IntegrationComponentArgs } from '@sb/convex/types'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { useState } from 'react'

type Feedback = {
  serverId: string
  message: string
  error?: boolean
}

export function useIntegrationBindings(integrationId: Id<'integrations'>) {
  const servers = useQuery(api.integrations.bindings, { integrationId })
  const configure = useMutation(api.integrations.component)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()

  async function save(args: IntegrationComponentArgs) {
    setBusy(true)
    setFeedback(undefined)
    try {
      await configure(args)
      setFeedback({
        serverId: args.serverId,
        message:
          'Server settings saved. Existing connections were replaced if credentials changed.',
      })
      return true
    } catch (cause) {
      setFeedback({
        serverId: args.serverId,
        message: extractErrorMessage(cause),
        error: true,
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  return { servers, busy, feedback, save }
}
