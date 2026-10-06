/// <reference types="bun-types" />
import { list as listAgents } from '@sb/convex/model/agents'
import { list as listSessions } from '@sb/convex/model/session/sessions'
import { list as listMembers } from '@sb/convex/model/userSessions'
import { describe, expect, test } from 'bun:test'

const VIEWER = 'user_1'
const OTHER = 'user_2'
const SESSION = 'session_1'

type Row = Record<string, unknown> & { _id: string }
type Predicate = (row: Row) => boolean

/** Applies indexed constraints and visibility filters before slicing pages. */
function indexedRows(rows: Row[], build?: (q: unknown) => unknown) {
  const predicates: Predicate[] = []
  const q = {
    eq: (field: string, value: unknown) => {
      predicates.push((row) => row[field] === value)
      return q
    },
    search: (field: string, term: string) => {
      predicates.push((row) => String(row[field] ?? '').includes(term))
      return q
    },
  }
  build?.(q)
  const matches = () => rows.filter((row) => predicates.every((p) => p(row)))
  const result = {
    order: () => result,
    filter: (predicate: (q: unknown) => Predicate) => {
      predicates.push(
        predicate({
          field: (field: string) => field,
          neq: (field: string, value: unknown) => (row: Row) =>
            row[field] !== value,
        }),
      )
      return result
    },
    collect: async () => matches(),
    unique: async () => matches()[0] ?? null,
    paginate: async (options: { cursor: string | null; numItems: number }) => {
      const found = matches()
      const start = Number(options.cursor ?? 0)
      const end = Math.min(start + options.numItems, found.length)
      return {
        page: found.slice(start, end),
        isDone: end === found.length,
        continueCursor: String(end),
      }
    },
  }
  return result
}

/** Resolves indexed reads across tables without leaking full session documents. */
function makeCtx(tables: Record<string, Row[]>) {
  const find = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id)

  return {
    userId: VIEWER,
    db: {
      get: async (id: string) => find(id) ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, build?: (q: unknown) => unknown) =>
          indexedRows(tables[table] ?? [], build),
        withSearchIndex: (_index: string, build: (q: unknown) => unknown) =>
          indexedRows(tables[table] ?? [], build),
      }),
    },
  } as never
}

/** A settings document holding everything a member must never leak. */
const settingsFor = (ownerId: string, name: string): Row => ({
  _id: `settings_${ownerId}`,
  ownerId,
  displayName: name,
  avatarId: `avatars_${ownerId}`,
  recentModel: 'gpt-5',
  recentWorkspaces: ['/home/secret'],
  themeMode: 'dark',
})

describe('userSessions.list', () => {
  const ctx = makeCtx({
    sessions: [{ _id: SESSION, ownerId: VIEWER }],
    userSessions: [
      { _id: 'us_1', sessionId: SESSION, userId: VIEWER, role: 'owner' },
      { _id: 'us_2', sessionId: SESSION, userId: OTHER, role: 'member' },
    ],
    settings: [settingsFor(VIEWER, 'Me'), settingsFor(OTHER, 'Them')],
  })

  test('returns only the membership and the two display fields', async () => {
    const members = await listMembers(ctx, { sessionId: SESSION as never })

    expect(members).toHaveLength(2)
    for (const member of members) {
      expect(Object.keys(member).sort()).toEqual([
        'avatarId',
        'membership',
        'name',
      ])
    }
  })

  test("never ships another member's settings document", async () => {
    const members = await listMembers(ctx, { sessionId: SESSION as never })
    const other = members.find((m) => m.membership.userId === OTHER)

    expect(other?.name).toBe('Them')
    expect(other?.avatarId).toBe(`avatars_${OTHER}` as never)
    expect(JSON.stringify(other)).not.toContain('/home/secret')
  })

  test('is empty for a non-member', async () => {
    const outsider = makeCtx({
      sessions: [{ _id: SESSION, ownerId: OTHER }],
      userSessions: [
        { _id: 'us_2', sessionId: SESSION, userId: OTHER, role: 'owner' },
      ],
      settings: [settingsFor(OTHER, 'Them')],
    })

    expect(
      await listMembers(outsider, { sessionId: SESSION as never }),
    ).toEqual([])
  })
})

