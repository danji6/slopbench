import { useMutation } from 'convex/react'
import { useCallback } from 'react'
import { api } from '@sb/convex/_generated/api'

import { useActiveSession } from './session'

export function useCompact() {
  const session = useActiveSession()
  const compactMutation = useMutation(api.chat.compact)

  return useCallback(async (extraInstructions = '') => {
    if (!session) return
    await compactMutation({ sessionId: session._id, extraInstructions })
  }, [session, compactMutation])
}
