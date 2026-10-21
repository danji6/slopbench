import { mcpConnectionSchema } from '@sb/core/types'
import type { McpRuntimeScope } from '@sb/core/types'
import { McpOperations } from '@sb/sidecar/mcp/external/operation'
import type { OperationStart } from '@sb/sidecar/mcp/external/operation'
import { McpOperationStore } from '@sb/sidecar/mcp/external/operation-store'
import { McpRegistry } from '@sb/sidecar/mcp/external/registry'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function operationFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sb-mcp-operation-'))
  const registry = new McpRegistry()
  const scope: McpRuntimeScope = {
    key: randomUUID(),
    ownerId: 'owner',
    sessionId: randomUUID(),
    agentId: 'agent',
    serverId: 'local',
    revision: '1',
  }
  const connection = mcpConnectionSchema.parse({
    transport: 'stdio',
    command: process.execPath,
    args: [
      ...(process.versions.bun ? ['--no-env-file'] : []),
      fileURLToPath(
        new URL('../mcp/fixtures/long-operation.mjs', import.meta.url),
      ),
    ],
  })
  const status = await registry.connect(scope, connection)
  const store = new McpOperationStore(path.join(root, 'journal'))
  const limits = {
    operations: 64,
    resultBytes: 1024 * 1024,
    cancellationGraceMs: 50,
    forgetGraceMs: 0,
  }
  const operations = new McpOperations(registry, store, limits)
  const input: OperationStart = {
    id: randomUUID(),
    scope,
    bootId: status.bootId,
    generation: status.generation,
    expiresAt: Date.now() + 30_000,
    deadlineAt: Date.now() + 5000,
    name: 'work',
    args: {},
    requestTimeoutMs: 2000,
    maxTotalTimeoutMs: 5000,
  }
  async function close() {
    await registry.close()
    await operations.drain()
    await Bun.sleep(65)
    await rm(root, { recursive: true, force: true })
  }
  return {
    root,
    registry,
    scope,
    connection,
    status,
    store,
    limits,
    operations,
    input,
    close,
  }
}

export async function untilOperation(
  check: () => Promise<boolean>,
  deadline = 3000,
) {
  const end = Date.now() + deadline
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(10)
  }
  throw new Error('MCP operation did not settle')
}
