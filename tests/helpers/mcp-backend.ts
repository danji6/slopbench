import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { _getExecution, replaceAll } from '@sb/convex/model/mcp'
import * as BrokerAccess from '@sb/convex/model/mcpBrokerAccess'
import * as CatalogAccess from '@sb/convex/model/mcpCatalogAccess'
import * as Catalogs from '@sb/convex/model/mcpCatalogs'
import * as Cleanup from '@sb/convex/model/mcpCleanup'
import * as Operations from '@sb/convex/model/mcpOperations'
import { connected, updateStatus } from '@sb/convex/model/mcpRuntime'
import { getApprovals } from '@sb/convex/model/session/state'
import { _heartbeat, _patchMessage } from '@sb/convex/model/stream/lifecycle'
import { _trackOffloadedOutput } from '@sb/convex/model/stream/lifecycleCleanup'
import { trackStreamOutputArgsValidator } from '@sb/convex/validators/streams'
import { mcpConnectionSchema } from '@sb/core/types'
import { validate } from 'convex-helpers/validators'
import { getFunctionName } from 'convex/server'

import { operationFixture } from './mcp-operations'
import { skillsDatabase } from './skills-db'

export async function mcpBackendFixture(fixture?: URL) {
  const sidecar = await operationFixture(fixture)
  await sidecar.registry.disconnect(sidecar.scope)
  const database = skillsDatabase()
  const { ctx, db } = database
  const originalInsert = db.insert
  db.insert = (table, fields) =>
    originalInsert(table, { _creationTime: Date.now(), ...fields })
  const blobs = new Map<string, Blob>()
  let nextBlob = 0
  Object.assign(ctx, {
    storage: {
      store: async (blob: Blob) => {
        const id = `blob-${nextBlob++}`
        blobs.set(id, blob)
        return id
      },
      get: async (id: string) => blobs.get(id) ?? null,
      delete: async (id: string) => {
        blobs.delete(id)
      },
    },
  })
  await db.insert('users', { _id: 'owner', role: 'admin' })
  const agentId = (await db.insert('agents', {
    ownerId: 'owner',
    name: 'Agent',
    tools: ['local_work'],
  })) as Id<'agents'>
  const sessionId = (await db.insert('sessions', {
    ownerId: 'owner',
  })) as Id<'sessions'>
  await db.insert('userSessions', { sessionId, userId: 'owner', role: 'owner' })
  const messageId = (await db.insert('messages', {
    sessionId,
    selectedVersion: 1,
    versionCount: 1,
    role: 'assistant',
    status: 'processing',
  })) as Id<'messages'>
  const contentId = (await db.insert('messageContents', {
    messageId,
    sessionId,
    version: 1,
    segmentIndex: 0,
    parts: [],
  })) as Id<'messageContents'>
  const streamId = (await db.insert('streams', {
    sessionId,
    agentId,
    invokedBy: 'owner',
    generation: 1,
    attempt: 0,
    command: { kind: 'invoke' },
    state: {
      phase: 'streaming',
      processingMessageId: messageId,
      processingContentId: contentId,
    },
    leaseExpiresAt: Date.now() + 300_000,
  })) as Id<'streams'>
  await replaceAll(ctx, {
    servers: [
      {
        key: 'local',
        label: 'Local',
        url: '',
        transport: 'stdio',
        command: sidecar.connection.command,
        args: sidecar.connection.args,
        enabled: true,
        tools: [{ name: 'work' }],
      },
    ],
  })
  const execution = { streamId, generation: 1 }
  const live = (await _getExecution(ctx, {
    ...execution,
    sessionId,
    agentId,
    serverKey: 'local',
    toolName: 'work',
  }))!
  const status = await sidecar.registry.connect(
    live.runtime.scope,
    mcpConnectionSchema.parse(live.server),
  )
  await connected(ctx, {
    runtimeId: live.runtime.runtimeId,
    key: live.runtime.scope.key,
    bootId: status.bootId,
    generation: status.generation,
  })
  const args = {
    ...execution,
    messageId,
    serverKey: 'local',
    toolName: 'work',
    name: 'local_work',
    toolCallId: 'call-one',
    args: '{}',
    runtimeId: live.runtime.runtimeId,
    key: live.runtime.scope.key,
    bootId: status.bootId,
    connectionGeneration: status.generation,
  }
  type Reference = Parameters<typeof getFunctionName>[0]
  const queryHandlers = {
    _cleanup: Cleanup.get,
    _get: Operations.get,
    _outputDefinition: Operations.outputDefinition,
    _find: Operations.find,
    _pending: Operations.pending,
    _allowed: Operations.lease,
    _inspect: Operations.inspect,
    _unsettled: Operations.unsettled,
  }
  const mutationHandlers = {
    _getExecution,
    _connected: connected,
    _updateRuntimeStatus: updateStatus,
    _cleanupDone: Cleanup.done,
    _reserve: Operations.reserve,
    _observe: Operations.observe,
    _deliver: Operations.deliver,
    _acknowledged: Operations.acknowledged,
    _forgetDeleted: Operations.forgetDeleted,
  }
  const action = {
    storage: ctx.storage,
    runQuery: async (ref: Reference, input: unknown) => {
      const reference = getFunctionName(ref)
      if (reference === 'sessions:_getApprovals') {
        return getApprovals(
          ctx,
          (input as { sessionId: Id<'sessions'> }).sessionId,
        )
      }
      if (reference.startsWith('mcpBroker:')) {
        const handlers = {
          _target: BrokerAccess.target,
          _server: BrokerAccess.server,
          _output: BrokerAccess.output,
        }
        return handlers[reference.split(':')[1] as keyof typeof handlers](
          ctx,
          input as never,
        )
      }
      const catalogQueries = {
        _launch: Catalogs.launch,
        _references: Catalogs.references,
        _available: CatalogAccess.available,
        _definitionAccess: CatalogAccess.definitionAccess,
      }
      if (reference.startsWith('mcpCatalogs:'))
        return catalogQueries[
          reference.split(':')[1] as keyof typeof catalogQueries
        ](ctx, input as never)
      if (getFunctionName(ref) === 'streams:_isActive') {
        const requested = input as typeof execution
        const stream = await db.get(requested.streamId)
        return (
          stream?.generation === requested.generation &&
          (stream.state as { phase: string }).phase === 'streaming'
        )
      }
      const name = getFunctionName(ref).split(
        ':',
      )[1] as keyof typeof queryHandlers
      return (queryHandlers[name] as (ctx: unknown, args: unknown) => unknown)(
        ctx,
        input,
      )
    },
    runMutation: async (ref: Reference, input: unknown) => {
      const reference = getFunctionName(ref)
      if (reference.startsWith('mcpBroker:')) {
        const handlers = {
          _search: BrokerAccess.search,
          _servers: BrokerAccess.servers,
        }
        return handlers[reference.split(':')[1] as keyof typeof handlers](
          ctx,
          input as never,
        )
      }
      const catalogMutations = {
        begin: Catalogs.begin,
        _beginActive: Catalogs.beginActive,
        _append: Catalogs.append,
        _publish: Catalogs.publish,
        _fail: Catalogs.fail,
        _expire: Catalogs.expire,
      }
      if (reference.startsWith('mcpCatalogs:'))
        return catalogMutations[
          reference.split(':')[1] as keyof typeof catalogMutations
        ](ctx, input as never)
      const name = getFunctionName(ref).split(':')[1]
      if (name === '_saveLog') return true
      if (name === '_heartbeat')
        return _heartbeat(ctx, input as typeof execution)
      if (name === '_patchMessage') return _patchMessage(ctx, input as never)
      if (name === '_trackOffloadedOutput') {
        if (!validate(trackStreamOutputArgsValidator, input))
          throw new Error('Invalid offloaded output arguments')
        return _trackOffloadedOutput(ctx, input)
      }
      return (
        mutationHandlers[name as keyof typeof mutationHandlers] as (
          ctx: unknown,
          args: unknown,
        ) => unknown
      )(ctx, input)
    },
  } as unknown as ActionCtx
  return {
    ...database,
    sidecar,
    blobs,
    action,
    agentId,
    sessionId,
    messageId,
    contentId,
    execution,
    args,
    status,
  }
}
