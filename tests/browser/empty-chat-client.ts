import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

const flags = new URLSearchParams(location.search)
const agents = Array.from(
  { length: flags.has('emptyAgents') ? 0 : 30 },
  (_, index) => ({
    _id: `agent-${index}`,
    _creationTime: index,
    ownerId: 'owner',
    name:
      index === 1 && flags.has('longNames')
        ? 'VeryLongAgentName'.repeat(12)
        : `Agent ${index}`,
    description:
      index === 1 && flags.has('longDescriptions')
        ? `A VERY ${'LO'.repeat(120)}\nDescription ends here.`
        : index === 29
          ? 'Documentation specialist'
          : index % 2
            ? 'Helps you think through your work. '.repeat(
                flags.has('longNames') ? 8 : 1,
              )
            : undefined,
    tools: flags.has('noReadTools') ? [] : ['read_file'],
    lastSelectedAt: 30 - index,
  }),
)
let settings: Record<string, unknown> = {
  ...DEFAULT_SETTINGS,
  recentAgentId: flags.has('noAgent') ? undefined : 'agent-0',
  recentModel: 'fixture-model',
}
let providersAdded = !flags.has('noProviders')
let resolved = !flags.has('slowWelcome')
let agentDetailsResolved = !flags.has('deferAgentDetails')
let agentPromptsResolved = !flags.has('deferAgentPrompts')
let agentPageLimit = 4
const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
export const sentMessages: unknown[] = []

function update() {
  cache.clear()
  for (const listener of listeners) listener()
}

window.addEventListener('resolve-welcome', () => {
  resolved = true
  update()
})
window.addEventListener('resolve-agent-details', () => {
  agentDetailsResolved = true
  update()
})
window.addEventListener('resolve-agent-prompts', () => {
  agentPromptsResolved = true
  update()
})
window.addEventListener('add-provider', () => {
  providersAdded = true
  update()
})
window.addEventListener('remove-provider', () => {
  providersAdded = false
  update()
})
window.addEventListener('load-agent-page', () => {
  agentPageLimit += 12
  update()
})

function query(name: string, args: Record<string, unknown>): unknown {
  if (
    !resolved &&
    ['providers:list', 'settings:get', 'prompts:list'].includes(name)
  )
    return undefined
  if (name === 'settings:get') return settings
  if (name === 'users:getProfile') return { _id: 'owner', role: 'admin' }
  if (name === 'providers:list')
    return providersAdded ? [{ _id: 'provider', enabled: true }] : []
  if (name === 'models:list')
    return { models: [{ id: 'fixture-model', label: 'Fixture model' }] }
  if (name === 'agents:get') {
    if (!agentDetailsResolved && args.agentId === settings.recentAgentId)
      return undefined
    return agents.find((agent) => agent._id === args.agentId) ?? null
  }
  if (name === 'agents:list') return agents
  if (name === 'agents:page') {
    const { cursor, numItems } = args.paginationOpts as {
      cursor: string | null
      numItems: number
    }
    const term = String(args.search ?? '').toLowerCase()
    const matches = agents
      .filter((agent) =>
        `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(term),
      )
      .sort((a, b) => b.lastSelectedAt - a.lastSelectedAt)
    const start = Number(cursor ?? 0)
    if (flags.has('deferAgentPages') && start >= agentPageLimit)
      return undefined
    return {
      page: matches.slice(start, start + numItems),
      continueCursor: String(start + numItems),
      isDone: start + numItems >= matches.length,
    }
  }
  if (name === 'prompts:list') {
    if (!agentPromptsResolved && args.scope === 'own') return undefined
    if (!flags.has('prompts') || args.scope !== 'own') return []
    return [
      {
        _id: 'prompt',
        item: {
          id: 'intro',
          name: 'Intro',
          role: 'assistant',
          visible: true,
          starter: true,
          content: 'I am your configured welcome prompt.',
        },
      },
    ]
  }
  if (name === 'sessionFolders:get')
    return {
      _id: args.folderId,
      ownerId: 'owner',
      name: 'Slopbench',
      icon: flags.get('folderIcon') ?? undefined,
      sources: [],
      revision: 0,
      workspace: flags.has('organizationOnly')
        ? undefined
        : { path: '/project', workspaceId: args.folderId, revision: 0 },
    }
  if (args.paginationOpts) return { page: [], isDone: true, continueCursor: '' }
  if (name === 'tools:list') return [{ name: 'shell' }, { name: 'read_file' }]
  if (name === 'skills:getHome') return null
  if (name === 'avatars:thumbnail') return null
  return []
}

const client = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    const key = `${name}:${JSON.stringify(args)}`
    return {
      onUpdate(callback: () => void) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      localQueryResult() {
        if (!cache.has(key)) cache.set(key, query(name, args))
        return cache.get(key)
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation(
    reference: FunctionReference<'mutation'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    if (name === 'agents:select') {
      if (flags.has('failSelection')) throw new Error('Selection failed')
      const agent = agents.find((entry) => entry._id === args.agentId)
      if (agent) agent.lastSelectedAt = Date.now()
      if (agent && flags.has('deferSelection')) {
        update()
        await new Promise<void>((resolve) => {
          window.addEventListener('complete-selection', () => resolve(), {
            once: true,
          })
        })
      }
      settings = { ...settings, recentAgentId: args.agentId ?? undefined }
    }
    if (name === 'settings:update')
      settings = { ...settings, ...(args.patch as object) }
    update()
  },
  async action(
    reference: FunctionReference<'action'>,
    args: Record<string, unknown>,
  ) {
    sentMessages.push({ name: getFunctionName(reference), args })
    return { sessionId: 'created-session' }
  },
}

export const emptyChatClient = client as unknown as ConvexReactClient
