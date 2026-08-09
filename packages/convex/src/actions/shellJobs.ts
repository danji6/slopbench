'use node'

import { v } from 'convex/values'

import { internalAction } from '../_generated/server'

export const _watch = internalAction({
  args: { shellJobId: v.id('shellJobs') },
  handler: async (ctx, args) => {
    const { _watch } = await import('./tool/shellJobs')
    return _watch(ctx, args)
  },
})
