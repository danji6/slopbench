/// <reference types="bun-types" />
import { list as listAgents } from '@sb/convex/model/agents'
import { list as listSessions } from '@sb/convex/model/session/sessions'
import { list as listMembers } from '@sb/convex/model/userSessions'
import { describe, expect, test } from 'bun:test'

const VIEWER = 'user_1'
const OTHER = 'user_2'
const SESSION = 'session_1'

type Row = Record<string, unknown> & { _id: string }

/**
 * A multi-table stub. Every read these queries perform goes through an index
 * whose prefix is made of equality fields, so matching on the captured `eq`
 * calls reproduces the real result set.
 */
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
        withIndex: (_index: string, build?: (q: unknown) => unknown) => {
          const captured: Record<string, unknown> = {}
          const q = {
            eq: (field: string, value: unknown) => {
              captured[field] = value
              return q
            },
          }
          build?.(q)

          const matches = (tables[table] ?? []).filter((row) =>
            Object.entries(captured).every(
              ([key, value]) => row[key] === value,
            ),
          )
          const result = {
            order: () => result,
            collect: async () => matches,
            unique: async () => matches[0] ?? null,
            paginate: async () => ({
              page: matches,
              isDone: true,
              continueCursor: '',
            }),
          }
          return result
        },
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
          turnCount: 7,
        },
      ],
      userSessions: [
        {
          _id: 'us_1',
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
      'hidden',
      'lastMessageAt',
      'lastMessagePreview',
      'participants',
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
          modelId: 'gpt-5',
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
