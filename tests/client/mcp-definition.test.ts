import { loadMcpDefinition } from '@/lib/chat/mcp-definition'
import { MAX_MCP_DEFINITION_BYTES } from '@sb/core/types/mcp-catalog'
import { expect, test } from 'bun:test'

function definitionUrl(value: unknown) {
  return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`
}

const original = {
  name: 'analyze',
  description: 'Full Unicode instructions: café 漢字.\n'.repeat(500),
  inputSchema: '{"type":"object"}',
  metadata: '{}',
}

test('loads original descriptions beyond catalog previews intact', async () => {
  const result = await loadMcpDefinition(
    definitionUrl(original),
    'analyze',
    new AbortController().signal,
  )
  expect(result).toEqual(original)
})

test('rejects another tool and malformed stored definitions', async () => {
  const signal = new AbortController().signal
  await expect(
    loadMcpDefinition(definitionUrl(original), 'other', signal),
  ).rejects.toThrow('does not match this tool')
  await expect(
    loadMcpDefinition(definitionUrl({ name: 'analyze' }), 'analyze', signal),
  ).rejects.toThrow('Invalid MCP tool definition')
})

test('rejects an oversized definition rather than using clipped JSON', async () => {
  const url = definitionUrl({
    ...original,
    description: 'x'.repeat(MAX_MCP_DEFINITION_BYTES),
  })
  await expect(
    loadMcpDefinition(url, 'analyze', new AbortController().signal),
  ).rejects.toThrow('too large')
})

test('honors cancellation before reading a definition', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    loadMcpDefinition(definitionUrl(original), 'analyze', controller.signal),
  ).rejects.toThrow()
})
