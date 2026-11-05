import type { McpDefinitionPage } from '@sb/core/mcp-definition-presentation'
import { mcpBrokerSearchSchema } from '@sb/core/types/mcp-catalog'
import { expect, test } from 'bun:test'
import { reaConformanceFixture, reaData } from '~/tests/helpers/rea-conformance'

const toolkit = process.env.SLOPBENCH_REA_ROOT

// Explicit opt-in: use an installed checkout through isolated backend/sidecar fixtures.
test.skipIf(!toolkit)(
  'real REA exposes a compact session input contract and validates its full output',
  async () => {
    const f = await reaConformanceFixture(toolkit!)
    try {
      const turn = await f.turn()
      const target = (await turn.search('binary_session')).tools.find(
        (tool) => tool.originalName === 'binary_session',
      )!
      const response = await turn.broker.search_mcp_tools.execute!(
        mcpBrokerSearchSchema.parse({ tool: target.name }),
        { toolCallId: 'definition', messages: [], context: {} },
      )
      if (typeof response !== 'string')
        throw new Error('Expected definition JSON')
      const page = JSON.parse(response) as McpDefinitionPage
      expect(page).toMatchObject({
        view: 'input',
        inputSchemaComplete: true,
        hasMore: false,
        definition: { inputSchema: { type: 'object' } },
      })
      expect(page.definition).not.toHaveProperty('outputSchema')
      expect(page.definition).not.toHaveProperty('metadata')
      expect(response.length).toBeLessThan(4000)

      const status = reaData(await turn.invoke('binary_session')).result
      expect(status.open).toBe(false)
      expect(f.rows('mcpOperations')[0].error).toBeUndefined()
      console.info(
        JSON.stringify({
          tool: target.name,
          definitionResponseCharacters: response.length,
          packageVersion: status.server_identity.package.version,
          sessionOpen: status.open,
        }),
      )
    } finally {
      await f.close()
    }
  },
  60_000,
)
