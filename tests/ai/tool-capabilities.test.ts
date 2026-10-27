import { createOperationPlan } from '@sb/convex/actions/stream/operations'
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import type { ManifestInput } from '@sb/convex/model/tool/manifest'
import {
  BUILTIN_TOOL_NAMES,
  TOOL_CAPABILITIES,
  normalizeToolSelection,
} from '@sb/core/tool-capabilities'
import {
  canReplayToolContext,
  contextDependencies,
  contextEnabled,
} from '@sb/core/tool-context'
import { expect, test } from 'bun:test'

const server = {
  id: 'local',
  recordId: 'server',
  label: 'Kit',
  transport: 'stdio',
  command: 'fixture',
  url: '',
  enabled: true,
  integrationId: 'integration',
  brokerEnabled: true,
  catalogId: 'catalog',
  tools: [{ name: 'work', inputSchema: '{"type":"object"}' }],
}
function input(
  tools: string[],
  extra: Partial<ManifestInput> = {},
): ManifestInput {
  return {
    agent: { tools },
    invoker: { role: 'admin' },
    session: { workspace: { workspaceId: 'workspace' } },
    resources: {
      mcpServers: [server],
      settings: {
        webSearchInstances: [
          { engine: 'searxng', url: 'https://search.example' },
        ],
      },
    },
    spawnableAgents: [{ name: 'Research' }],
    availability: {
      skills: true,
      integrationSkills: true,
      storedMcpOutput: true,
    },
    ...extra,
  } as ManifestInput
}

test('every built-in is uniquely registered and its factory builds the selected capability', async () => {
  expect(BUILTIN_TOOL_NAMES).toHaveLength(23)
  expect(new Set(BUILTIN_TOOL_NAMES).size).toBe(23)
  for (const capability of TOOL_CAPABILITIES) {
    const manifest = resolveToolManifest(input([capability.name]))
    expect(manifest.names).toEqual([...capability.tools])
    const tools = await getEnabledTools(
      manifest,
      { _id: 'session', workspace: { workspaceId: 'workspace' } } as never,
      null,
      {
        ctx: {} as never,
        agentId: 'agent' as never,
        messageId: 'message' as never,
        execution: { streamId: 'stream' as never, generation: 1 },
      },
    )
    expect(Object.keys(tools)).toEqual([...capability.tools])
  }
})

test('configured resources never grant unselected built-ins or delegation context', () => {
  const manifest = resolveToolManifest(input([]))
  expect(manifest.names).toEqual([])
  expect(manifest.taskRoster).toBeUndefined()
  expect(resolveToolManifest(input(['write_file', 'edit_file'])).names).toEqual(
    [],
  )
  expect(
    normalizeToolSelection([
      'write_file',
      'edit_file',
      'shell_output',
      'plan',
      'todo',
      'shell',
      'other_work',
    ]),
  ).toEqual(['plan', 'todo', 'shell', 'other_work'])
})

test('selected MCP access distinguishes missing, undiscovered, empty, and stored-output-only resources', () => {
  const manifest = (mcpServers: unknown[], availability = {}) =>
    resolveToolManifest(
      input(['mcp_access'], {
        resources: { settings: null, mcpServers } as never,
        availability,
      }),
    ).names
  expect(manifest([])).toEqual([])
  expect(manifest([server])).toEqual([
    'search_mcp_tools',
    'call_mcp_tool',
    'mcp_protocol',
    'read_mcp_output',
  ])
  expect(manifest([{ ...server, tools: [], catalogCount: 0 }])).toEqual([
    'search_mcp_tools',
    'mcp_protocol',
    'read_mcp_output',
  ])
  expect(
    manifest([{ ...server, tools: undefined, catalogId: undefined }]),
  ).toContain('call_mcp_tool')
  expect(manifest([{ ...server, enabled: false }])).toEqual([])
  expect(manifest([{ ...server, integrationId: undefined }])).toEqual([])
  expect(manifest([], { storedMcpOutput: true })).toEqual(['read_mcp_output'])
})

