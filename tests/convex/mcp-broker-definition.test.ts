import type { Id } from '@sb/convex/_generated/dataModel'
import { refreshCatalog } from '@sb/convex/model/mcpCatalogActions'
import * as Catalogs from '@sb/convex/model/mcpCatalogs'
import { resumeOperations } from '@sb/convex/model/mcpOperationActions'
import { mergeOperationParts } from '@sb/convex/model/mcpOperationParts'
import { reserve } from '@sb/convex/model/mcpOperations'
import { readMcpOutput } from '@sb/convex/model/mcpOutputActions'
import { _claim, _handoff } from '@sb/convex/model/stream/lifecycle'
import type { McpDefinitionPage } from '@sb/core/mcp-definition-presentation'
import { mcpBrokerSearchSchema } from '@sb/core/types/mcp-catalog'
import { expect, mock, test } from 'bun:test'
import { convexToJson } from 'convex/values'

import { mcpCatalogBackend } from '../helpers/mcp-catalog-backend'

type Backend = Awaited<ReturnType<typeof mcpCatalogBackend>>

async function read(f: Backend, input: unknown) {
  const result = await f.broker.search_mcp_tools.execute!(
    mcpBrokerSearchSchema.parse(input),
    f.options(),
  )
  if (typeof result !== 'string') throw new Error('Expected definition JSON')
  expect(() => convexToJson(result)).not.toThrow()
  const toModel = f.broker.search_mcp_tools.toModelOutput!
  const model = await toModel({
    toolCallId: 'search',
    input: mcpBrokerSearchSchema.parse(input),
    output: result,
  })
  expect(model).toEqual({ type: 'text', value: result })
  return JSON.parse(result) as McpDefinitionPage
}

async function readAll(f: Backend, tool: string, view = 'input') {
  let offset = 0
  let text = ''
  for (;;) {
    const page = await read(f, { tool, view, offset, length: 32_768 })
    if ('definition' in page) return page.definition
    expect(page.text).toBeDefined()
    expect(page.text!.length).toBeLessThanOrEqual(32_768)
    expect(page.inputSchemaComplete).toBe(false)
    text += page.text
    expect(page.hasMore).toBe(page.nextOffset !== null)
    if (!page.hasMore) break
    offset = page.nextOffset!
  }
  return JSON.parse(text)
}

