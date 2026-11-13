import type { ToolkitSettingsArgs } from '@cv/convex/types'
import { updateDisabledSkills } from '@cv/core/skills/names'
import type { OptimisticLocalStore, OptimisticUpdate } from 'convex/browser'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const linkedRoots = new Map<string, string>()
const bindingNames = new Set<string>()
const watched = new Map<
  string,
  { reference: FunctionReference<'query'>; args: Record<string, unknown> }
>()
type OptimisticSave = {
  args: ToolkitSettingsArgs
  update: OptimisticUpdate<ToolkitSettingsArgs>
}
type MutationOptions = {
  optimisticUpdate?: OptimisticUpdate<ToolkitSettingsArgs>
}
const optimisticSaves = new Set<OptimisticSave>()
const pendingSaves: (() => void)[] = []
let holdSaves = false
let nextFailure = ''
let selected = false
let status = 'ready'
let revision = 'a'.repeat(64)
const launches = 0
let changed = false
let skillEnabled = true
let disabledSkills: string[] = []
const manifest = JSON.stringify({
  schemaVersion: 1,
  name: 'Fixture Toolkit',
  description: 'Tools and skills for reviewing local evidence.',
  mcpServers: { analysis: { command: 'fixture', args: ['--stdio'] } },
})
const events: string[] = []
function update() {
  cache.clear()
  for (const save of optimisticSaves) save.update(optimisticStore, save.args)
  for (const listener of listeners) listener()
}
export function holdSkillSaves() {
  holdSaves = true
}
export function completeNextSkillSave() {
  pendingSaves.shift()?.()
}
export function changeManifest() {
  changed = true
}
export function observeManifestChanges() {
  if (!changed) return
  status = 'changed'
  update()
}
export function toolkitEvents() {
  return JSON.stringify({ events, launches })
}
export function failNextToolkitOperation() {
  nextFailure = 'Fixture operation failed.'
}
function checkFailure(name: string) {
  if (!name.includes('toolkits:') || !nextFailure) return
  const message = nextFailure
  nextFailure = ''
  throw new Error(message)
}
function query(name: string, args: Record<string, unknown>) {
  if (name === 'toolkits:bindings')
    return [
      {
        _id: `${args.toolkitId}:engine`,
        name: 'engine',
        transport: 'stdio',
        enabled: true,
        hasKey: false,
        secretEnvNames: [...bindingNames],
      },
    ]
  if (name === 'users:getProfile') return { _id: 'owner', role: 'admin' }
  if (name === 'toolkits:list')
    return [...linkedRoots].map(([toolkitId, root]) => ({
      _id: toolkitId,
      _creationTime: 0,
      ownerId: 'owner',
      root,
      name: root.endsWith('/long-toolkit')
        ? `Toolkit_${'long'.repeat(60)}`
        : toolkitId === 'toolkit'
          ? 'Fixture Toolkit'
          : 'Other Toolkit',
      revision,
      description: root.endsWith('/long-toolkit')
        ? 'A toolkit for inspecting local evidence. '.repeat(20) +
          'unbroken'.repeat(30)
        : toolkitId === 'toolkit'
          ? JSON.parse(manifest).description
          : undefined,
      manifest,
      skillsEnabled: skillEnabled,
      disabledSkills,
      status,
      selected,
      effective: status === 'ready' && selected,
      diagnostic:
        status === 'changed'
          ? 'Manifest changed. Refresh to apply the updated configuration.'
          : undefined,
      cleanupPending: 0,
    }))
  return null
}
function mutate(name: string, args: Record<string, unknown>) {
  events.push(name)
  checkFailure(name)
  if (name === 'toolkits:component') {
    for (const [name, value] of Object.entries(args.secretEnv ?? {})) {
      if (value) bindingNames.add(name)
      else bindingNames.delete(name)
    }
  }
  if (name === 'toolkits:select') {
    selected = Boolean(args.enabled)
  }
  if (name === 'toolkits:settings') {
    if (args.disabledSkills !== undefined)
      disabledSkills = args.disabledSkills as string[]
    if (args.skillsEnabled !== undefined) skillEnabled = !!args.skillsEnabled
    if (args.skill) {
      const skill = args.skill as { name: string; enabled: boolean }
      disabledSkills = updateDisabledSkills(
        disabledSkills,
        skill.name,
        skill.enabled,
      )
    }
  }
  if (name === 'toolkits:remove') {
    linkedRoots.delete(String(args.toolkitId))
  }
  update()
}

