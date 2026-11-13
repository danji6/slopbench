import { extractErrorMessage } from '@/lib/errors'
import { api } from '@cv/convex/_generated/api'
import type { Id } from '@cv/convex/_generated/dataModel'
import type { ToolkitComponentArgs } from '@cv/convex/types'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { useState } from 'react'

type Feedback = {
  serverId: string
  message: string
  error?: boolean
}

export function useToolkitBindings(toolkitId: Id<'toolkits'>) {
  const servers = useQuery(api.toolkits.bindings, { toolkitId })
  const configure = useMutation(api.toolkits.component)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()

  async function save(args: ToolkitComponentArgs) {
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
