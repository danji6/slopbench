'use node'

import { action } from '../_generated/server'
import { protocolRequestValidator } from '../validators/mcpProtocol'

export const check = action({
  args: protocolRequestValidator.fields,
  handler: async (ctx, args) => {
    const { checkProtocol } = await import('../model/mcpProtocolActions')
    return checkProtocol(ctx, args)
  },
})
