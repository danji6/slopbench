import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as UserSessions from './model/userSessions'

export const list = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: UserSessions.list,
})

export const mine = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: UserSessions.mine,
})

export const remove = authMutation({
  args: { sessionId: v.id('sessions'), userId: v.id('users') },
  handler: UserSessions.remove,
})
