import { list } from '@sb/convex/model/session/sessionQueries'
import { expect, test } from 'bun:test'
import { type Row, makeCtx } from '~/tests/setup/query-rows'

function fixture() {
  const tables: Record<string, Row[]> = {
    sessionFolders: [
      { _id: 'project', ownerId: 'user_1', name: 'MyProject', position: 0 },
      {
        _id: 'design',
        ownerId: 'user_1',
        name: 'Design',
        parentId: 'project',
        position: 0,
      },
      { _id: 'other', ownerId: 'user_2', name: 'Secret', position: 0 },
    ],
    agents: [
      { _id: 'alice', name: 'Alice "The Architect"' },
      { _id: 'code', name: 'Code,Codebase Explorer' },
      { _id: 'bob', name: 'Bob' },
    ],
    settings: [
      { _id: 'me', ownerId: 'user_1', displayName: 'Jane' },
      { _id: 'them', ownerId: 'user_2', displayName: 'Alice Human' },
    ],
    sessions: [],
    userSessions: [],
    sessionAgents: [],
  }
  const queries: string[] = []
  const ctx = makeCtx(tables, queries)

  function add(
    id: string,
    agents: string[],
    folderId?: string,
    fields: Record<string, unknown> = {},
  ) {
    tables.sessions!.push({
      _id: id,
      ownerId: 'user_1',
      folderId,
      title: 'Bug fix',
      ...fields,
    })
    tables.userSessions!.push({
      _id: `member_${id}`,
      sessionId: id,
      userId: 'user_1',
      role: 'owner',
      folderId,
      groupKey: folderId ?? 'ungrouped',
      title: 'Bug fix',
      lastMessageAt: tables.sessions!.length,
    })
    for (const agentId of agents) {
      tables.sessionAgents!.push({
        _id: `${id}_${agentId}`,
        sessionId: id,
        agentId,
      })
    }
  }

  const search = (term: string, showHidden = false) =>
    list(ctx, {
      search: term,
      showHidden,
      paginationOpts: { numItems: 20, cursor: null },
    })
  return { tables, queries, ctx, add, search }
}

test('filter-only searches span every group in activity order', async () => {
  const f = fixture()
  f.add('root', ['alice'], 'project')
  f.add('child', ['alice'], 'design')
  f.add('unfiled', ['alice'])
  f.add('nonmatch', ['bob'], 'project')

  const result = await f.search('agent:ARCHITECT')
  expect(result.page.map((item) => String(item._id))).toEqual([
    'unfiled',
    'child',
    'root',
  ])
  expect(f.queries).toContain('userSessions:by_userId_hidden_lastMessageAt')
  expect(f.queries).not.toContain('userSessions:search_title')
})

test('combines title relevance with AND clauses and OR alternatives', async () => {
  const f = fixture()
  f.add('match', ['alice', 'code'], 'design')
  f.add('missing-agent', ['alice'], 'project')
  f.add('wrong-title', ['alice', 'code'], 'project', {
    _id: 'wrong-title',
    title: 'Elsewhere',
  })
  f.tables.userSessions!.at(-1)!.title = 'Elsewhere'

  const result = await f.search(
    'Bug agent:Missing,Alice agent:Explorer user:Jane folder:Project',
  )
  expect(result.page.map((item) => String(item._id))).toEqual(['match'])
  expect(f.queries).toContain('userSessions:search_title')
  expect(result.page[0]!.folderPath).toBe('MyProject / Design')
})

test('folder clauses use ancestor names and personal folders for shared sessions', async () => {
  const f = fixture()
  f.add('shared', ['alice'], 'other', { _id: 'shared', ownerId: 'user_2' })
  const personal = f.tables.userSessions![0]!
  personal.role = 'member'
  personal.folderId = 'design'
  personal.groupKey = 'design'

  expect(
    (await f.search('folder:Project folder:Design')).page.map((item) =>
      String(item._id),
    ),
  ).toEqual(['shared'])
  expect((await f.search('folder:Secret')).page).toEqual([])
})

