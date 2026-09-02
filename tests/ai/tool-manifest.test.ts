/// <reference types="bun-types" />
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
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

const manifestFor = (over: Record<string, unknown> = {}) => {
  const { settings = null, mcpServers = [], ...rest } = over
  return resolveToolManifest({
    agent: { tools: ['web_fetch', 'web_search', 'docs_search'] } as never,
    invoker: { role: 'admin' } as never,
    session,
    resources: { settings, mcpServers },
    spawnableAgents: [],
    ...rest,
  } as never)
}

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
    const manifest = manifestFor({ mcpServers: [mcpServer] })

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

  test('an MCP alias changes the provider name but keeps the wire name', () => {
    const aliased = {
      ...mcpServer,
      tools: [
        {
          name: 'search',
          nameOverride: 'find',
          description: 'Search the docs',
        },
      ],
    }
    const manifest = resolveToolManifest({
      agent: { tools: ['docs_find'] } as never,
      invoker: { role: 'admin' } as never,
      session,
      resources: { settings: null, mcpServers: [aliased] },
      spawnableAgents: [],
    } as never)

    expect(manifest.names).toContain('docs_find')
    expect(manifest.mcp?.[0]).toMatchObject({
      name: 'docs_find',
      toolName: 'search',
    })
  })

  test('a disabled server drops out of the manifest', () => {
    const manifest = manifestFor({
      mcpServers: [{ ...mcpServer, enabled: false }],
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
      resources: { settings: null, mcpServers: [shadowing] },
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
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
      } as never).names,
    ).toEqual([])

    expect(
      resolveToolManifest({
        agent: { tools } as never,
        invoker: { role: 'admin' } as never,
        session: { _id: 'session_1' } as never,
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
      } as never).names,
    ).toEqual([])
  })

  test('the shell is resolved agent-over-user, and only for the shell tool', () => {
    const shellFor = (over: Record<string, unknown>) =>
      resolveToolManifest({
        invoker: { role: 'admin' } as never,
        session,
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
        ...over,
        agent: { tools: ['shell'], ...(over.agent ?? {}) } as never,
      } as never).shell

    expect(shellFor({ defaultShell: '/bin/bash' })).toBe('/bin/bash')
    expect(shellFor({ settings: { shell: 'zsh' }, defaultShell: '/bin/bash' })).toBe('zsh') // prettier-ignore
    expect(
      shellFor({
        agent: { shell: 'pwsh' },
        settings: { shell: 'zsh' },
        defaultShell: '/bin/bash',
      }),
    ).toBe('pwsh')

    // Empty means "not set" in both forms, so it must not win over the default
    expect(shellFor({ settings: { shell: '' }, defaultShell: '/bin/bash' })).toBe('/bin/bash') // prettier-ignore

    // Nothing to describe when the agent cannot run commands at all
    expect(
      resolveToolManifest({
        agent: { tools: ['web_fetch'], shell: 'pwsh' } as never,
        invoker: { role: 'admin' } as never,
        session,
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
      } as never).shell,
    ).toBeUndefined()
  })

  test('the built shell tool names and runs the frozen shell', async () => {
    const manifest = resolveToolManifest({
      agent: { tools: ['shell'] } as never,
      invoker: { role: 'admin' } as never,
      session,
      resources: { settings: null, mcpServers: [] },
      spawnableAgents: [],
      defaultShell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', // prettier-ignore
    } as never)

    const tools = await getEnabledTools(manifest, session, null)

    expect(tools.shell.description).toContain('with PowerShell')
  })

  test('a frozen manifest still builds when its MCP server is gone', async () => {
    const manifest = manifestFor({ mcpServers: [mcpServer] })

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
