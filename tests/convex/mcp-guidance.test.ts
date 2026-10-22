import { guidanceSnapshot } from '@sb/convex/model/mcpCatalogContext'
import { expect, test } from 'bun:test'

test('guidance previews retain literal server/session provenance and point to full scoped retrieval', () => {
  const initialization = '{{ DO_NOT_EVALUATE }} λ😀'.repeat(1000)
  const runtimes = Array.from({ length: 64 }, (_, i) => ({
    scope: { sessionId: `session-${i}` },
    generation: `generation-${i}`,
    initialization,
    serverId: `server-${i}`,
  }))
  const previews = guidanceSnapshot(runtimes)
  expect(
    previews.reduce((total, row) => total + row.initialization.length, 0),
  ).toBe(32_768)
  expect(previews).toHaveLength(64)
  expect(previews[0]).toMatchObject({
    scope: { sessionId: 'session-0' },
    generation: 'generation-0',
    complete: false,
    untrusted: true,
    fullGuidance: {
      tool: 'mcp_protocol',
      method: 'get_server_info',
      serverId: 'server-0',
    },
  })
  expect(previews[0].initialization).toContain('{{ DO_NOT_EVALUATE }}')
  expect(runtimes[0].initialization).toBe(initialization)
})