describe('sessions.list', () => {
  function searchableCtx(visibleCount: number) {
    const sessions: Row[] = []
    const memberships: Row[] = []
    for (const [kind, count] of [
      ['child', 10],
      ['hidden', 10],
      ['visible', visibleCount],
    ] as const) {
      // prettier-ignore
      for (let index = 0; index < count; index++) {
        const id = `${kind}_${index}`
        sessions.push({
          _id: id,
          ownerId: VIEWER,
          title: 'Matching chat',
          parent: kind === 'child' ? { sessionId: SESSION } : undefined,
        })
        memberships.push({
          _id: `member_${id}`,
          sessionId: id,
          userId: VIEWER,
          title: 'Matching chat',
          groupKey: 'ungrouped',
          hidden: kind === 'child' || undefined,
          userHidden: kind === 'hidden' || undefined,
        })
      }
    }
    return makeCtx({ sessions, userSessions: memberships })
  }

  test('search exhausts short result sets without hidden rows consuming page slots', async () => {
    const result = await listSessions(searchableCtx(3), {
      search: 'Matching',
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(result.page.map((row) => row._id)).toEqual([
      'visible_0',
      'visible_1',
      'visible_2',
    ] as never)
    expect(result.isDone).toBe(true)
  })

  test('search fills visible pages and continues without gaps or duplicates', async () => {
    const ctx = searchableCtx(21)
    const first = await listSessions(ctx, {
      search: 'Matching',
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(first.page).toHaveLength(20)
    expect(first.isDone).toBe(false)
    const next = await listSessions(ctx, {
      search: 'Matching',
      paginationOpts: { numItems: 20, cursor: first.continueCursor },
    })
    expect(next.page.map((row) => row._id)).toEqual(['visible_20'] as never)
    expect(next.isDone).toBe(true)
    expect(
      new Set([...first.page, ...next.page].map((row) => row._id)).size,
    ).toBe(21)
  })

  test('show hidden includes personal hidden chats while still excluding sub-agents', async () => {
    const result = await listSessions(searchableCtx(3), {
      search: 'Matching',
      showHidden: true,
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(result.page).toHaveLength(13)
    expect(result.page.filter((row) => row.hidden)).toHaveLength(10)
    expect(result.isDone).toBe(true)
  })

  test('folder pages fill five visible slots and Load more adds twenty', async () => {
    const ctx = searchableCtx(25)
    const first = await listSessions(ctx, {
      paginationOpts: { numItems: 5, cursor: null },
    })
    expect(first.page).toHaveLength(5)
    expect(first.isDone).toBe(false)
    const next = await listSessions(ctx, {
      paginationOpts: { numItems: 20, cursor: first.continueCursor },
    })
    expect(next.page).toHaveLength(20)
    expect(next.isDone).toBe(true)
    expect(
      new Set([...first.page, ...next.page].map((row) => row._id)).size,
    ).toBe(25)
  })

  test('projects the sidebar row without the session document', async () => {
    const ctx = makeCtx({
      sessions: [
        {
          _id: SESSION,
          _creationTime: 10,
          ownerId: VIEWER,
          title: 'Chat',
          activeAgentId: 'agents_1',
          lastMessageAt: 20,
          lastMessagePreview: 'hi',
          firstMessagePreview: 'hello',
          // None of these belong in a query every member subscribes to
          mode: 'plan',
          settings: { slowModeSeconds: 5 },
          model: { id: 'gpt-5' },
          workspace: { path: '/home/secret' },
        },
      ],
      userSessions: [
        {
          _id: 'us_1',
          groupKey: 'ungrouped',
          sessionId: SESSION,
          userId: VIEWER,
          role: 'owner',
          hidden: undefined,
        },
      ],
      settings: [settingsFor(VIEWER, 'Me')],
      sessionAgents: [{ _id: 'sa_1', sessionId: SESSION, agentId: 'agents_1' }],
      agents: [{ _id: 'agents_1', name: 'Ada', avatarId: 'avatars_a' }],
    })

    const { page } = await listSessions(ctx, {
      paginationOpts: { numItems: 10, cursor: null },
    })

    expect(page).toHaveLength(1)
    expect(Object.keys(page[0]).sort()).toEqual([
      '_creationTime',
      '_id',
      'activeAgentId',
      'firstMessagePreview',
      'folderIcon',
      'folderId',
      'folderName',
      'folderPath',
      'hidden',
      'lastMessageAt',
      'lastMessagePreview',
      'owned',
      'participants',
      'pinned',
      'title',
    ])
    expect(page[0].participants).toEqual([
      { id: VIEWER, kind: 'user', name: 'Me', avatarId: `avatars_${VIEWER}` },
      { id: 'agents_1', kind: 'agent', name: 'Ada', avatarId: 'avatars_a' },
    ] as never)
  })
})

describe('agents.list', () => {
  test('projects a row without prompts, tools or appearance', async () => {
    const ctx = makeCtx({
      agents: [
        {
          _id: 'agents_1',
          ownerId: VIEWER,
          name: 'Ada',
          description: 'Helper',
          avatarId: 'avatars_a',
          tools: ['shell'],
          customCss: 'body{}',
          theme: { source: '#fff' },
          subAgents: { mode: 'allow', ids: [] },
        },
        { _id: 'agents_2', ownerId: OTHER, name: 'Theirs' },
      ],
    })

    const agents = await listAgents(ctx)

    expect(agents).toEqual([
      {
        _id: 'agents_1' as never,
        name: 'Ada',
        description: 'Helper',
        avatarId: 'avatars_a' as never,
      },
    ])
  })
})
