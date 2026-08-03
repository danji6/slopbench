import { v } from 'convex/values'

import { internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Mcp from './model/mcp'
import * as V from './validators/args'

export const list = authQuery({
  args: {},
  handler: Mcp.list,
})

export const get = authQuery({
  args: { serverId: v.id('mcpServers') },
  handler: Mcp.get,
})

export const _getApiKey = internalQuery({
  args: { serverId: v.id('mcpServers') },
  handler: Mcp._getApiKey,
})

export const replaceAll = authMutation({
  args: V.replaceMcpServersArgsValidator.fields,
  handler: Mcp.replaceAll,
})
