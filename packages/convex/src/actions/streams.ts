'use node'

import { internalAction } from '../_generated/server'
import { streamExecutionArgsValidator } from '../validators/streams'

export const _stream = internalAction({
  args: streamExecutionArgsValidator.fields,
  handler: async (ctx, args) => {
    const { _stream } = await import('./stream/engine')
    return _stream(ctx, args)
  },
})
