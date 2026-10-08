import { v } from 'convex/values'

import { authQuery } from './functions'
import * as Appearances from './model/appearances'

export const get = authQuery({
  args: { agentId: v.id('agents'), sessionId: v.optional(v.id('sessions')) },
  handler: Appearances.get,
})
