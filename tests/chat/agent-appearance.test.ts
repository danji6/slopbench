/// <reference types="bun-types" />
import type { Id } from '@sb/convex/_generated/dataModel'
import { get } from '@sb/convex/model/appearances'
import type { ThemeSnapshot } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }
const agentId = 'agent_1' as Id<'agents'>
const sessionId = 'session_1' as Id<'sessions'>
const theme = (source: string): ThemeSnapshot => ({
  source,
  light: {},
  dark: {},
})

function makeCtx(ownerId = 'user_1') {
  const agent = {
    _id: agentId,
    ownerId,
    customCss: '.a {}',
    theme: theme('#123456'),
  }
  const settings = { _id: 'settings_1', ownerId, theme: theme('#654321') }
  const tables: Record<string, Row[]> = {
    agents: [agent],
    settings: [settings],
    sessions: [{ _id: sessionId }],
    userSessions: [],
    sessionAgents: [],
    messages: [],
  }
  const ctx = {
    userId: 'user_1',
    db: {
      get: async (id: string) =>
        Object.values(tables)
          .flat()
          .find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          const fields: Record<string, unknown> = {}
          const q = {
            eq: (key: string, value: unknown) => {
              fields[key] = value
              return q
            },
          }
          build(q)
          const rows = tables[table].filter((row) =>
            Object.entries(fields).every(([key, value]) => {
              const actual = key
                .split('.')
                .reduce<unknown>(
                  (entry, part) => (entry as Record<string, unknown>)?.[part],
                  row,
                )
              return actual === value
            }),
          )
          return {
            unique: async () => rows[0] ?? null,
            first: async () => rows[0] ?? null,
          }
        },
      }),
    },
  } as never
  function join() {
    tables.userSessions.push({ _id: 'member_1', sessionId, userId: 'user_1' })
  }
  return { ctx, tables, agent, settings, join }
}

describe('live agent appearance', () => {
  test('reads changes immediately and inherits the current owner palette', async () => {
    const { ctx, agent, settings } = makeCtx()
    expect(await get(ctx, { agentId })).toMatchObject({
      customCss: '.a {}',
      theme: agent.theme,
    })
    agent.customCss = '.b {}'
    agent.theme = theme('#abcdef')
    expect(await get(ctx, { agentId })).toMatchObject({
      customCss: '.b {}',
      theme: agent.theme,
    })
    delete (agent as Partial<typeof agent>).theme
    expect((await get(ctx, { agentId }))?.theme).toEqual(settings.theme)
    settings.theme = theme('#fedcba')
    expect((await get(ctx, { agentId }))?.theme).toEqual(settings.theme)
  })

  test('keeps distinct senders independent and returns only appearance fields', async () => {
    const { ctx, tables } = makeCtx()
    const otherId = 'agent_2' as Id<'agents'>
    tables.agents.push({
      _id: otherId,
      ownerId: 'user_1',
      customCss: '.other {}',
      codeBlockHighlighting: false,
      codeBlockLineNumbers: false,
      prompts: ['private'],
    })
    expect((await get(ctx, { agentId }))?.customCss).toBe('.a {}')
    const other = await get(ctx, { agentId: otherId })
    expect(other).toMatchObject({
      customCss: '.other {}',
      codeBlockHighlighting: false,
      codeBlockLineNumbers: false,
    })
    expect(other).not.toHaveProperty('prompts')
    expect(other).not.toHaveProperty('ownerId')
  })

  test('session members can read a linked sender or an unlinked historical sender', async () => {
    const { ctx, tables, join } = makeCtx('other_user')
    join()
    expect(await get(ctx, { agentId, sessionId })).toBeNull()
    tables.sessionAgents.push({ _id: 'link', sessionId, agentId })
    expect(await get(ctx, { agentId, sessionId })).not.toBeNull()
    tables.sessionAgents.length = 0
    tables.messages.push({
      _id: 'message',
      sessionId,
      sender: { type: 'agent', id: agentId },
    })
    expect(await get(ctx, { agentId, sessionId })).not.toBeNull()
  })

  test('rejects outsiders even with a linked or historical sender', async () => {
    const { ctx, tables } = makeCtx('other_user')
    tables.sessionAgents.push({ _id: 'link', sessionId, agentId })
    tables.messages.push({
      _id: 'message',
      sessionId,
      sender: { type: 'agent', id: agentId },
    })
    expect(await get(ctx, { agentId, sessionId })).toBeNull()
    expect(await get(ctx, { agentId })).toBeNull()
  })

  test('history in a different session grants no access; deleted senders have no style', async () => {
    const { ctx, tables, join } = makeCtx('other_user')
    join()
    tables.messages.push({
      _id: 'message',
      sessionId: 'session_2',
      sender: { type: 'agent', id: agentId },
    })
    expect(await get(ctx, { agentId, sessionId })).toBeNull()
    tables.agents.length = 0
    expect(await get(ctx, { agentId, sessionId })).toBeNull()
  })
})
