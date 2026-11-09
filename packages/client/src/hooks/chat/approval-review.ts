import { useFullscreenView } from '@/hooks/fullscreen'
import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'

import { COMPOSER_FULLSCREEN_ID } from './composer-editor'
import { useActiveSession } from './session'
import { usePendingToolApproval } from './tool-approval'

type ApprovalReviewOptions = {
  awaitingApproval: boolean
  awaitingAnswer: boolean
  canApproveTools: boolean
  composerDocked: boolean
  composerIdle: boolean
  reviewBlocked: boolean
}

/** Controls when the first pending request takes over the chat dock. */
export function useApprovalReview({
  awaitingApproval,
  awaitingAnswer,
  canApproveTools,
  composerDocked,
  composerIdle,
  reviewBlocked,
}: ApprovalReviewOptions) {
  const session = useActiveSession()
  const subagent = Boolean(session?.parent)
  const fullscreen = useFullscreenView(COMPOSER_FULLSCREEN_ID)
  const [requestedKey, setRequestedKey] = useState<string>()
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set<string>())

  const stopSubagent = useMutation(api.subagents.stop)

  const childApprovals = useQuery(
    api.subagents.pendingApprovals,
    session && !subagent && canApproveTools
      ? { sessionId: session._id }
      : 'skip',
  )
  const childApproval =
    !awaitingApproval && !awaitingAnswer ? childApprovals?.[0] : undefined
  const request = usePendingToolApproval({
    childApproval,
    awaitingApproval,
    canApproveTools,
  })

  const manualReview = Boolean(request && request.key === requestedKey)
  // A rolled-back decision should go through the idle check again.
  if (requestedKey && !manualReview) setRequestedKey(undefined)

  const autoReview =
    request && composerDocked && composerIdle && !hiddenKeys.has(request.key)
  const canOpenReview = !reviewBlocked && !awaitingAnswer && !fullscreen.active
  const showApproval = Boolean(
    request && (subagent || (canOpenReview && (manualReview || autoReview))),
  )

  function review() {
    if (!request) return
    if (hiddenKeys.has(request.key)) {
      const next = new Set(hiddenKeys)
      next.delete(request.key)
      setHiddenKeys(next)
    }
    setRequestedKey(request.key)
    if (fullscreen.active) fullscreen.exit()
  }

  function hide() {
    if (!request) return
    setHiddenKeys((keys) => new Set(keys).add(request.key))
    setRequestedKey(undefined)
  }

  function abortChild() {
    if (!session || !childApproval) return
    void stopSubagent({
      sessionId: session._id,
      childSessionId: childApproval.sessionId,
    }).catch(toastError)
  }

  return {
    request,
    childApproval,
    showApproval,
    showReviewButton: Boolean(request && !showApproval && !subagent),
    fullscreen: fullscreen.active,
    focusOnOpen: subagent || manualReview,
    review,
    hide,
    abortChild,
  }
}
