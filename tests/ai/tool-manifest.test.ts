/// <reference types="bun-types" />
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { getEnabledTools } from '@sb/convex/model/tools'
import { describe, expect, test } from 'bun:test'

const session = {
  _id: 'session_1',
  workspace: { workspaceId: 'ws_1' },
  toolApprovals: undefined,
} as never

const mcpServer = {
  id: 'srv_1',
  label: 'Docs',
  url: 'https://mcp.example.com',
  transport: 'http',
  enabled: true,
  tools: [
    { name: 'search', description: 'Search the docs', inputSchema: '{}' },
  ],
}

const manifestFor = (over: Record<string, unknown> = {}) =>
  resolveToolManifest({
    agent: { tools: ['web_fetch', 'web_search', 'docs_search'] } as never,
    invoker: { role: 'admin' } as never,
    session,
    settings: null,
    spawnableAgents: [],
    ...over,
  } as never)

describe('tool manifest', () => {
  test('web_search needs a configured instance', () => {
    expect(manifestFor().names).not.toContain('web_search')

    const configured = manifestFor({
      settings: {
        webSearchInstances: [
          { engine: 'searxng', url: 'https://search.example.com' },
        ],
      },
    })
    expect(configured.names).toContain('web_search')
  })

  test('external MCP tools are captured with their wire metadata', () => {
    const manifest = manifestFor({ settings: { mcpServers: [mcpServer] } })

    expect(manifest.names).toContain('docs_search')
    expect(manifest.mcp).toEqual([
      {
        name: 'docs_search',
        serverId: 'srv_1',
        toolName: 'search',
        description: 'Search the docs',
        inputSchema: '{}',
      },
    ])
  })

  test('a disabled server drops out of the manifest', () => {
    const manifest = manifestFor({
      settings: { mcpServers: [{ ...mcpServer, enabled: false }] },
    })

    expect(manifest.names).not.toContain('docs_search')
    expect(manifest.mcp).toBeUndefined()
  })

  test('an external tool cannot shadow a built-in', () => {
    const shadowing = {
      ...mcpServer,
      label: '',
      tools: [{ name: 'read_file' }],
    }
    const manifest = resolveToolManifest({
      agent: { tools: ['read_file'] } as never,
      invoker: { role: 'admin' } as never,
      session,
      settings: { mcpServers: [shadowing] },
      spawnableAgents: [],
    } as never)

    expect(manifest.names).toEqual(['read_file'])
    expect(manifest.mcp).toBeUndefined()
  })

  test('workspace tools need an admin invoker and a bound workspace', () => {
    const tools = ['read_file', 'write_file', 'shell']

    expect(
      resolveToolManifest({
        agent: { tools } as never,
        invoker: { role: 'user' } as never,
        session,
        settings: null,
        spawnableAgents: [],
      } as never).names,
    ).toEqual([])

    expect(
      resolveToolManifest({
        agent: { tools } as never,
        invoker: { role: 'admin' } as never,
        session: { _id: 'session_1' } as never,
        settings: null,
        spawnableAgents: [],
      } as never).names,
    ).toEqual([])
  })

  test('a frozen manifest still builds when its MCP server is gone', async () => {
    const manifest = manifestFor({ settings: { mcpServers: [mcpServer] } })

    // Settings no longer list the server; the tool stays on the wire
    const tools = await getEnabledTools(manifest, session, null, {
      ctx: { runQuery: async () => null } as never,
    })

    expect(tools.docs_search).toBeDefined()
    expect(
      tools.docs_search.execute?.({ query: 'x' }, {} as never),
    ).rejects.toThrow('no longer configured')
  })
})
