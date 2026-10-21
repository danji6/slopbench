import { CatalogSnapshots } from '@sb/sidecar/mcp/external/catalog-snapshots'
import { listExternalTools, withClient } from '@sb/sidecar/mcp/external/client'
import { discoverTools } from '@sb/sidecar/mcp/external/discovery'
import { expect, test } from 'bun:test'

import { operationFixture, untilOperation } from '../helpers/mcp-operations'

const fixture = new URL('./fixtures/catalog.mjs', import.meta.url)

test('discovery follows all pages and preserves large schemas, original names and protocol metadata', async () => {
  const f = await operationFixture(fixture)
  try {
    const catalog = await f.registry.catalog(f.scope, f.status)
    expect(catalog.tools).toHaveLength(250)
    const large = catalog.tools[249]
    expect(large.inputSchema.length).toBeGreaterThan(80_000)
    expect(JSON.parse(large.inputSchema).properties.value.description).toBe(
      'λ😀'.repeat(30_000),
    )
    expect(JSON.parse(large.outputSchema!)).toHaveProperty('properties.value')
    expect(JSON.parse(large.annotations!)).toHaveProperty('readOnlyHint', true)
    expect(JSON.parse(large.metadata)).toHaveProperty(
      '_meta.provenance.source',
      'catalog-fixture',
    )
    expect(catalog.tools[17].diagnostic).toContain(
      'Unsupported MCP input schema',
    )
    expect(large.diagnostic).toBeUndefined()
  } finally {
    await f.close()
  }
})

for (const mode of ['loop', 'failure', 'malformed', 'duplicate']) {
  test(`incomplete ${mode} discovery fails explicitly`, async () => {
    const f = await operationFixture(fixture, [mode])
    try {
      await expect(f.registry.catalog(f.scope, f.status)).rejects.toThrow()
    } finally {
      await f.close()
    }
  })
}

test('a temporary probe never replaces the existing analysis process', async () => {
  const f = await operationFixture(fixture)
  try {
    const args = { value: 'retained' }
    const before = JSON.parse(
      await f.registry.call(f.scope, 'tool_249', args, f.status),
    )
    const probe = await listExternalTools(f.connection)
    expect(probe.value).toHaveLength(250)
    const after = JSON.parse(
      await f.registry.call(f.scope, 'tool_249', {}, f.status),
    )
    expect(after.value).toBe('retained')
    expect(after.pid).toBe(before.pid)
    expect(after.calls).toBe(2)
  } finally {
    await f.close()
  }
})

test('list_changed marks stale; acknowledgement only clears the captured generation', async () => {
  const f = await operationFixture(fixture)
  try {
    const first = await f.registry.catalog(f.scope, f.status)
    f.registry.acknowledgeCatalog(f.scope, f.status, first.changeToken)
    expect(f.registry.status(f.scope)?.catalogStale).toBe(false)
    await f.registry.call(
      f.scope,
      'tool_000',
      { changeCatalog: true },
      f.status,
    )
    await untilOperation(async () => !!f.registry.status(f.scope)?.catalogStale)
    f.registry.acknowledgeCatalog(f.scope, f.status, first.changeToken)
    expect(f.registry.status(f.scope)?.catalogStale).toBe(true)
    const second = await f.registry.catalog(f.scope, f.status)
    expect(second.tools).toHaveLength(251)
    f.registry.acknowledgeCatalog(f.scope, f.status, second.changeToken)
    expect(f.registry.status(f.scope)?.catalogStale).toBe(false)
    await expect(
      f.registry.catalog(f.scope, { ...f.status, generation: 'wrong' }),
    ).rejects.toThrow('generation changed')
  } finally {
    await f.close()
  }
})

test('snapshot pages preserve all entries and reject expired/missing cursors', async () => {
  const f = await operationFixture(fixture)
  try {
    const { value: tools } = await withClient(f.connection, discoverTools)
    const snapshots = new CatalogSnapshots()
    const snapshot = snapshots.create(tools)
    const collected = []
    let cursor: number | null = 0
    while (cursor !== null) {
      const page = snapshots.page(snapshot.id, cursor)
      collected.push(...page.tools)
      cursor = page.nextCursor
    }
    expect(collected).toEqual(tools)
    expect(() => snapshots.page(snapshot.id, 9999)).toThrow('cursor')
    snapshots.delete(snapshot.id)
    expect(() => snapshots.page(snapshot.id, 0)).toThrow('expired')
  } finally {
    await f.close()
  }
})
