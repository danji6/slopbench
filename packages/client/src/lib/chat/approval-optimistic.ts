import { api } from '@sb/convex/_generated/api'
import {
  hasPendingToolApprovals,
  isPendingToolApproval,
} from '@sb/core/utils/tool-parts'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'

import { hydrateLiveSegments } from './live-segments'
import type { ApproveToolArgs } from './types'

type LiveSegments = FunctionReturnType<typeof api.chat.processingMessageSegments> // prettier-ignore

type ApprovalTarget = {
  sessionId: ApproveToolArgs['sessionId']
  messageId?: string
}

export function optimisticallyRespondApproval(
  store: OptimisticLocalStore,
  args: ApproveToolArgs,
) {
  if (args.childSessionId) {
    optimisticallyRespondChildApproval(store, args)
  }

  const sessionId = args.childSessionId ?? args.sessionId
  const stream = store.getQuery(api.chat.getActiveStream, {
    sessionId,
  })
  if (!stream || stream.status !== 'awaiting_approval') return

  const target = { sessionId, messageId: stream.processingMessageId }
  const liveSegments = respondToLiveSegments(store, args, target)
  const { foundMessage, pendingRemains } = respondToMessageWindows(
    store,
    args,
    target,
    liveSegments,
  )
  if (foundMessage && !pendingRemains) {
    store.setQuery(
      api.chat.getActiveStream,
      { sessionId },
      { ...stream, status: 'pending' },
    )
  }
}

/** Updates mutable tool parts, which are queried separately from the window. */
function respondToLiveSegments(
  store: OptimisticLocalStore,
  args: ApproveToolArgs,
  { sessionId, messageId }: ApprovalTarget,
) {
  const rows = store.getQuery(api.chat.processingMessageSegments, { sessionId })
  const next = rows?.map((row) =>
    row.messageId === messageId
      ? {
          ...row,
          segment: {
            ...row.segment,
            parts: respondToPart(row.segment.parts, args),
          },
        }
      : row,
  )
  if (next) {
    store.setQuery(api.chat.processingMessageSegments, { sessionId }, next)
  }
  return next
}

function respondToMessageWindows(
  store: OptimisticLocalStore,
  args: ApproveToolArgs,
  { sessionId, messageId }: ApprovalTarget,
  liveSegments: LiveSegments | undefined,
) {
  const live = liveSegments?.find((row) => row.messageId === messageId)
  let pendingRemains = live ? hasPendingToolApprovals(live.segment.parts) : false // prettier-ignore
  let foundMessage = Boolean(live)

  for (const { args: queryArgs, value } of store.getAllQueries(
    api.chat.messagesWindow,
  )) {
    if (!value || queryArgs.sessionId !== sessionId) continue

    const page = value.page.map((message) => {
      if (message._id !== messageId) return message
      return {
        ...message,
        segments: message.segments.map((segment) => ({
          ...segment,
          parts: respondToPart(segment.parts, args),
        })),
      }
    })
    store.setQuery(api.chat.messagesWindow, queryArgs, { ...value, page })

    const target = page.find((m) => m._id === messageId)
    if (!target) continue

    foundMessage = true
    const [hydrated] = hydrateLiveSegments([target], liveSegments ?? [])
    pendingRemains ||= hydrated.segments.some((segment) => {
      const awaitingLiveParts = segment.live && segment.parts.length === 0
      return awaitingLiveParts || hasPendingToolApprovals(segment.parts)
    })
  }

  return { foundMessage, pendingRemains }
}

function respondToPart(parts: unknown[], args: ApproveToolArgs): unknown[] {
  return parts.map((part) => {
    if (typeof part !== 'object' || part === null) return part
    if (!('toolCallId' in part) || part.toolCallId !== args.toolCallId) {
      return part
    }
    const typed = part as { state?: string; approval?: { id?: string } }
    if (typed.state !== 'approval-requested') return part

    return {
      ...typed,
      state: args.approved ? 'approval-responded' : 'output-denied',
      approval: {
        id: typed.approval?.id,
        approved: args.approved,
        ...(args.reason && { reason: args.reason }),
        ...(args.note?.trim() && { note: args.note.trim() }),
      },
    }
  })
}

/** Removes answered child requests without modifying the main session's stream. */
function optimisticallyRespondChildApproval(
  store: OptimisticLocalStore,
  args: ApproveToolArgs,
) {
  const queryArgs = { sessionId: args.sessionId }
  const requests = store.getQuery(api.subagents.pendingApprovals, queryArgs)
  if (!requests) return

  const next = requests
    .map((request) => {
      if (request.sessionId !== args.childSessionId) return request
      return {
        ...request,
        parts: respondToPart(request.parts, args).filter(isPendingToolApproval),
      }
    })
    .filter((request) => request.parts.length > 0)
  store.setQuery(api.subagents.pendingApprovals, queryArgs, next)
}
