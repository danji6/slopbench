import { api } from '@sb/convex/_generated/api'
import {
  hasPendingToolApprovals,
  isPendingToolApproval,
} from '@sb/core/utils/tool-parts'
import type { OptimisticLocalStore } from 'convex/browser'

import type { ApproveToolArgs } from './types'

export function optimisticallyRespondApproval(
  store: OptimisticLocalStore,
  args: ApproveToolArgs,
) {
  if (args.childSessionId) {
    optimisticallyRespondChildApproval(store, args)
    return
  }

  const stream = store.getQuery(api.chat.getActiveStream, {
    sessionId: args.sessionId,
  })
  if (!stream || stream.status !== 'awaiting_approval') return

  let pendingRemains = false
  for (const { args: queryArgs, value } of store.getAllQueries(
    api.chat.messagesWindow,
  )) {
    if (!value || queryArgs.sessionId !== args.sessionId) continue

    const page = value.page.map((message) => {
      if (message._id !== stream.processingMessageId) return message
      return {
        ...message,
        segments: message.segments.map((segment) => ({
          ...segment,
          parts: respondToPart(segment.parts, args),
        })),
      }
    })
    store.setQuery(api.chat.messagesWindow, queryArgs, { ...value, page })

    const target = page.find((m) => m._id === stream.processingMessageId)
    pendingRemains ||=
      target?.segments.some((segment) =>
        hasPendingToolApprovals(segment.parts),
      ) ?? false
  }

  if (!pendingRemains) {
    store.setQuery(
      api.chat.getActiveStream,
      { sessionId: args.sessionId },
      { ...stream, status: 'pending' },
    )
  }
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
