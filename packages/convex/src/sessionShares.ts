import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Shares from './model/session/shares'

export const list = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Shares.list,
})

export const createOrRotate = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Shares.createOrRotate,
})

export const revoke = authMutation({
  args: { sessionId: v.id('sessions'), shareId: v.id('sessionShares') },
  handler: Shares.revoke,
})

export const redeem = authMutation({
  args: { token: v.string() },
  handler: Shares.redeem,
})
