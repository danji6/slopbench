import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Agents from './model/session/agents'

export const list = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Agents.list,
})

export const link = authMutation({
  args: { sessionId: v.id('sessions'), agentId: v.id('agents') },
  handler: Agents.link,
})

export const unlink = authMutation({
  args: { sessionId: v.id('sessions'), agentId: v.id('agents') },
  handler: Agents.unlink,
})

export const activate = authMutation({
  args: { sessionId: v.id('sessions'), agentId: v.id('agents') },
  handler: Agents.activate,
})
