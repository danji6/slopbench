'use node'

import { v } from 'convex/values'

import { internalAction } from '../_generated/server'

export const _stream = internalAction({
  args: { streamId: v.id('streams') },
  handler: async (ctx, args) => {
    const { _stream } = await import('./stream/engine')
    return _stream(ctx, args)
  },
})
