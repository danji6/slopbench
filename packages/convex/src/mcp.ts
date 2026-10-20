import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Mcp from './model/mcp'
import * as Cleanup from './model/mcpCleanup'
import * as Runtime from './model/mcpRuntime'
import * as V from './validators/mcp'

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

export const _getExecution = internalMutation({
  args: V.mcpExecutionArgsValidator.fields,
  handler: Mcp._getExecution,
})

export const replaceAll = authMutation({
  args: V.replaceMcpServersArgsValidator.fields,
  handler: Mcp.replaceAll,
})

export const runtimes = authQuery({
  args: V.mcpRuntimeListArgsValidator.fields,
  handler: Runtime.list,
})

export const runtime = authQuery({
  args: V.mcpRuntimeArgsValidator.fields,
  handler: Runtime.owned,
})

export const controlRuntime = authMutation({
  args: V.mcpRuntimeControlArgsValidator.fields,
  handler: Runtime.control,
})

export const _connected = internalMutation({
  args: V.mcpRuntimeConnectedArgsValidator.fields,
  handler: Runtime.connected,
})

export const _inspectRuntime = internalQuery({
  args: V.mcpRuntimeInspectArgsValidator.fields,
  handler: (ctx, { scope }) => Runtime.inspect(ctx, scope),
})

export const _updateRuntimeStatus = internalMutation({
  args: V.mcpRuntimeStatusArgsValidator.fields,
  handler: Runtime.updateStatus,
})

export const _cleanup = internalQuery({
  args: V.mcpCleanupArgsValidator.fields,
  handler: Cleanup.get,
})

export const _cleanupDone = internalMutation({
  args: V.mcpCleanupArgsValidator.fields,
  handler: Cleanup.done,
})

export const _pendingCleanups = internalQuery({
  args: {},
  handler: Cleanup.pending,
})

export const _getSecretEnv = internalQuery({
  args: { serverId: v.id('mcpServers') },
  handler: Mcp._getSecretEnv,
})

export const _runtimePage = internalQuery({
  args: V.mcpRuntimePageArgsValidator.fields,
  handler: Runtime.page,
})

export const _retireRuntime = internalMutation({
  args: V.mcpRuntimeRetireArgsValidator.fields,
  handler: Runtime.retireCurrent,
})
