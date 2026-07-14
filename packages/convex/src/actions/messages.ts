'use node'

import { v } from 'convex/values'

import { internalAction } from '../_generated/server'

export const _evalMessage = internalAction({
  args: {
    messageId: v.id('messages'),
    invokerId: v.id('users'),
    version: v.number(),
    segmentIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { _evalMessage } = await import('./stream/evalMessage')
    return _evalMessage(ctx, args)
  },
})
