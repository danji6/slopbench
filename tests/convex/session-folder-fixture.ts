import type { FolderTransitionArgs } from '@sb/convex/types'

export type Row = Record<string, unknown>

/** Indexed in-memory rows exercise transitions and derived authority together. */
export function setup() {
  const tables: Record<string, Row[]> = {
    users: [
      { _id: 'owner', subject: 'owner', role: 'admin' },
      { _id: 'member', subject: 'member', role: 'user' },
    ],
    sessionFolders: [
      {
        _id: 'c',
        ownerId: 'member',
        name: 'Personal',
        position: 0,
        revision: 0,
        sources: [],
      },
      {
        _id: 'a',
        ownerId: 'owner',
        name: 'A',
        position: 0,
        revision: 1,
        sources: [{ id: 'root', path: '/a', label: 'a' }],
      },
      {
        _id: 'b',
        ownerId: 'owner',
        name: 'B',
        position: 1,
        revision: 0,
        sources: [],
      },
    ],
    sessions: [
      { _id: 's', ownerId: 'owner', folderId: 'a' },
      { _id: 'child', ownerId: 'owner', parent: { sessionId: 's' } },
    ],
    userSessions: [
      {
        _id: 'own',
        sessionId: 's',
        userId: 'owner',
        role: 'owner',
        groupKey: 'a',
      },
      {
        _id: 'mem',
        sessionId: 's',
        userId: 'member',
        role: 'member',
        groupKey: 'ungrouped',
      },
    ],
    sessionState: [
      {
        _id: 'state',
        sessionId: 's',
        toolApprovals: { paths: ['/extra'], shell: ['git status'] },
        pathApprovalRevision: '["a",1,["/a"]]',
      },
    ],
    sessionCache: [
      {
        _id: 'cache',
        sessionId: 's',
        agentId: 'agent',
        items: [],
        tools: [{ name: 'old' }],
        workspaceRevision: '["a",1,["/a"]]',
      },
    ],
    messages: [
      { _id: 'msg', sessionId: 's', status: 'done', content: 'Preserve me' },
    ],
  }
  const row = (id: string) =>
    Object.values(tables)
      .flat()
      .find((item) => item._id === id)!
  const value = (item: Row, field: string) =>
    field
      .split('.')
      .reduce<unknown>((v, k) => (v as Row | undefined)?.[k], item)
  const db = {
    get: async (id: string) => structuredClone(row(id) ?? null),
    patch: async (id: string, patch: Row) => {
      Object.assign(row(id), patch)
    },
    delete: async (id: string) => {
      for (const key in tables)
        tables[key] = tables[key]!.filter((item) => item._id !== id)
    },
    insert: async (table: string, fields: Row) => {
      const id = `${table}-${tables[table]?.length ?? 0}`
      ;(tables[table] ??= []).push({ ...fields, _id: id })
      return id
    },
    query: (table: string) => {
      const equal: Array<[string, unknown]> = []
      const q = {
        eq: (field: string, expected: unknown) => {
          equal.push([field, expected])
          return q
        },
        field: (field: string) => field,
      }
      const result = {
        withIndex: (_name: string, fn?: (query: typeof q) => unknown) => {
          fn?.(q)
          return result
        },
        filter: (fn: (query: typeof q) => unknown) => {
          fn(q)
          return result
        },
        order: () => result,
        collect: async () =>
          (tables[table] ?? []).filter((item) =>
            equal.every(([field, expected]) => value(item, field) === expected),
          ),
        unique: async () => (await result.collect())[0] ?? null,
        first: async () => (await result.collect())[0] ?? null,
      }
      return result
    },
  }
  return {
    tables,
    row,
    ctx: { db, userId: 'owner', subject: 'owner', role: 'admin' } as never,
  }
}
export const args = (extra: Row = {}) =>
  ({
    subject: 'owner',
    token: `${Date.now() + 60000}:test`,
    ...extra,
  }) as FolderTransitionArgs