test('default definitions are call-ready JSON with intact references and no output-schema bloat', async () => {
  const f = await mcpCatalogBackend()
  try {
    await f.publish()
    const input = await f.target('tool_003')
    const page = await read(f, { tool: input.tool })
    expect(page).toMatchObject({
      name: input.tool,
      view: 'input',
      inputSchemaComplete: true,
      hasMore: false,
      nextOffset: null,
      definition: {
        name: input.tool,
        description: 'Tool 3 for static investigation. ',
        inputSchema: {
          properties: { value: { $ref: '#/$defs/savedValue' } },
          $defs: { savedValue: { type: 'string', description: 'Saved value' } },
        },
        annotations: { readOnlyHint: true },
      },
    })
    expect(page.catalogRevision).toMatch(/^[a-f0-9]{64}$/)
    if (!('definition' in page))
      throw new Error('Expected a call-ready definition')
    expect(page).not.toHaveProperty('text')
    expect(page).not.toHaveProperty('complete')
    expect(page.definition).not.toHaveProperty('outputSchema')
    expect(page.definition).not.toHaveProperty('metadata')
    expect(JSON.stringify(page)).not.toContain('Detailed output')
    expect(JSON.stringify(page).length).toBeLessThan(2000)

    await expect(
      f.broker.call_mcp_tool.execute!(
        { ...input, arguments: { value: 42 } },
        f.options(),
      ),
    ).rejects.toThrow('arguments rejected')
    expect(f.rows('mcpOperations')).toHaveLength(0)
    await expect(
      f.broker.call_mcp_tool.execute!(
        { ...input, arguments: { invalidOutput: true } },
        f.options(),
      ),
    ).rejects.toThrow('MCP output rejected')
    const operation = f.rows('mcpOperations')[0]
    expect(operation.state).toBe('completed')
    expect(operation.error).toContain('MCP output rejected')
    const projected = await mergeOperationParts(f.ctx, f.contentId, [
      {
        type: 'tool-call_mcp_tool',
        toolCallId: operation.toolCallId,
        state: 'output-available',
        errorText: undefined,
      },
    ])
    expect(projected).toMatchObject([
      {
        state: 'output-error',
        errorText: operation.error,
        output: { kind: 'mcp-result' },
      },
    ])
    const retained = await readMcpOutput(f.action, f.execution, {
      output: 'output',
      offset: 0,
      length: 32_768,
    })
    expect(JSON.parse(retained.text).result.structuredContent).toEqual({
      value: 42,
    })
    await expect(
      f.broker.call_mcp_tool.execute!(
        { ...input, arguments: { invalidOutput: true } },
        f.options(),
      ),
    ).rejects.toThrow('MCP output rejected')
    expect(f.rows('mcpOperations')).toHaveLength(1)

    // A new watcher must preserve validation even without executing the wrapper.
    await f.db.patch(operation._id, { delivered: false })
    expect(await _handoff(f.ctx, f.execution)).toBe(true)
    const next = { ...f.execution, generation: 2 }
    expect(await _claim(f.ctx, next)).not.toBeNull()
    expect(await resumeOperations(f.action, next, Date.now() + 3000)).toBe(true)
    expect((await f.db.get(f.contentId))?.parts).toMatchObject([
      {
        state: 'output-error',
        errorText: operation.error,
      },
    ])
    expect(f.rows('mcpOperations')).toHaveLength(1)
  } finally {
    await f.close()
  }
}, 20_000)

test('a pending call resumed by another watcher validates output before durable completion', async () => {
  const f = await mcpCatalogBackend()
  try {
    await f.publish()
    const input = {
      ...(await f.target('tool_003')),
      arguments: { invalidOutput: true },
    }
    const target = f
      .rows('mcpCatalogTools')
      .find((tool) => tool.name === 'tool_003')!
    const operation = await reserve(f.ctx, {
      ...f.args,
      name: 'call_mcp_tool',
      toolName: 'tool_003',
      catalogToolId: target._id as Id<'mcpCatalogTools'>,
      input: JSON.stringify(input),
      args: JSON.stringify(input.arguments),
    })
    expect(operation.state).toBe('running')
    expect(await _handoff(f.ctx, f.execution)).toBe(true)
    const next = { ...f.execution, generation: 2 }
    expect(await _claim(f.ctx, next)).not.toBeNull()
    expect(await resumeOperations(f.action, next, Date.now() + 10_000)).toBe(
      true,
    )
    const completed = await f.db.get(operation._id)
    expect(completed).toMatchObject({
      state: 'completed',
      error: expect.stringContaining('MCP output rejected'),
      acknowledged: true,
      delivered: true,
    })
    expect((await f.db.get(f.contentId))?.parts).toMatchObject([
      {
        state: 'output-error',
        errorText: completed!.error,
      },
    ])
    expect(f.rows('mcpOperations')).toHaveLength(1)
  } finally {
    await f.close()
  }
}, 20_000)

