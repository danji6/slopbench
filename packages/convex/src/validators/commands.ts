import { v } from 'convex/values'

/** Slash commands that wait for an idle session before they execute. */
export const deferredCommandNameValidator = v.union(
  v.literal('compact'),
  v.literal('eval'),
  v.literal('impersonate'),
  v.literal('resume'),
)

/** Slash commands represented by hidden command chips. */
export const commandNameValidator = v.union(
  deferredCommandNameValidator,
  v.literal('timeout'),
  v.literal('autoCompact'),
)

/** One command awaiting an idle session, optionally with an announcing chip. */
export const queuedCommandValidator = v.object({
  name: deferredCommandNameValidator,
  argument: v.optional(v.string()),
  invokedBy: v.id('users'),
  requestId: v.optional(v.string()),
  messageId: v.optional(v.id('messages')),
})

/** How far a queued command got, rendered by its chip. */
export const commandStatusValidator = v.union(
  v.literal('queued'),
  v.literal('ran'),
  v.literal('failed'),
  v.literal('cancelled'),
)

export const commandExtraValidator = v.object({
  name: commandNameValidator,
  argument: v.optional(v.string()),
  status: commandStatusValidator,
  error: v.optional(v.string()),
  reason: v.optional(v.string()),
})
