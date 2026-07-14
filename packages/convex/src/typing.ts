import { v } from 'convex/values'

import { internalMutation } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Typing from './model/typing'

export const list = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Typing.list,
})

export const heartbeat = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Typing.heartbeat,
})

export const clear = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Typing.clear,
})

export const prune = internalMutation({
  args: {},
  handler: Typing._prune,
})
