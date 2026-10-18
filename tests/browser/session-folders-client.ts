import { matchesSessionSearch } from '@sb/core/session-search/filters'
import { parseSessionSearch } from '@sb/core/session-search/parse'
import type { SessionParticipant } from '@sb/core/types/sessions'
import { folderTrail, projectFolderMove } from '@sb/core/utils/folder-tree'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

type FixtureFolder = {
  _id: string
  name: string
  parentId?: string
  pinned?: boolean
  position: number
  organizationRevision?: number
}

type FixtureSession = {
  _id: string
  title: string
  folderId: string
  pinned: boolean
  hidden?: boolean
}

const searchFixtures = new URLSearchParams(location.search).has(
  'searchFixtures',
)

let folders: FixtureFolder[] = [
  { _id: 'a', name: 'Portfolio', position: 0 },
  { _id: 'n', name: 'Design', parentId: 'a', position: 0 },
  { _id: 'b', name: 'SlopBench', position: 1 },
]
let sessions: FixtureSession[] = [
  { _id: 's1', title: 'Portfolio chat', folderId: 'a', pinned: false },
  { _id: 's2', title: 'Design chat', folderId: 'n', pinned: false },
  { _id: 's3', title: 'SlopBench chat', folderId: 'b', pinned: false },
]
if (searchFixtures) {
  sessions.push({
    _id: 'hidden',
    title: 'Hidden chat',
    folderId: '',
    pinned: false,
    hidden: true,
  })
}
if (new URLSearchParams(location.search).has('longTitle')) {
  sessions[0].title =
    'Portfolio chat with a title that scrolls across the session row '
      .repeat(4)
      .trim()
}
if (new URLSearchParams(location.search).has('manySessions')) {
  sessions = [
    ...sessions,
    ...['a', 'n', 'b', ''].flatMap((folderId) =>
      Array.from({ length: 125 }, (_, index) => ({
        _id: `extra-${folderId}-${index}`,
        title: `${folderId || 'Unfiled'} session ${index + 1}`,
        folderId,
        pinned: false,
      })),
    ),
    ...Array.from({ length: 30 }, (_, index) => ({
      _id: `pin-${index}`,
      title: `Pinned session ${index + 1}`,
      folderId: '',
      pinned: true,
    })),
  ]
}

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const pendingSessionQueries = new Map<string, () => void>()
export const slowSessions = new URLSearchParams(location.search).has('slowSessions') // prettier-ignore

/** Releases held responses so loading assertions do not depend on timing. */
export function resolveSessionQueries() {
  for (const resolve of pendingSessionQueries.values()) resolve()
  pendingSessionQueries.clear()
  for (const listener of listeners) listener()
}

function update() {
  cache.clear()
  for (const listener of listeners) listener()
}

function folderViews() {
  return folders.map((folder) => {
    const trail = folderTrail(folders, folder._id)
    return {
      ...folder,
      _creationTime: 0,
      ownerId: 'fixture-owner',
      sources: [],
      revision: 0,
      ancestorIds: trail.slice(0, -1).map((entry) => entry._id),
      folderPath: trail.map((entry) => entry.name).join(' / '),
    }
  })
}

function participants(session: FixtureSession): SessionParticipant[] {
  if (!searchFixtures) return []
  const agentNames: Record<string, string> = {
    s1: 'Alice "The Architect"',
    s2: 'Codebase Explorer',
    s3: 'Code,Codebase Explorer',
    hidden: 'Hidden Agent',
  }
  const extraIndex = Number(session._id.match(/^extra-.*-(\d+)$/)?.[1] ?? -1)
  const name =
    agentNames[session._id] ??
    (extraIndex >= 0 && extraIndex % 10 === 0 ? 'Rare Agent' : 'Ordinary Agent')
  return [
    { id: 'viewer', kind: 'user', name: 'Jane' },
    { id: `agent-${session._id}`, kind: 'agent', name },
  ]
}

function sessionPage(args: Record<string, unknown>) {
  const raw = String(args.search ?? '')
  const search = parseSessionSearch(raw)
  const candidates = sessions.filter((session) => {
    if (session.hidden && !args.showHidden) return false
    if (search.text)
      return session.title.toLowerCase().includes(search.text.toLowerCase())
    if (raw.trim()) return true
    return (
      (session.pinned ? 'pinned' : session.folderId || 'ungrouped') ===
      args.groupKey
    )
  })
  const { cursor, numItems } = args.paginationOpts as {
    cursor: string | null
    numItems: number
  }
  const start = Number(cursor ?? 0)
  const page = candidates.slice(start, start + numItems).filter((session) =>
    matchesSessionSearch(search.clauses, {
      folderNames: session.folderId
        ? folderTrail(folders, session.folderId).map((f) => f.name)
        : [],
      participants: participants(session),
    }),
  )
  return {
    page: page.map((session) => {
      const folder = folderViews().find(
        (entry) => entry._id === session.folderId,
      )
      return {
        ...session,
        _creationTime: 0,
        owned: true,
        participants: participants(session),
        folderName: folder?.name,
        folderPath: folder?.folderPath,
      }
    }),
    continueCursor: String(start + numItems),
    isDone: start + numItems >= candidates.length,
  }
}

function query(name: string, args: Record<string, unknown>) {
  if (name === 'users:getProfile')
    return { _id: 'fixture-owner', role: 'admin' }
  if (name === 'sessionFolders:list') return folderViews()
  if (name === 'notifications:list' || name === 'streams:activeSessionIds')
    return []
  if (name !== 'sessions:list') return null
  return sessionPage(args)
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
          if (slowSessions && name === 'sessions:list') {
            cache.set(key, undefined)
            pendingSessionQueries.set(key, () =>
              cache.set(key, query(name, args)),
            )
          } else {
            cache.set(key, query(name, args))
          }
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
    if (name === 'sessionFolders:pinFolder') {
      folders = folders.map((folder) =>
        folder._id === args.folderId
          ? { ...folder, pinned: Boolean(args.pinned) }
          : folder,
      )
    } else if (name === 'sessionFolders:pin') {
      sessions = sessions.map((session) =>
        session._id === args.sessionId
          ? { ...session, pinned: Boolean(args.pinned) }
          : session,
      )
    } else if (!name.startsWith('notifications:')) {
      throw new Error(`Unsupported fixture mutation: ${name}`)
    }
    update()
  },
  async action(
    reference: FunctionReference<'action'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    if (name === 'actions/folders:change') {
      const command = args.command as Record<string, unknown>
      if (command.kind !== 'move-session')
        throw new Error('Unsupported fixture command')
      sessions = sessions.map((session) =>
        session._id === command.sessionId
          ? {
              ...session,
              folderId: String(command.folderId ?? ''),
              pinned: command.unpin ? false : session.pinned,
            }
          : session,
      )
      update()
      return
    }
    if (name !== 'actions/folders:move')
      throw new Error(`Unsupported fixture action: ${name}`)
    const input = args as {
      folderId: string
      parentId: string | null
      beforeFolderId?: string
    }
    folders = projectFolderMove(folders, input)
    const moving = folders.find((folder) => folder._id === input.folderId)!
    moving.organizationRevision = (moving.organizationRevision ?? 0) + 1
    update()
    return moving.organizationRevision
  },
}

export const sessionFoldersFixtureClient =
  client as unknown as ConvexReactClient
