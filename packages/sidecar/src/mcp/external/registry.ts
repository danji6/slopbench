import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type {
  McpConnection,
  McpRuntimeScope,
  McpRuntimeStatus,
} from '@sb/core/types'
import type { McpProgress } from '@sb/core/types/mcp-operation'
import type { McpProtocolRequest } from '@sb/core/types/mcp-protocol'
import { mcpResult } from '@sb/core/types/mcp-result'
import { createHash, randomUUID } from 'node:crypto'

import { connectExternalClient } from './client'
import { discoverTools } from './discovery'
import { initializationContext, requestProtocol } from './protocol'

type Entry = {
  status: McpRuntimeStatus
  fingerprint: string
  client?: Client
  connecting: Promise<void>
  queue: Promise<unknown>
  rawStderr: string
  secrets: string[]
  startup: AbortController
  touchedAt: number
  catalogChanges: number
}

type Expectation = { bootId?: string; generation?: string; expiresAt?: number }
const STDERR_CHARS = 8192

/** Owns persistent clients; a lost connection requires an explicit new scope key. */
export class McpRegistry {
  readonly bootId = randomUUID()
  private entries = new Map<string, Entry>()
  private retired = new Map<string, number>()
  private fences = new Map<string, { epoch: number; key: string; at: number }>()
  private shuttingDown = false

  constructor(private readonly maxConnections = 64) {}

  private binding(scope: McpRuntimeScope) {
    return JSON.stringify([
      scope.ownerId,
      scope.sessionId,
      scope.agentId,
      scope.serverId,
    ])
  }

  /** Rejects late authorizations before they can replace a newer analysis process. */
  private async fenceScope(scope: McpRuntimeScope) {
    const binding = this.binding(scope)
    const previous = this.fences.get(binding)
    const epoch = scope.epoch ?? 0

    const superseded =
      previous &&
      (previous.epoch > epoch ||
        (previous.epoch === epoch && previous.key !== scope.key))
    if (superseded) {
      throw new Error('MCP authorization was superseded; reconnect explicitly')
    }

    this.fences.set(binding, { epoch, key: scope.key, at: Date.now() })
    const older = this.list().filter(
      (item) =>
        item.scope.key !== scope.key && this.binding(item.scope) === binding,
    )
    await Promise.all(
      older.map((item) =>
        this.disconnect(item.scope, 'MCP connection replaced'),
      ),
    )
    if (this.fences.get(binding)?.key !== scope.key) {
      throw new Error('MCP authorization was superseded')
    }
  }

  private assertExpected(entry: Entry | undefined, expected: Expectation) {
    if (expected.bootId && expected.bootId !== this.bootId) {
      throw new Error(
        'MCP session lost after sidecar restart; reconnect explicitly. The previous outcome may be unknown.',
      )
    }
    if (
      expected.generation &&
      expected.generation !== entry?.status.generation
    ) {
      throw new Error('MCP connection generation changed; reconnect explicitly')
    }
  }

