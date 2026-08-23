import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Plans from './model/plans'

export const get = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Plans.get,
})

export const update = authMutation({
  args: { sessionId: v.id('sessions'), content: v.string() },
  handler: Plans.update,
})

export const remove = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Plans.removePlan,
})

export const _get = internalQuery({
  args: { sessionId: v.id('sessions') },
  handler: (ctx, { sessionId }) => Plans.getBySession(ctx, sessionId),
})

export const _write = internalMutation({
  args: { sessionId: v.id('sessions'), content: v.string() },
  handler: Plans._write,
})

export const _edit = internalMutation({
  args: {
    sessionId: v.id('sessions'),
    edits: v.array(v.object({ oldText: v.string(), newText: v.string() })),
  },
  handler: Plans._edit,
})

export const _applyModeTransition = internalMutation({
  args: {
    sessionId: v.id('sessions'),
    toolName: v.union(
      v.literal('enter_plan_mode'),
      v.literal('exit_plan_mode'),
    ),
  },
  handler: (ctx, { sessionId, toolName }) =>
    Plans.applyModeTransition(ctx, sessionId, toolName),
})
