import type { Id } from '@sb/convex/_generated/dataModel'
import { configureComponent } from '@sb/convex/model/integrations/components'
import { publish } from '@sb/convex/model/integrations/publication'
import { select } from '@sb/convex/model/integrations/selection'
import { _getExecution } from '@sb/convex/model/mcp'
import { servers as namedServers } from '@sb/convex/model/mcpBrokerAccess'
import { connected } from '@sb/convex/model/mcpRuntime'
import { cleanup } from '@sb/convex/model/mcpRuntimeActions'
import { createMcpBrokerTools } from '@sb/convex/model/tool/mcpBroker'
import { mcpResultSchema } from '@sb/core/types/mcp-result'
import { sidecarAuthentication } from '@sb/sidecar/auth'
import {
  inspectIntegration,
  integrationConnections,
} from '@sb/sidecar/integrations/manifest'
import { mcpCatalogRoutes } from '@sb/sidecar/mcp/external/catalog-routes'
import { CatalogSnapshots } from '@sb/sidecar/mcp/external/catalog-snapshots'
import { mcpOperationRoutes } from '@sb/sidecar/mcp/external/operation-routes'
import { expect } from 'bun:test'
import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { mcpBackendFixture } from './mcp-backend'
import { untilOperation } from './mcp-operations'

type Backend = Awaited<ReturnType<typeof mcpBackendFixture>>
type Actor = { sessionId: Id<'sessions'>; agentId: Id<'agents'> }
type SearchPage = {
  tools: { name: string; originalName: string; diagnostic?: string }[]
  nextCursor: string | null
}

/** Uses real backend model/actions and sidecar HTTP handlers, with an in-memory Convex adapter. */
export async function reaConformanceFixture(toolkit: string) {
  const f = await mcpBackendFixture()
  const root = await mkdtemp(path.join(tmpdir(), 'sb-rea-conformance-'))
  const pidDirectory = path.join(root, 'pids')
  await mkdir(pidDirectory)
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'rea-conformance-only'
  try {
    await f.sidecar.registry.disconnect(f.status.scope)
    mountSidecar(f)
    const snapshot = await inspectIntegration(toolkit)
    await f.db.patch('owner', { subject: 'owner' })
    const { integrationId, serverId, serverKey } = await registerToolkit(
      f,
      snapshot,
      root,
    )
    return {
      ...f,
      root,
      snapshot,
      integrationId,
      serverId,
      serverKey,
      turn: (actor: Actor = f) => createTurn(f, serverId, actor),
      flushCleanup: () => flushCleanup(f),
      target: (name: string) => createTarget(root, name),
      pids: async () =>
        (await readdir(pidDirectory)).map((file) =>
          Number(path.basename(file, '.pid')),
        ),
      close,
    }
  } catch (cause) {
    await close()
    throw cause
  }

  async function close() {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = originalSecret
    await f.sidecar.close()
    expect(f.sidecar.registry.list()).toEqual([])
    for (const file of await readdir(pidDirectory)) {
      const pid = Number(path.basename(file, '.pid'))
      await untilOperation(async () => !processAlive(pid))
    }
    expect(existsSync(f.sidecar.root)).toBe(false)
    await rm(root, { recursive: true, force: true })
    expect(existsSync(root)).toBe(false)
  }
}

async function registerToolkit(
  f: Backend,
  snapshot: Awaited<ReturnType<typeof inspectIntegration>>,
  root: string,
) {
  const integrationId = await publish(f.ctx, {
    subject: 'owner',
    root: snapshot.root,
    revision: snapshot.revision,
    manifest: JSON.stringify(snapshot.manifest),
    connections: integrationConnections(snapshot),
  })
  const server = f
    .rows('mcpServers')
    .find((row) => row.integrationId === integrationId)!
  const serverId = server._id as Id<'mcpServers'>
  await configureComponent(f.ctx, {
    serverId,
    enabled: true,
    env: {
      HOME: root,
      XDG_CONFIG_HOME: root,
      XDG_CACHE_HOME: root,
      NODE_OPTIONS: `--import=${new URL('../fixtures/mcp/process-identity.mjs', import.meta.url).href}`,
      SLOPBENCH_TEST_PID_DIR: path.join(root, 'pids'),
    },
  })
  await select(f.ctx, { integrationId, agentId: f.agentId, enabled: true })
  return { integrationId, serverId, serverKey: String(server.key) }
}

