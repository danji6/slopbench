import { ToolError, toolFailure } from '@sb/convex/errors'
import { TOOL_METAS } from '@sb/convex/model/tool/metas'
import { getMcpUrl } from '@sb/convex/model/tool/mcp'
import { describe, expect, test } from 'bun:test'

describe('MCP tool URL', () => {
  test('adds the MCP path to a sidecar base URL', () => {
    expect(getMcpUrl('http://localhost:3212')).toBe('http://localhost:3212/mcp')
  })

  test('normalizes a trailing slash before adding the MCP path', () => {
    expect(getMcpUrl('http://localhost:3212/')).toBe(
      'http://localhost:3212/mcp',
    )
  })

  test('keeps an explicit MCP endpoint unchanged', () => {
    expect(getMcpUrl('http://localhost:3212/mcp')).toBe(
      'http://localhost:3212/mcp',
    )
  })

  test('adds the MCP path below a nested sidecar base URL', () => {
    expect(getMcpUrl('https://example.com/sidecar')).toBe(
      'https://example.com/sidecar/mcp',
    )
  })
})

describe('tool failures', () => {
  test('throws a ToolError with the bare message, no prefix', () => {
    expect(() => toolFailure(new Error('command failed'))).toThrow(
      new ToolError('command failed'),
    )
  })

  test('preserves an already-typed ToolError', () => {
    const original = new ToolError('already typed')
    try {
      toolFailure(original)
    } catch (error) {
      expect(error).toBe(original)
    }
  })
})

describe('tool metadata', () => {
  test('exposes web_search as a general tool', () => {
    expect(TOOL_METAS).toContainEqual(
      expect.objectContaining({
        name: 'web_search',
        category: 'web',
      }),
    )
  })
})
