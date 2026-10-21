import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { _getExecution, replaceAll } from '@sb/convex/model/mcp'
import * as Operations from '@sb/convex/model/mcpOperations'
import { connected } from '@sb/convex/model/mcpRuntime'
import { _heartbeat, _patchMessage } from '@sb/convex/model/stream/lifecycle'
import { mcpConnectionSchema } from '@sb/core/types'
import { getFunctionName } from 'convex/server'

import { operationFixture } from './mcp-operations'
import { skillsDatabase } from './skills-db'

export async function mcpBackendFixture() {
  const sidecar = await operationFixture()
  await sidecar.registry.disconnect(sidecar.scope)
  const database = skillsDatabase()
  const { ctx, db } = database
  const originalInsert = db.insert
  db.insert = (table, fields) =>
    originalInsert(table, { _creationTime: Date.now(), ...fields })
  const blobs = new Map<string, Blob>()
  Object.assign(ctx, {
    storage: {
      store: async (blob: Blob) => {
        const id = `blob-${blobs.size}`
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
    _get: Operations.get,
    _find: Operations.find,
    _pending: Operations.pending,
    _allowed: Operations.lease,
    _inspect: Operations.inspect,
    _unsettled: Operations.unsettled,
  }
  const mutationHandlers = {
    _reserve: Operations.reserve,
    _observe: Operations.observe,
    _deliver: Operations.deliver,
    _acknowledged: Operations.acknowledged,
    _forgetDeleted: Operations.forgetDeleted,
  }
  const action = {
    storage: ctx.storage,
    runQuery: async (ref: Reference, input: unknown) => {
      if (getFunctionName(ref) === 'streams:_isActive') {
        const stream = await db.get(execution.streamId)
        return (
          stream?.generation === execution.generation &&
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
      const name = getFunctionName(ref).split(':')[1]
      if (name === '_saveLog') return true
      if (name === '_heartbeat')
        return _heartbeat(ctx, input as typeof execution)
      if (name === '_patchMessage') return _patchMessage(ctx, input as never)
      if (name === '_trackOffloadedOutput') return true
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