test('opt-in views preserve full schemas and extension metadata without duplicated fields', async () => {
  const f = await mcpCatalogBackend()
  try {
    await f.publish()
    const input = await f.target('tool_003')
    const output = await readAll(f, input.tool, 'output')
    expect(output.outputSchema.description).toBe(
      'Detailed output '.repeat(2500),
    )
    expect(output).not.toHaveProperty('inputSchema')
    expect(output).not.toHaveProperty('metadata')
    const metadata = await read(f, { tool: input.tool, view: 'metadata' })
    expect(metadata.inputSchemaComplete).toBe(false)
    expect(metadata.hasMore).toBe(false)
    if (!('definition' in metadata))
      throw new Error('Expected complete metadata')
    expect(metadata.definition).toMatchObject({
      metadata: {
        title: 'Tool title 3',
        _meta: { provenance: { source: 'catalog-fixture' } },
      },
    })
    const full = await readAll(f, input.tool, 'full')
    expect(full.inputSchema.$defs.savedValue.type).toBe('string')
    expect(full.outputSchema).toEqual(output.outputSchema)
    expect(full.metadata).toEqual(metadata.definition!.metadata)
    for (const key of [
      'name',
      'description',
      'inputSchema',
      'outputSchema',
      'annotations',
    ]) {
      expect(full.metadata).not.toHaveProperty(key)
    }
  } finally {
    await f.close()
  }
}, 20_000)

test('large input contracts and full definitions round-trip with explicit terminal fragments', async () => {
  const f = await mcpCatalogBackend()
  try {
    await f.publish()
    const input = await f.target()
    const contract = await readAll(f, input.tool)
    expect(contract.description).toBe(
      'Tool 249 for static investigation. ' + 'Long description '.repeat(100),
    )
    expect(contract.inputSchema.properties.value.description).toBe(
      'λ😀'.repeat(30_000),
    )
    expect(contract).not.toHaveProperty('outputSchema')
    const full = await readAll(f, input.tool, 'full')
    expect(full.inputSchema).toEqual(contract.inputSchema)
    expect(full.metadata.title).toBe('Tool title 249')
    expect(full.outputSchema.type).toBe('object')
    expect(full.annotations.readOnlyHint).toBe(true)
    await expect(
      read(f, { tool: input.tool, offset: 999_999 }),
    ).rejects.toThrow('out of range')
  } finally {
    await f.close()
  }
}, 20_000)

test('cached definitions reauthorize every read and cannot survive a replaced catalog target', async () => {
  const f = await mcpCatalogBackend()
  try {
    await f.publish()
    const input = await f.target('tool_003')
    const get = mock(f.action.storage.get)
    f.action.storage.get = get
    const [first, repeated] = await Promise.all([
      read(f, { tool: input.tool }),
      read(f, { tool: input.tool }),
    ])
    expect(repeated).toEqual(first)
    await read(f, { tool: input.tool, view: 'metadata' })
    expect(get).toHaveBeenCalledTimes(1)
    const unchanged = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await refreshCatalog(f.action, unchanged)
    expect((await read(f, { tool: input.tool })).catalogRevision).toBe(
      first.catalogRevision,
    )
    expect(get).toHaveBeenCalledTimes(1)
    await f.db.patch(f.agentId, { tools: [] })
    await expect(read(f, { tool: input.tool })).rejects.toThrow('unavailable')
    await f.db.patch(f.agentId, { tools: ['mcp_server:local'] })
    await f.sidecar.registry.call(
      f.status.scope,
      'tool_000',
      { changeCatalog: true },
      f.status,
    )
    const changed = await Catalogs.begin(f.ctx, { serverId: f.serverId })
    await refreshCatalog(f.action, changed, {
      scope: f.status.scope,
      bootId: f.status.bootId,
      generation: f.status.generation,
      expiresAt: Date.now() + 30_000,
    })
    await expect(read(f, { tool: input.tool })).rejects.toThrow('stale')
    const replacement = await f.target('tool_003')
    const latest = await read(f, { tool: replacement.tool })
    expect(latest.catalogRevision).not.toBe(first.catalogRevision)
    if (!latest.definition) throw new Error('Expected a call-ready definition')
    expect(latest.definition.name).toBe('tool_003_1')
    expect(get).toHaveBeenCalledTimes(2)
  } finally {
    await f.close()
  }
}, 30_000)