test('matches current people by kind, including the viewer, but not historical senders', async () => {
  const f = fixture()
  f.add('session', ['alice'])
  expect((await f.search('user:Jane')).page).toHaveLength(1)
  expect((await f.search('user:Alice')).page).toHaveLength(0)
  expect((await f.search('agent:Jane')).page).toHaveLength(0)
  expect(
    (await f.search('participant:Jane participant:Alice')).page,
  ).toHaveLength(1)
  f.tables.messages = [
    { _id: 'old', sessionId: 'session', sender: { type: 'agent', id: 'bob' } },
  ]
  expect((await f.search('agent:Bob')).page).toHaveLength(0)
  f.tables.userSessions!.push({
    _id: 'join',
    sessionId: 'session',
    userId: 'user_2',
    role: 'member',
  })
  expect((await f.search('user:Alice')).page).toHaveLength(1)
})

test('reads renamed agents, users, folders, and changed memberships on subsequent queries', async () => {
  const f = fixture()
  f.add('session', ['alice'], 'design')
  expect(
    (await f.search('agent:Alice user:Jane folder:Project')).page,
  ).toHaveLength(1)
  f.tables.agents![0]!.name = 'Renamed'
  f.tables.settings![0]!.displayName = 'New User'
  f.tables.sessionFolders![0]!.name = 'New Folder'
  expect((await f.search('agent:Alice')).page).toHaveLength(0)
  expect((await f.search('user:Jane')).page).toHaveLength(0)
  expect((await f.search('folder:Project')).page).toHaveLength(0)
  expect(
    (await f.search('agent:Renamed user:"New User" folder:"New Folder"')).page,
  ).toHaveLength(1)
  f.tables.sessionAgents = []
  expect((await f.search('agent:Renamed')).page).toHaveLength(0)
  f.tables.sessions![0]!.folderId = undefined
  expect((await f.search('folder:"New Folder"')).page).toHaveLength(0)
})

test('keeps hidden-session controls, child exclusions, and viewer isolation', async () => {
  const f = fixture()
  f.add('visible', ['alice'])
  f.add('hidden', ['alice'])
  f.tables.userSessions!.at(-1)!.userHidden = true
  f.add('child', ['alice'], undefined, {
    _id: 'child',
    parent: { sessionId: 'visible' },
  })
  f.tables.userSessions!.at(-1)!.hidden = true
  f.add('outsider', ['alice'], undefined, {
    _id: 'outsider',
    ownerId: 'user_2',
  })
  f.tables.userSessions!.at(-1)!.userId = 'user_2'

  expect(
    (await f.search('agent:Alice')).page.map((item) => String(item._id)),
  ).toEqual(['visible'])
  expect(
    (await f.search('agent:Alice', true)).page.map((item) => String(item._id)),
  ).toEqual(['hidden', 'visible'])
})

test('preserves cursor metadata across empty pages and exhausts without gaps or duplicates', async () => {
  const f = fixture()
  f.add('old-match', ['alice'])
  for (let i = 0; i < 6; i++) f.add(`nonmatch-${i}`, ['bob'])
  f.add('new-match', ['alice'])
  let cursor: string | null = null
  const ids: string[] = []
  const lengths: number[] = []
  for (let i = 0; i < 4; i++) {
    const page = await list(f.ctx, {
      search: 'agent:Alice',
      paginationOpts: { numItems: 2, cursor },
    })
    ids.push(...page.page.map((item) => String(item._id)))
    lengths.push(page.page.length)
    expect(page.continueCursor).not.toBe(cursor)
    expect(page.isDone).toBe(i === 3)
    cursor = page.continueCursor
  }
  expect(lengths).toEqual([1, 0, 0, 1])
  expect(ids).toEqual(['new-match', 'old-match'])
})

test('tolerates empty filters and preserves unknown prefixes as title text', async () => {
  const f = fixture()
  f.add('first', ['alice'], 'design')
  f.add('second', ['bob'])
  expect(
    (await f.search('agent:')).page.map((item) => String(item._id)),
  ).toEqual(['second', 'first'])
  expect((await f.search('unknown:Alice')).page).toHaveLength(0)
  expect(
    (await f.search('agent:"Alice')).page.map((item) => String(item._id)),
  ).toEqual(['first'])
})
