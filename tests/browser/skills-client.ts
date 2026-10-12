import type { ConvexReactClient } from 'convex/react'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const library = Array.from({ length: 25 }, (_, index) => ({
  _id: `skill-${index}`,
  name: `skill-${String(index).padStart(2, '0')}`,
  description: `Workflow ${index}`,
  status: 'ready',
}))
let assigned = [
  { _id: 'assignment', name: 'skill-00', description: 'Workflow 0' },
]
let home: { path?: string; customPath?: string } = {}
let lastOperation: Record<string, unknown> = {}
let operations = 0

function update() {
  cache.clear()
  for (const listener of listeners) listener()
}

function page<T>(
  rows: T[],
  options: { cursor: string | null; numItems: number },
) {
  const start = Number(options.cursor ?? 0)
  return {
    page: rows.slice(start, start + options.numItems),
    continueCursor: String(start + options.numItems),
    isDone: start + options.numItems >= rows.length,
  }
}

function query(name: string, args: Record<string, unknown>) {
  if (name === 'users:getProfile') {
    return { _id: 'fixture-owner', role: 'admin' }
  }
  if (name === 'skills:getHome') {
    return home
  }
  if (name === 'skills:operation') {
    return { status: 'done' }
  }
  if (name === 'skills:list') {
    return page(
      library.filter((skill) =>
        skill.name.startsWith(String(args.search ?? '')),
      ),
      args.paginationOpts as Parameters<typeof page>[1],
    )
  }
  if (name === 'skills:assigned') {
    return page(assigned, args.paginationOpts as Parameters<typeof page>[1])
  }
  if (name === 'tools:list') {
    return []
  }
  if (name === 'settings:get') {
    return null
  }
  return undefined
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
        if (!cache.has(key)) {
          cache.set(key, query(name, args))
        }
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
    if (name !== 'skills:start') {
      throw new Error(`Unsupported fixture mutation: ${name}`)
    }
    lastOperation = args
    if (args.kind === 'ensure') {
      home = { path: '/fixture/managed-home' }
    }
    if (args.kind === 'home') {
      home = {
        path: String(args.destination ?? '/fixture/managed-home'),
        customPath: args.destination as string | undefined,
      }
    }
    if (args.kind === 'delete-assigned') {
      assigned = []
    }
    if (args.kind === 'assign') {
      const skill = library.find((entry) => entry._id === args.skillId)!
      assigned = [
        { _id: 'assignment', name: skill.name, description: skill.description },
      ]
    }
    update()
    return `operation-${++operations}`
  },
  async action(reference: FunctionReference<'action'>) {
    if (getFunctionName(reference) === 'actions/workspaces:listDirectories') {
      return { path: '/fixture/custom-home', entries: [] }
    }
    throw new Error('Unsupported fixture action')
  },
}

export const skillsFixtureClient = client as unknown as ConvexReactClient
export const latestSkillOperation = () => lastOperation
