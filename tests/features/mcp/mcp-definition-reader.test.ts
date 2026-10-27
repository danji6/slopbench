import type { Id } from '@sb/convex/_generated/dataModel'
import type { ActionCtx } from '@sb/convex/_generated/server'
import { createMcpDefinitionReader } from '@sb/convex/model/tool/mcpDefinition'
import { expect, mock, test } from 'bun:test'

function fixture() {
  const blob = new Blob([
    JSON.stringify({
      name: 'status',
      inputSchema: '{"type":"object"}',
      metadata: '{}',
    }),
  ])
  const get = mock(async () => blob as Blob | null)
  const authorize = mock(async () => true)
  const ctx = { storage: { get }, runQuery: authorize } as unknown as ActionCtx
  const read = createMcpDefinitionReader(ctx, {
    streamId: 'stream' as Id<'streams'>,
    generation: 1,
  })
  const target = {
    definitionRef: 'blob' as Id<'_storage'>,
    catalogId: 'catalog' as Id<'mcpCatalogs'>,
    bytes: blob.size,
  }
  return { read, get, authorize, blob, target }
}

test('definition caches retain neither failed reads nor prior authorization', async () => {
  const f = fixture()
  f.get.mockResolvedValueOnce(null)
  await expect(f.read(f.target)).rejects.toThrow('unavailable')
  expect((await f.read(f.target)).name).toBe('status')
  expect(f.get).toHaveBeenCalledTimes(2)
  await f.read(f.target)
  expect(f.get).toHaveBeenCalledTimes(2)
  f.authorize.mockRejectedValueOnce(new Error('access revoked'))
  await expect(f.read(f.target)).rejects.toThrow('access revoked')
  expect(f.authorize).toHaveBeenCalledTimes(4)
})

test('definition caches separate immutable catalog revisions and execution instances', async () => {
  const f = fixture()
  await Promise.all([f.read(f.target), f.read(f.target)])
  expect(f.get).toHaveBeenCalledTimes(1)
  await f.read({ ...f.target, catalogId: 'replacement' as Id<'mcpCatalogs'> })
  expect(f.get).toHaveBeenCalledTimes(2)
  const separate = fixture()
  await separate.read(f.target)
  expect(separate.get).toHaveBeenCalledTimes(1)
})

test('definition caches bound both entry count and retained bytes', async () => {
  const f = fixture()
  for (let index = 0; index < 17; index++) {
    await f.read({
      ...f.target,
      definitionRef: `blob-${index}` as Id<'_storage'>,
    })
  }
  await f.read({ ...f.target, definitionRef: 'blob-0' as Id<'_storage'> })
  expect(f.get).toHaveBeenCalledTimes(18)
  const large = { ...f.target, bytes: 5 * 1024 * 1024 }
  await f.read(large)
  await f.read({ ...large, definitionRef: 'other' as Id<'_storage'> })
  await f.read(large)
  expect(f.get).toHaveBeenCalledTimes(21)
})