function cachedQuery(
  reference: FunctionReference<'query'>,
  args: Record<string, unknown>,
) {
  const name = getFunctionName(reference)
  const key = `${name}:${JSON.stringify(args)}`
  if (!cache.has(key)) cache.set(key, query(name, args))
  return cache.get(key)
}

const optimisticStore = {
  getQuery: cachedQuery,
  getAllQueries: (reference: FunctionReference<'query'>) =>
    [...watched.values()]
      .filter(
        (entry) =>
          getFunctionName(entry.reference) === getFunctionName(reference),
      )
      .map((entry) => ({
        args: entry.args,
        value: cachedQuery(entry.reference, entry.args),
      })),
  setQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
    value: unknown,
  ) {
    cache.set(`${getFunctionName(reference)}:${JSON.stringify(args)}`, value)
  },
} as unknown as OptimisticLocalStore

async function saveSettings(
  args: ToolkitSettingsArgs,
  options?: MutationOptions,
) {
  const failure = nextFailure
  nextFailure = ''
  const save = options?.optimisticUpdate
    ? { args, update: options.optimisticUpdate }
    : undefined
  if (save) optimisticSaves.add(save)
  update()
  try {
    if (holdSaves)
      await new Promise<void>((resolve) => pendingSaves.push(resolve))
    if (failure) throw new Error(failure)
    mutate('toolkits:settings', args)
  } finally {
    if (save) optimisticSaves.delete(save)
    update()
  }
}
const client = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    const key = `${name}:${JSON.stringify(args)}`
    watched.set(key, { reference, args })
    return {
      onUpdate(callback: () => void) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      localQueryResult() {
        return cachedQuery(reference, args)
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation(
    reference: FunctionReference<'mutation'>,
    args: Record<string, unknown>,
    options?: MutationOptions,
  ) {
    const name = getFunctionName(reference)
    if (name === 'toolkits:settings') {
      return saveSettings(args as ToolkitSettingsArgs, options)
    }
    return mutate(name, args)
  },
  async action(
    reference: FunctionReference<'action'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    events.push(name)
    checkFailure(name)
    if (name === 'actions/workspaces:listDirectories') {
      const path = String(args.path ?? '/fixture')
      return {
        path,
        parent: path === '/fixture' ? '/' : '/fixture',
        entries:
          path === '/fixture'
            ? [{ name: 'toolkit', path: '/fixture/toolkit' }]
            : [],
      }
    }
    if (name === 'actions/toolkits:skills')
      return {
        entries: [
          {
            name: 'review',
            description: 'Review evidence',
            path: 'toolkit://toolkit/skills/review/SKILL.md',
          },
        ],
        total: 1,
        fingerprint: 'skills',
        nextOffset: null,
      }
    if (name === 'actions/toolkits:link') {
      const root = String(args.root)
      const id = root === '/fixture/toolkit' ? 'toolkit' : 'other-toolkit'
      linkedRoots.set(id, root)
      update()
      return 'toolkit'
    }
    if (name === 'actions/toolkits:refresh') {
      const manifestChanged = changed
      if (changed) revision = 'b'.repeat(64)
      status = 'ready'
      changed = false
      update()
      return { toolkitId: args.toolkitId, changed: manifestChanged }
    }
    return null
  },
}
export const toolkitsClient = client as unknown as ConvexReactClient
