/// <reference types="bun-types" />
import { injectDueReminders } from '@sb/convex/model/chat/reminders'
import { _edit, _write, applyTodoEdits } from '@sb/convex/model/todos'
import { getEnabledTools } from '@sb/convex/model/tools'
import type { TodoItem } from '@sb/convex/types'
import { TODO_NUDGE_INTERVAL_TURNS, TODO_TOOL_TOGGLE } from '@sb/core/const'
import { describe, expect, test } from 'bun:test'

type CtxArgs = {
  agent?: Record<string, unknown> | null
  settings?: Record<string, unknown> | null
  session?: Record<string, unknown>
  todo?: Record<string, unknown> | null
}

function makeCtx({
  agent,
  settings = null,
  session,
  todo = null,
}: CtxArgs = {}) {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = []
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const deletes: string[] = []
  const scheduled: Array<Record<string, unknown>> = []

  const docs = new Map<string, unknown>()
  if (agent) docs.set(agent._id as string, agent)
  if (session) docs.set(session._id as string, session)

  const ctx = {
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      insert: async (table: string, doc: Record<string, unknown>) => {
        inserts.push({ table, doc })
        return `${table}_${inserts.length}`
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
      },
      delete: async (id: string) => {
        deletes.push(id)
      },
      query: (table: string) => ({
        withIndex: () => ({
          unique: async () => {
            if (table === 'settings') return settings
            if (table === 'todos') return todo
            return null
          },
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: unknown) => {
        scheduled.push(args as Record<string, unknown>)
        return 'job_1'
      },
    },
  } as never

  return { ctx, inserts, patches, deletes, scheduled }
}

function todos(...statuses: TodoItem['status'][]): TodoItem[] {
  return statuses.map((status, index) => ({
    content: `task ${index + 1}`,
    status,
  }))
}

const session = { _id: 'session_1', activeAgentId: 'agent_1', turnCount: 6 }
const agent = {
  _id: 'agent_1',
  name: 'Agent',
  ownerId: 'user_1',
  tools: [TODO_TOOL_TOGGLE],
}

describe('_write', () => {
  test('creates a pending row stamped with the session turn count', async () => {
    const { ctx, inserts } = makeCtx({ session })

    await _write(ctx, {
      sessionId: 'session_1' as never,
      todos: ['task 1', 'task 2'],
    })

    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('todos')
    expect(inserts[0].doc).toMatchObject({
      sessionId: 'session_1',
      items: todos('pending', 'pending'),
      turnCount: 6,
    })
    expect(inserts[0].doc.updatedAt).toBeNumber()
  })

  test('replaces the list, keeping statuses of matching tasks', async () => {
    const { ctx, inserts, patches } = makeCtx({
      session,
      todo: {
        _id: 'todo_1',
        items: todos('completed', 'in_progress'),
        turnCount: 2,
      },
    })

    await _write(ctx, {
      sessionId: 'session_1' as never,
      todos: ['task 2', 'task 3'],
    })

    expect(inserts).toEqual([])
    expect(patches).toHaveLength(1)
    expect(patches[0].id).toBe('todo_1')
    expect(patches[0].patch).toMatchObject({
      items: [
        { content: 'task 2', status: 'in_progress' },
        { content: 'task 3', status: 'pending' },
      ],
      turnCount: 6,
    })
  })

  test('an empty list deletes the row', async () => {
    const { ctx, deletes } = makeCtx({
      session,
      todo: { _id: 'todo_1', items: todos('pending'), turnCount: 2 },
    })

    await _write(ctx, { sessionId: 'session_1' as never, todos: [] })

    expect(deletes).toEqual(['todo_1'])
  })

  test('an empty list without a row is a no-op', async () => {
    const { ctx, inserts, patches, deletes } = makeCtx({ session })

    await _write(ctx, { sessionId: 'session_1' as never, todos: [] })

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
    expect(deletes).toEqual([])
  })
})

describe('_edit', () => {
  test('updates matched tasks and re-stamps the turn count', async () => {
    const { ctx, patches } = makeCtx({
      session,
      todo: {
        _id: 'todo_1',
        items: todos('in_progress', 'pending'),
        turnCount: 2,
      },
    })

    const result = await _edit(ctx, {
      sessionId: 'session_1' as never,
      edits: [
        { task: 'task 1', status: 'completed' },
        { task: 'task 2', status: 'in_progress' },
      ],
    })

    expect(result.ok).toBe(true)
    expect(patches).toHaveLength(1)
    expect(patches[0].patch).toMatchObject({
      items: todos('completed', 'in_progress'),
      turnCount: 6,
    })
  })

  test('a failed match returns the current list without writing', async () => {
    const { ctx, patches } = makeCtx({
      session,
      todo: { _id: 'todo_1', items: todos('pending'), turnCount: 2 },
    })

    const result = await _edit(ctx, {
      sessionId: 'session_1' as never,
      edits: [{ task: 'nope', status: 'completed' }],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('[ ] task 1')
    expect(patches).toEqual([])
  })

  test('errors when no list exists yet', async () => {
    const { ctx } = makeCtx({ session })

    const result = await _edit(ctx, {
      sessionId: 'session_1' as never,
      edits: [{ task: 'task 1', status: 'completed' }],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('write_todo')
  })

  test('rejects ambiguous task matches', () => {
    const items = [...todos('pending'), ...todos('pending')]

    expect(() =>
      applyTodoEdits(items, [{ task: 'task 1', status: 'completed' }]),
    ).toThrow('2 todos match')
  })
})

describe('injectDueReminders todo nudge', () => {
  // A todo row exactly one full interval staler than the session
  const staleSession = { ...session, turnCount: 2 + TODO_NUDGE_INTERVAL_TURNS }

  test('injects a stale nudge as a todo message and re-arms the row', async () => {
    const { ctx, inserts, patches } = makeCtx({
      agent,
      session: staleSession,
      todo: {
        _id: 'todo_1',
        items: [{ content: 'ship it', status: 'pending' }],
        turnCount: 2,
      },
    })

    await injectDueReminders(ctx, staleSession as never, 'user_1' as never)

    const message = inserts.find((entry) => entry.table === 'messages')
    expect(message?.doc).toMatchObject({
      sessionId: 'session_1',
      sender: { type: 'agent', id: 'agent_1' },
      role: 'system',
      status: 'done',
      type: 'todo',
      hidden: true,
    })

    const content = inserts.find((entry) => entry.table === 'messageContents')
    const part = (content?.doc.parts as Array<{ text: string }>)[0]
    expect(part.text).toContain('[ ] ship it')
    expect(part.text).toContain('<system-reminder>')

    expect(patches).toEqual([
      { id: 'todo_1', patch: { turnCount: staleSession.turnCount } },
    ])
  })

  test('does nothing before the interval elapses', async () => {
    const { ctx, inserts, patches } = makeCtx({
      agent,
      session,
      todo: { _id: 'todo_1', items: todos('pending'), turnCount: 5 },
    })

    await injectDueReminders(ctx, session as never, 'user_1' as never)

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })

  test('never nudges a fully completed list', async () => {
    const { ctx, inserts, patches } = makeCtx({
      agent,
      session: staleSession,
      todo: {
        _id: 'todo_1',
        items: todos('completed', 'completed'),
        turnCount: 2,
      },
    })

    await injectDueReminders(ctx, staleSession as never, 'user_1' as never)

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })

  test('never nudges an agent with the todo toggle off', async () => {
    const { ctx, inserts, patches } = makeCtx({
      agent: { ...agent, tools: [] },
      session: staleSession,
      todo: { _id: 'todo_1', items: todos('pending'), turnCount: 2 },
    })

    await injectDueReminders(ctx, staleSession as never, 'user_1' as never)

    expect(inserts).toEqual([])
    expect(patches).toEqual([])
  })
})

describe('todo tool toggle', () => {
  const fakeCtx = {
    runQuery: async () => null,
    runMutation: async () => undefined,
  } as never
  const toolSession = { _id: 'session_1' } as never

  test('one toggle enables both tools', async () => {
    const tools = await getEnabledTools(
      [TODO_TOOL_TOGGLE],
      undefined,
      toolSession,
      null,
      { ctx: fakeCtx },
    )

    expect(tools.write_todo).toBeDefined()
    expect(tools.edit_todo).toBeDefined()
  })

  test('both tools are hidden when the toggle is off', async () => {
    const tools = await getEnabledTools([], undefined, toolSession, null, {
      ctx: fakeCtx,
    })

    expect(tools.write_todo).toBeUndefined()
    expect(tools.edit_todo).toBeUndefined()
  })
})
