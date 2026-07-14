'use node'

import { v } from 'convex/values'

import { action } from '../_generated/server'
import * as AgentIO from './io/agent'

export const exportAsImage = action({
  args: { agentId: v.id('agents') },
  handler: AgentIO.exportAsImage,
})

export const importFromImage = action({
  args: { storageId: v.id('_storage') },
  handler: AgentIO.importFromImage,
})
