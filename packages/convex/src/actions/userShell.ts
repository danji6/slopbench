'use node'

import { v } from 'convex/values'

import { internalAction } from '../_generated/server'

export const _run = internalAction({
  args: {
    messageId: v.id('messages'),
    invokedBy: v.id('users'),
    silent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { _run } = await import('./tool/userShell')
    return _run(ctx, args)
  },
})