function mountSidecar(f: Backend) {
  const original = globalThis.fetch
  const app = new Hono()
  app.use('*', sidecarAuthentication(process.env.SIDECAR_SECRET))
  app.onError((cause, c) => c.json({ error: cause.message }, 500))
  app.route(
    '/mcp-ext/catalog',
    mcpCatalogRoutes(f.sidecar.registry, new CatalogSnapshots()),
  )
  app.route(
    '/mcp-ext/operations',
    mcpOperationRoutes(() => f.sidecar.operations),
  )
  app.post('/mcp-ext/connect', async (c) => {
    const input = await c.req.json()
    return c.json(
      await f.sidecar.registry.connect(input.scope, input.connection, input),
    )
  })
  app.post('/mcp-ext/disconnect', async (c) => {
    await f.sidecar.registry.disconnect((await c.req.json()).scope)
    return c.json({ ok: true })
  })
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      app.fetch(new Request(input, init)),
    { preconnect: original.preconnect },
  )
}

async function createTurn(
  f: Backend,
  serverId: Id<'mcpServers'>,
  actor: Actor,
) {
  const { messageId, contentId, execution } = await insertTurn(f, actor)
  const broker = await createMcpBrokerTools({
    operation: { ctx: f.action, execution, messageId },
    current: (serverKey, toolName) =>
      _getExecution(f.ctx, { ...execution, ...actor, serverKey, toolName }),
    connected: (runtimeId, key, bootId, generation, initialization) =>
      connected(f.ctx, { runtimeId, key, bootId, generation, initialization }),
  })
  return {
    execution,
    messageId,
    contentId,
    broker,
    ...brokerCalls(
      broker,
      (await namedServers(f.ctx, execution)).find(
        (row) => row.recordId === serverId,
      )!.name,
    ),
  }
}

async function insertTurn(f: Backend, actor: Actor) {
  const messageId = (await f.db.insert('messages', {
    sessionId: actor.sessionId,
    selectedVersion: 1,
    versionCount: 1,
    role: 'assistant',
    status: 'processing',
  })) as Id<'messages'>
  const contentId = (await f.db.insert('messageContents', {
    messageId,
    sessionId: actor.sessionId,
    version: 1,
    segmentIndex: 0,
    parts: [],
  })) as Id<'messageContents'>
  const streamId = (await f.db.insert('streams', {
    ...actor,
    invokedBy: 'owner',
    generation: 1,
    attempt: 0,
    command: { kind: 'invoke' },
    leaseExpiresAt: Date.now() + 300_000,
    state: {
      phase: 'streaming',
      processingMessageId: messageId,
      processingContentId: contentId,
    },
  })) as Id<'streams'>
  const execution = { streamId, generation: 1 }
  return { messageId, contentId, execution }
}

function brokerCalls(
  broker: Awaited<ReturnType<typeof createMcpBrokerTools>>,
  server: string,
) {
  const options = { toolCallId: 'search', messages: [], context: {} }
  async function search(query = '', cursor?: string) {
    return (await broker.search_mcp_tools.execute!(
      {
        server,
        query,
        cursor,
        view: 'input',
        limit: 25,
        offset: 0,
        length: 32_768,
      },
      options,
    )) as SearchPage
  }
  async function invoke(
    name: string,
    args: Record<string, unknown> = {},
    callId: string = crypto.randomUUID(),
    abortSignal?: AbortSignal,
  ) {
    const target = (await search(name)).tools.find(
      (tool) => tool.originalName === name,
    )
    if (!target) throw new Error(`REA tool is missing: ${name}`)
    return mcpResultSchema.parse(
      await broker.call_mcp_tool.execute!(
        { tool: target.name, arguments: args },
        { ...options, toolCallId: callId, abortSignal },
      ),
    )
  }
  return { search, invoke }
}

async function flushCleanup(f: Backend) {
  for (const row of [...f.rows('mcpCleanups')])
    await cleanup(f.action, { cleanupId: row._id as Id<'mcpCleanups'> })
  expect(f.rows('mcpCleanups')).toEqual([])
}

async function createTarget(root: string, name: string) {
  const target = path.join(root, name)
  await mkdir(target)
  await writeFile(
    path.join(target, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', main: 'main.cjs' }),
  )
  await writeFile(
    path.join(target, 'main.cjs'),
    `module.exports = function ${name}() { return fetch('https://example.invalid/${name}') }`,
  )
  return target
}

/** Reads canonical structured data; tool-reported errors stay distinguishable. */
export function reaData(output: ReturnType<typeof mcpResultSchema.parse>) {
  expect(output.result.isError).not.toBe(true)
  return (
    output.result.structuredContent ??
    JSON.parse(String(output.result.content[0].text))
  )
}

export type ReaFixture = Awaited<ReturnType<typeof reaConformanceFixture>>

export function processAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
