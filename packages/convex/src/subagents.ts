import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as SubagentManage from './model/subagent/manage'
import * as SubagentWatch from './model/subagent/watch'

export const watch = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: SubagentWatch.watch,
})

export const list = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: SubagentManage.list,
})

export const stop = authMutation({
  args: {
    sessionId: v.id('sessions'),
    childSessionId: v.id('sessions'),
  },
  handler: SubagentManage.stop,
})

export const stopAll = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: SubagentManage.stopAll,
})
