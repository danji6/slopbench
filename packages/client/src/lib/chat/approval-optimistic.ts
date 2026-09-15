import { api } from '@sb/convex/_generated/api'
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
    if (
      target &&
      target.segments.some((segment) => hasApprovalRequested(segment.parts))
    ) {
      pendingRemains = true
    }
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
    if (
      typeof part !== 'object' ||
      part === null ||
      !('toolCallId' in part) ||
      part.toolCallId !== args.toolCallId
    ) {
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

function hasApprovalRequested(parts: unknown[]): boolean {
  return parts.some(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof part.type === 'string' &&
      part.type.startsWith('tool-') &&
      'state' in part &&
      part.state === 'approval-requested',
  )
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
        parts: respondToPart(request.parts, args).filter((part) =>
          hasApprovalRequested([part]),
        ),
      }
    })
    .filter((request) => request.parts.length > 0)
  store.setQuery(api.subagents.pendingApprovals, queryArgs, next)
}
