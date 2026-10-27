import { guidanceSnapshot } from '@sb/convex/model/mcpCatalogContext'
import { expect, test } from 'bun:test'

test('guidance previews retain literal server/session provenance and point to full scoped retrieval', () => {
  const initialization = '{{ DO_NOT_EVALUATE }} λ😀'.repeat(1000)
  const runtimes = Array.from({ length: 64 }, (_, i) => ({
    initialization,
    server: `server-${i}`,
  }))
  const previews = guidanceSnapshot(runtimes)
  expect(
    previews.reduce((total, row) => total + row.initialization.length, 0),
  ).toBe(32_768)
  expect(previews).toHaveLength(64)
  expect(previews[0]).toMatchObject({
    complete: false,
    untrusted: true,
    fullGuidance: {
      tool: 'mcp_protocol',
      method: 'get_server_info',
      server: 'server-0',
    },
  })
  expect(previews[0].initialization).toContain('{{ DO_NOT_EVALUATE }}')
  expect(runtimes[0].initialization).toBe(initialization)
  expect(
    guidanceSnapshot([{ initialization: 'Unscoped server data' }]),
  ).toEqual([])
})