  async connect(
    scope: McpRuntimeScope,
    connection: McpConnection,
    expected: Expectation = {},
  ) {
    if (this.shuttingDown) {
      throw new Error('MCP service is shutting down')
    }

    this.pruneRetired()

    if (this.retired.has(scope.key)) {
      throw new Error('MCP connection was revoked')
    }

    this.assertExpected(this.entries.get(scope.key), expected)
    await this.fenceScope(scope)

    if (this.shuttingDown) {
      throw new Error('MCP service is shutting down')
    }
    if (this.retired.has(scope.key)) {
      throw new Error('MCP connection was revoked')
    }

    const existing = this.entries.get(scope.key)
    this.assertExpected(existing, expected)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ scope, connection }))
      .digest('hex')

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error('MCP configuration changed; reconnect explicitly')
      }
      await existing.connecting
      if (existing.status.state !== 'connected') {
        throw new Error(
          existing.status.reason ?? 'MCP session lost; reconnect explicitly',
        )
      }
      return this.view(existing)
    }

    const active = [...this.entries.values()].filter(
      (entry) => !['lost', 'closed'].includes(entry.status.state),
    )
    if (active.length >= this.maxConnections) {
      throw new Error(
        'MCP connection capacity reached; disconnect an existing session',
      )
    }

    const entry: Entry = {
      status: {
        scope: structuredClone(scope),
        bootId: this.bootId,
        generation: randomUUID(),
        state: 'connecting',
        stderr: '',
      },
      fingerprint,
      connecting: Promise.resolve(),
      queue: Promise.resolve(),
      touchedAt: Date.now(),
      catalogChanges: 0,
      rawStderr: '',
      startup: new AbortController(),
      secrets: [
        ...Object.values(connection.secretEnv ?? {}),
        ...(connection.apiKey ? [connection.apiKey] : []),
      ].filter(Boolean),
    }

    this.entries.set(scope.key, entry)
    entry.connecting = this.start(entry, connection)
    await entry.connecting

    if (entry.status.state !== 'connected') {
      throw new Error(
        entry.status.reason ?? 'MCP connection revoked during startup',
      )
    }

    return this.view(entry)
  }

  private async start(entry: Entry, connection: McpConnection) {
    try {
      const { client, transport } = await connectExternalClient(
        connection,
        (chunk) => this.appendStderr(entry, chunk),
        entry.startup.signal,
      )
      entry.client = client
      entry.status.initialization = initializationContext(client)
      entry.status.catalogStale = true
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        entry.catalogChanges++
        entry.status.catalogStale = true
      })
      if (entry.status.state !== 'connecting') {
        await client.close()
        return
      }

      client.onclose = () => {
        if (entry.status.state === 'connected') {
          entry.touchedAt = Date.now()
          entry.status.state = 'lost'
          entry.status.reason =
            'MCP process or connection exited; analysis state was lost. Reconnect explicitly.'
        }
      }

      client.onerror = () => {
        if (entry.status.state !== 'connected') return
        entry.status.state = 'lost'
        entry.touchedAt = Date.now()
        entry.status.reason =
          'MCP transport failed; session state may be lost. Reconnect explicitly.'
        void client.close().catch(() => {})
      }

      entry.status.transport = transport
      entry.status.state = 'connected'
    } catch (error) {
      await entry.client?.close().catch(() => {})
      entry.status.state = 'lost'
      entry.status.reason = this.redact(
        entry,
        error instanceof Error ? error.message : 'MCP startup failed',
      )
      // Keep credential-bearing upstream causes out of diagnostics
      // eslint-disable-next-line preserve-caught-error
      throw new Error(entry.status.reason)
    }
  }

  private redact(entry: Entry, text: string) {
    for (const secret of entry.secrets)
      text = text.split(secret).join('[redacted]')
    return text
  }

  private appendStderr(entry: Entry, chunk: string) {
    const carry = Math.max(0, ...entry.secrets.map((secret) => secret.length)) * 2 // prettier-ignore
    entry.rawStderr = (entry.rawStderr + chunk).slice(-(STDERR_CHARS + carry))
    let text = this.redact(entry, entry.rawStderr)

    // Hold back partial credential prefixes until the next stream chunk arrives
    for (const secret of entry.secrets) {
      for (
        let length = Math.min(secret.length - 1, text.length);
        length > 0;
        length--
      ) {
        if (!text.endsWith(secret.slice(0, length))) continue
        text = text.slice(0, -length) + '[redacted]'
        break
      }
    }
    entry.status.stderr = text.slice(-STDERR_CHARS)
  }

  private view(entry: Entry): McpRuntimeStatus {
    return structuredClone(entry.status)
  }

  status(scope: McpRuntimeScope): McpRuntimeStatus | null {
    const entry = this.entries.get(scope.key)
    if (!entry) return null
    if (JSON.stringify(entry.status.scope) !== JSON.stringify(scope))
      throw new Error('MCP connection scope mismatch')
    return this.view(entry)
  }

  list(): McpRuntimeStatus[] {
    return [...this.entries.values()].map((entry) => this.view(entry))
  }

  /** Inspects the existing analysis client without replacing its process. */
  async catalog(scope: McpRuntimeScope, expected: Expectation) {
    const entry = this.entries.get(scope.key)

    this.assertExpected(entry, expected)
    this.status(scope)
    if (!entry) {
      throw new Error('MCP connection missing; reconnect explicitly')
    }

    const operation = entry.queue
      .catch(() => {})
      .then(async () => {
        if (entry.status.state !== 'connected' || !entry.client) {
          throw new Error('MCP session unavailable; reconnect explicitly')
        }
        const authorizationExpired =
          expected.expiresAt !== undefined && expected.expiresAt < Date.now()
        if (authorizationExpired) {
          throw new Error('MCP catalog authorization expired while queued')
        }
        const changeToken = entry.catalogChanges
        const tools = await discoverTools(entry.client)
        if (entry.status.state !== 'connected')
          throw new Error('MCP catalog connection revoked')
        if (entry.catalogChanges !== changeToken)
          throw new Error('MCP catalog changed during discovery; refresh again')
        return { tools, changeToken }
      })

    entry.queue = operation

    return operation
  }

  acknowledgeCatalog(
    scope: McpRuntimeScope,
    expected: Expectation,
    changeToken: number,
  ) {
    const entry = this.entries.get(scope.key)
    this.assertExpected(entry, expected)
    this.status(scope)
    if (!entry) return
    if (entry.catalogChanges === changeToken) entry.status.catalogStale = false
  }

  /** Serializes dispatch and checks authorization scope again after queueing. */
  async call(
    scope: McpRuntimeScope,
    name: string,
    args: Record<string, unknown>,
    expected: Expectation,
    signal?: AbortSignal,
    options?: {
      timeout: number
      maxTotalTimeout: number
      onprogress?: (progress: McpProgress) => void
      ondispatch?: () => void
      protocol?: McpProtocolRequest
    },
  ) {
    const entry = this.entries.get(scope.key)
    this.assertExpected(entry, expected)
    this.status(scope)
    if (!entry) throw new Error('MCP connection missing; reconnect explicitly')

    const operation = entry.queue
      .catch(() => {})
      .then(async () => {
        if (entry.status.state !== 'connected' || !entry.client)
          throw new Error('MCP session unavailable; reconnect explicitly')
        signal?.throwIfAborted()
        const authorizationExpired =
          expected.expiresAt !== undefined && expected.expiresAt < Date.now()
        if (authorizationExpired)
          throw new Error('MCP authorization expired while queued')

        options?.ondispatch?.()
        const result = options?.protocol
          ? {
              ...(await requestProtocol(entry.client, options.protocol, {
                signal,
                timeout: options.timeout,
                maxTotalTimeout: options.maxTotalTimeout,
                resetTimeoutOnProgress: true,
                onprogress: options.onprogress,
              })),
              content: [],
            }
          : await entry.client.callTool({ name, arguments: args }, undefined, {
              signal,
              timeout: options?.timeout,
              maxTotalTimeout: options?.maxTotalTimeout,
              resetTimeoutOnProgress: !!options,
              onprogress: options?.onprogress,
            })

        if (entry.status.state !== 'connected') {
          throw new Error(
            'MCP connection revoked during execution; outcome may be unknown',
          )
        }

        return mcpResult(result, {
          serverId: scope.serverId,
          name,
          generation: entry.status.generation,
        })
      })
    entry.queue = operation
    return operation
  }

  /** Rejects queued work while protocol cancellation has a bounded cleanup grace. */
  quiesce(scope: McpRuntimeScope, reason: string) {
    const entry = this.entries.get(scope.key)
    if (!entry) return
    this.status(scope)
    entry.status.state = 'closing'
    entry.status.reason = reason
  }

  async disconnect(
    scope: McpRuntimeScope,
    reason = 'MCP connection disconnected',
  ) {
    this.retired.set(scope.key, Date.now())
    const entry = this.entries.get(scope.key)
    if (!entry) return
    this.status(scope)
    entry.status.state = 'closing'
    entry.status.reason = reason
    entry.startup.abort(new Error(reason))
    await entry.connecting.catch(() => {})
    await entry.client?.close()
    entry.status.state = 'closed'
    this.entries.delete(scope.key)
  }

  async disconnectSessions(sessionIds: string[]) {
    await Promise.all(
      this.list()
        .filter((item) => sessionIds.includes(item.scope.sessionId))
        .map((item) =>
          this.disconnect(item.scope, 'Workspace authority changed'),
        ),
    )
  }

  hasActivity(sessionId: string) {
    return this.list().some(
      (item) =>
        item.scope.sessionId === sessionId &&
        ['connecting', 'closing'].includes(item.state),
    )
  }

  async close() {
    this.shuttingDown = true
    const results = await Promise.allSettled(
      this.list().map((item) =>
        this.disconnect(item.scope, 'Sidecar shutting down'),
      ),
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'MCP shutdown cleanup failed',
      )
  }

  private pruneRetired() {
    const cutoff = Date.now() - 60_000
    for (const [key, entry] of this.entries) {
      if (entry.status.state === 'lost' && entry.touchedAt < cutoff)
        this.entries.delete(key)
    }
    for (const [binding, fence] of this.fences) {
      const active = this.list().some(
        (item) => this.binding(item.scope) === binding,
      )
      if (fence.at < cutoff && !active) this.fences.delete(binding)
    }
    for (const [key, timestamp] of this.retired)
      if (timestamp < cutoff) this.retired.delete(key)
  }
}

export const mcpRegistry = new McpRegistry()
