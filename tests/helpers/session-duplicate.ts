import type { Id } from '@sb/convex/_generated/dataModel'

export type Row = Record<string, unknown> & { _id: string }

export type Ctx = {
  userId: Id<'users'>
  db: Record<string, unknown>
  storage: { delete: (id: string) => Promise<void> }
}

/** Multi-table stub with insert/patch/delete, index reads and filter support. */
export function makeCtx() {
  const tables: Record<string, Row[]> = {
    sessions: [],
    sessionFolders: [],
    userSessions: [],
    sessionAgents: [],
    plans: [],
    sessionState: [],
    messages: [],
    messageContents: [],
    attachments: [],
    attachmentFiles: [],
    streams: [],
    agents: [],
    settings: [],
    modelProviders: [],
    credentials: [],
  }
  const deletedBlobs: string[] = []
  let nextId = 1

  const all = () => Object.values(tables).flat()

  const ctx = {
    userId: 'users_1',
    storage: {
      delete: async (id: string) => void deletedBlobs.push(id),
    },
    db: {
      get: async (id: string) => all().find((row) => row._id === id) ?? null,
      insert: async (table: string, doc: Row) => {
        const _id = `${table}_${nextId++}`
        tables[table].push({ ...doc, _id, _creationTime: nextId })
        return _id
      },
      patch: async (id: string, patch: Row) => {
        const row = all().find((entry) => entry._id === id)
        if (!row) throw new Error(`patch target missing: ${id}`)
        Object.assign(row, patch)
      },
      delete: async (id: string) => {
        const table = Object.entries(tables).find(([, rows]) =>
          rows.some((row) => row._id === id),
        )
        if (!table) return
        tables[table[0]] = table[1].filter((row) => row._id !== id)
      },
      query: (table: string) => {
        const fullTable = {
          collect: async () => [...tables[table]],
          filter: null,
        }
        return Object.assign(fullTable, {
          withIndex: (_index: string, build?: (q: unknown) => unknown) => {
            const captured: Record<string, unknown> = {}
            const eqQuery = {
              eq: (field: string, value: unknown) => {
                captured[field] = value
                return eqQuery
              },
            }
            build?.(eqQuery)
            const indexed = tables[table].filter((row) =>
              Object.entries(captured).every(([key, value]) =>
                // `undefined` eq matches absent fields, like real indexes
                value === undefined
                  ? row[key] === undefined
                  : row[key] === value,
              ),
            )

            const applyFilter = (fn: (q: unknown) => boolean) =>
              indexed.filter((row) =>
                fn({
                  field: (f: string) => row[f],
                  eq: (a: unknown, b: unknown) => a === b,
                  neq: (a: unknown, b: unknown) => a !== b,
                }),
              )
            const sortBySegment = (rows: Row[], direction: string) =>
              [...rows].sort((a, b) =>
                direction === 'desc'
                  ? (b.segmentIndex as number) - (a.segmentIndex as number)
                  : (a.segmentIndex as number) - (b.segmentIndex as number),
              )

            let rows = indexed
            let direction = 'asc'
            const builder = {
              filter: (fn: (q: unknown) => boolean) => {
                rows = applyFilter(fn)
                return builder
              },
              order: (dir: string) => {
                direction = dir
                return builder
              },
              collect: async () => sortBySegment(rows, direction),
              unique: async () => rows[0] ?? null,
              first: async () => sortBySegment(rows, direction)[0] ?? null,
            }
            return builder
          },
        })
      },
    },
  } as never as Ctx

  return { ctx, tables, deletedBlobs }
}

export const OWNER = 'users_1'

export const MEMBER = 'users_2'

export function seedSession(
  tables: Record<string, Row[]>,
  overrides: Record<string, unknown> = {},
): Row {
  const session = {
    ownerId: OWNER,
    title: 'Source',
    ...overrides,
    _id: 'session_1',
    _creationTime: 1,
  }
  tables.sessions.push(session)
  tables.userSessions.push({
    _id: 'us_source_owner',
    sessionId: session._id,
    userId: OWNER,
    role: 'owner',
  })
  return session
}

export function seedMembership(tables: Record<string, Row[]>, userId: string) {
  tables.userSessions.push({
    _id: `us_${userId}`,
    sessionId: 'session_1',
    userId,
    role: 'member',
  })
}

export let messageSeed = 0

export function seedMessage(
  tables: Record<string, Row[]>,
  overrides: Record<string, unknown> & { sessionId: string },
  parts: unknown[],
) {
  const messageId = `msg_${++messageSeed}`
  tables.messages.push({
    sender: { type: 'user', id: OWNER },
    role: 'user',
    status: 'done',
    selectedVersion: 1,
    versionCount: 1,
    ...overrides,
    _id: messageId,
  })
  tables.messageContents.push({
    _id: `${messageId}_c0`,
    messageId,
    sessionId: overrides.sessionId,
    version: 1,
    segmentIndex: 0,
    parts,
  })
  return messageId
}