test('skills require real valid entries and integration readers require the integration origin', () => {
  expect(
    resolveToolManifest(input(['skills'], { availability: {} })).names,
  ).toEqual([])
  expect(
    resolveToolManifest(input(['skills'], { availability: { skills: true } }))
      .names,
  ).toEqual(['list_skills'])
  expect(resolveToolManifest(input(['skills'])).names).toEqual([
    'list_skills',
    'read_skill',
  ])
  expect(
    resolveToolManifest(
      input(['skills'], { invoker: { role: 'user' } as never }),
    ).names,
  ).toEqual([])
})

test('explicit direct tools remain independent and cannot shadow capability keys or disabled built-ins', () => {
  const direct = {
    ...server,
    integrationId: undefined,
    brokerEnabled: false,
    label: 'Docs',
  }
  expect(
    resolveToolManifest(
      input(['docs_work'], {
        resources: { settings: null, mcpServers: [direct] } as never,
      }),
    ).names,
  ).toEqual(['docs_work'])
  for (const name of [
    ...BUILTIN_TOOL_NAMES,
    ...TOOL_CAPABILITIES.map((row) => row.name),
  ]) {
    const collision = { ...direct, label: '', tools: [{ name }] }
    const manifest = resolveToolManifest(
      input([name], {
        resources: { settings: null, mcpServers: [collision] } as never,
      }),
    )
    expect(manifest.mcp).toBeUndefined()
  }
})

test('subagent and filesystem requirements narrow selected groups', () => {
  const tools = TOOL_CAPABILITIES.map((row) => row.name)
  const child = resolveToolManifest(
    input(tools, { session: { parent: {} } as never }),
  )
  for (const name of [
    'task',
    'ask',
    'enter_plan_mode',
    'exit_plan_mode',
    'read_file',
    'shell',
  ])
    expect(child.names).not.toContain(name)
  expect(child.names).toContain('write_plan')
  const user = resolveToolManifest(
    input(tools, { invoker: { role: 'user' } as never }),
  )
  for (const name of [
    'read_file',
    'write_file',
    'shell',
    'list_skills',
    'read_skill',
    'write_plan',
    'mcp_protocol',
  ])
    expect(user.names).not.toContain(name)
})

test('a cached manifest never acquires helpers or changes selections until reset', () => {
  const frozen = { version: 1, names: ['read_file'] }
  const data = {
    ...input(['shell', 'mcp_access', 'skills']),
    stream: { command: { kind: 'invoke' } },
    prompts: { own: [], library: [] },
    mcpServers: [],
    settings: null,
    sessionCache: { tools: frozen, items: [], historyPresentation: {} },
    agent: { tools: ['shell', 'mcp_access', 'skills'] },
  }
  const plan = createOperationPlan(data as never)
  expect(plan.toolNames).toBe(frozen.names)
  expect(
    plan.snapshotPatch({ items: [], environment: {}, dirty: false }),
  ).toBeNull()
  expect(
    createOperationPlan({ ...data, sessionCache: null } as never).toolNames,
  ).not.toContain('read_file')
})

test('context policy hides disabled, incompatible, foreign, and unstamped notes without suppressing evidence', () => {
  const note = {
    type: 'skills',
    sender: { id: 'agent' },
    extra: { capabilities: ['list_skills', 'read_skill'] },
  }
  expect(canReplayToolContext(note, [], 'agent', 7)).toBe(false)
  expect(canReplayToolContext(note, ['list_skills'], 'agent', 7)).toBe(false)
  expect(
    canReplayToolContext(note, ['list_skills', 'read_skill'], 'agent', 7),
  ).toBe(true)
  expect(
    canReplayToolContext(note, ['list_skills', 'read_skill'], 'other', 7),
  ).toBe(false)
  expect(
    canReplayToolContext(
      { ...note, extra: undefined },
      ['list_skills'],
      'agent',
      7,
    ),
  ).toBe(false)
  expect(
    canReplayToolContext({ ...note, type: undefined }, [], 'agent', 7),
  ).toBe(true)
  expect(canReplayToolContext(note, [], 'agent', 6)).toBe(true)
  expect(contextEnabled('workspace', ['read_skill'])).toBe(false)
  expect(contextEnabled('mcp', ['read_mcp_output'])).toBe(false)
  expect(contextEnabled('mcp', ['docs_work'])).toBe(true)
  expect(contextDependencies('mcp', ['read_file', 'docs_work'])).toEqual([
    'docs_work',
  ])
})
