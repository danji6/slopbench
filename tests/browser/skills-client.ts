import type { ConvexReactClient } from 'convex/react'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const library = Array.from({ length: 85 }, (_, index) => ({
  _id: `skill-${index}`,
  name: `skill-${String(index).padStart(2, '0')}`,
  description:
    index < 2
      ? 'A deliberately long skill description explaining a detailed workflow and its supporting resources. '.repeat(
          12,
        )
      : `Workflow ${index}`,
  status: 'ready',
}))
let assigned = [{ ...library[0]!, _id: 'assignment-0' }]
let home = {
  homeId: 'fixture-home',
  managed: true,
  members: [{ id: 'fixture-agent', name: 'Fixture' }],
  path: undefined as string | undefined,
  operationId: undefined as string | undefined,
}
let homeExists = false
let lastOperation: Record<string, unknown> = {}
let sequence = 0
let failNext = false
let failVerification = false
const missingLibraryData = new Set(['skill-0', 'skill-84'])

export function failNextSkillCheck() {
  failVerification = true
}

export function restoreFixtureSkillData() {
  missingLibraryData.clear()
}
const operations = new Map<
  string,
  { status: string; updatedAt: number; error?: string }
>()

export function failNextSkillOperation() {
  failNext = true
}

export function setFixtureHome(managed: boolean) {
  home = {
    ...home,
    managed,
    path: managed ? '/fixture/managed-home' : '/fixture/custom-home',
  }
  homeExists = true
  update()
}

export function removeFixtureHome() {
  homeExists = false
  window.dispatchEvent(new Event('focus'))
}

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
  if (name === 'users:getProfile')
    return { _id: 'fixture-owner', role: 'admin' }
  if (name === 'skills:getHome') return home
  if (name === 'skills:operation')
    return operations.get(String(args.operationId))
  if (name === 'skills:list') {
    const skills = library
      .filter((skill) => {
        if (!skill.name.startsWith(String(args.search ?? ''))) return false
        const added = assigned.some((copy) => copy.name === skill.name)
        if (args.assignment === 'added') return added
        if (args.assignment === 'not-added') return !added
        return true
      })
      .map((skill) => ({
        ...skill,
        assignmentId: args.agentId
          ? (assigned.find((copy) => copy.name === skill.name)?._id ?? null)
          : null,
      }))
    return page(skills, args.paginationOpts as Parameters<typeof page>[1])
  }
  if (name === 'skills:assigned')
    return page(assigned, args.paginationOpts as Parameters<typeof page>[1])
  if (name === 'tools:list') return []
  if (name === 'settings:get') return null
  return undefined
}

function apply(args: Record<string, unknown>) {
  if (args.kind === 'ensure') {
    home = {
      ...home,
      path: '/fixture/managed-home',
      managed: true,
    }
    homeExists = true
  }
  if (args.kind === 'detach') {
    home = { ...home, path: undefined }
    assigned = []
    if (args.removeFolder) homeExists = false
  }
  if (args.kind === 'home') {
    homeExists = true
    home = {
      ...home,
      path: String(args.destination ?? '/fixture/managed-home'),
      managed: !args.destination,
    }
  }
  if (args.kind === 'delete-assigned')
    assigned = assigned.filter((item) => item._id !== args.assignmentId)
  if (args.kind === 'assign') {
    const skill = library.find((entry) => entry._id === args.skillId)!
    assigned = [...assigned, { ...skill, _id: `assignment-${skill._id}` }]
  }
}

function schedule(id: string, args: Record<string, unknown>) {
  const failure = failNext
  failNext = false
  operations.delete(id)
  setTimeout(() => {
    operations.set(id, { status: 'queued', updatedAt: Date.now() })
    home = { ...home, operationId: id }
    update()
  }, 350)
  setTimeout(() => {
    operations.set(id, { status: 'running', updatedAt: Date.now() })
    update()
  }, 600)
  setTimeout(() => {
    if (!failure) apply(args)
    operations.set(id, {
      status: failure ? 'failed' : 'done',
      updatedAt: Date.now(),
      error: failure
        ? 'Uncaught ConvexError: {"message":"Fixture operation failed","code":409} at handler (server.ts:1:1)'
        : undefined,
    })
    home = { ...home, operationId: undefined }
    update()
  }, 1_500)
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
    if (name === 'skills:retry') {
      schedule(String(args.operationId), lastOperation)
      update()
      return
    }
    if (name !== 'skills:start')
      throw new Error(`Unsupported fixture mutation: ${name}`)
    const operation = args.operation as Record<string, unknown>
    lastOperation = operation
    const id = `operation-${++sequence}`
    schedule(id, operation)
    await new Promise((resolve) => setTimeout(resolve, 150))
    return id
  },
  async action(
    reference: FunctionReference<'action'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    if (name === 'actions/skills:checkLibraryPage') {
      await new Promise((resolve) => setTimeout(resolve, 80))
      if (failVerification) {
        failVerification = false
        throw new Error('Sidecar unavailable')
      }
      const result = page(
        library,
        args.paginationOpts as Parameters<typeof page>[1],
      )
      return {
        ...result,
        checked: result.page.length,
        skipped: 0,
        missing: result.page
          .filter((skill) => missingLibraryData.has(skill._id))
          .map((skill) => ({ skillId: skill._id, name: skill.name })),
      }
    }
    if (name === 'actions/skills:removeMissingSkills') {
      const ids = new Set(args.skillIds as string[])
      const removed = library.filter(
        (skill) => ids.has(skill._id) && missingLibraryData.has(skill._id),
      )
      for (const skill of removed) {
        library.splice(library.indexOf(skill), 1)
        assigned = assigned.filter((copy) => copy.name !== skill.name)
      }
      update()
      return { removed: removed.length }
    }
    if (name === 'actions/skills:homeStatus') {
      await new Promise((resolve) => setTimeout(resolve, 400))
      return { exists: homeExists }
    }
    if (name === 'actions/skills:desktop')
      return { supported: false, machine: 'fixture' }
    if (name === 'actions/workspaces:listDirectories') {
      if (args.path === '/missing')
        throw new Error(
          "ENOENT: no such file or directory, realpath '/missing'",
        )
      const path = String(args.path ?? '/fixture/custom-home')
      return {
        path,
        parent: '/fixture',
        entries: [{ name: 'project', path: `${path}/project` }],
      }
    }
    throw new Error('Unsupported fixture action')
  },
}

export const skillsFixtureClient = client as unknown as ConvexReactClient
export const latestSkillOperation = () => lastOperation
