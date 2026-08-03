/// <reference types="bun-types" />
import { promptItemKey } from '@sb/convex/model/prompt/markers'
import { mergePrompts } from '@sb/convex/model/prompt/prompts'
import { list, replaceScope, resolveSets } from '@sb/convex/model/prompts'
import { list as listReminders } from '@sb/convex/model/reminders'
import type { Prompt, PromptItem, PromptScope } from '@sb/convex/types'
import { MAX_PROMPT_CONTENT_CHARS, MAX_SCOPE_PROMPTS } from '@sb/core/limits'
import { describe, expect, test } from 'bun:test'

const OWNER = 'user_1'
const AGENT = 'agent_1'
/** An id the client still holds after the agent behind it was deleted. */
const DELETED = 'agent_gone' as never

function prompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 'p1',
    name: 'Prompt',
    role: 'system',
    content: 'be helpful',
    enabled: true,
    visible: false,
    starter: false,
    ...overrides,
  }
}

type Row = {
  _id: string
  ownerId: string
  agentId?: string
  scope: PromptScope
  order: number
  key: string
  item: PromptItem
}

/**
 * A `prompts` table stub. The model only reaches it through the two scope
 * indexes, so dispatching on the index name is enough to serve both.
 */
function makeCtx(rows: Row[] = []) {
  let nextId = rows.length + 1
  const store = [...rows]

  const ctx = {
    userId: OWNER,
    db: {
      get: async (id: string) =>
        id === AGENT
          ? { _id: AGENT, ownerId: OWNER }
          : (store.find((row) => row._id === id) ?? null),
      insert: async (_table: string, doc: Omit<Row, '_id'>) => {
        const _id = `prompts_${nextId++}`
        store.push({ _id, ...doc })
        return _id
      },
      patch: async (id: string, patch: Partial<Row>) => {
        const row = store.find((entry) => entry._id === id)
        if (row) Object.assign(row, patch)
      },
      delete: async (id: string) => {
        const index = store.findIndex((entry) => entry._id === id)
        if (index !== -1) store.splice(index, 1)
      },
      query: () => ({
        withIndex: (index: string, build: (q: unknown) => unknown) => {
          const captured: Record<string, unknown> = {}
          const q = {
            eq: (field: string, value: unknown) => {
              captured[field] = value
              return q
            },
          }
          build(q)

          const matches = store.filter((row) =>
            index === 'by_agentId_scope_order'
              ? row.agentId === captured.agentId && row.scope === captured.scope
              : row.ownerId === captured.ownerId &&
                row.agentId === undefined &&
                row.scope === captured.scope,
          )

          return {
            order: () => ({
              collect: async () =>
                [...matches].sort((a, b) => a.order - b.order),
            }),
          }
        },
      }),
    },
  } as never

  return { ctx, store }
}

function row(
  scope: PromptScope,
  item: PromptItem,
  order: number,
  agent = false,
) {
  return {
    _id: `prompts_${scope}_${order}`,
    ownerId: OWNER,
    ...(agent ? { agentId: AGENT } : {}),
    scope,
    order,
    key: promptItemKey(item),
    item,
  } satisfies Row
}

describe('prompt rows', () => {
  test('merge from rows matches merging the old inline arrays', async () => {
    const own = prompt({ id: 'own' })
    const global = prompt({ id: 'global' })
    const library = prompt({ id: 'lib' })
    const order = [
      { kind: 'library' as const, id: 'lib' },
      { kind: 'own' as const, id: 'own' },
      { kind: 'global' as const, id: 'global' },
    ]

    const { ctx } = makeCtx([
      row('own', own, 0, true),
      row('global', global, 0),
      row('library', library, 0),
    ])
    const sets = await resolveSets(ctx, { _id: AGENT, ownerId: OWNER } as never)

    const fromRows = mergePrompts(
      { prompts: sets.own, promptOrder: order },
      sets.global,
      sets.library,
    )
    const fromArrays = mergePrompts(
      { prompts: [own], promptOrder: order },
      [global],
      [library],
    )

    expect(fromRows).toEqual(fromArrays)
    expect(fromRows.map((item) => promptItemKey(item))).toEqual([
      'lib',
      'own',
      'global',
    ])
  })

  test('compaction falls back to the owner when the agent overrides nothing', async () => {
    const userPrompt = prompt({ id: 'user-compaction' })
    const { ctx } = makeCtx([row('compaction', userPrompt, 0)])

    const sets = await resolveSets(ctx, { _id: AGENT, ownerId: OWNER } as never)

    expect(sets.compaction).toEqual([userPrompt])
  })

  test('an agent override wins over the owner set', async () => {
    const agentPrompt = prompt({ id: 'agent-compaction' })
    const { ctx } = makeCtx([
      row('compaction', prompt({ id: 'user-compaction' }), 0),
      row('compaction', agentPrompt, 0, true),
    ])

    const sets = await resolveSets(ctx, { _id: AGENT, ownerId: OWNER } as never)

    expect(sets.compaction).toEqual([agentPrompt])
  })
})

describe('a stale agent reference', () => {
  test('reads resolve to nothing rather than throwing', async () => {
    // A throwing reactive query takes down every subscriber to it
    const { ctx } = makeCtx([row('own', prompt(), 0, true)])

    await expect(
      list(ctx, { scope: 'own', agentId: DELETED }),
    ).resolves.toEqual([])
    await expect(
      listReminders(ctx, { scope: 'own', agentId: DELETED }),
    ).resolves.toEqual([])
  })

  test('writes still reject', async () => {
    const { ctx } = makeCtx()

    await expect(
      replaceScope(ctx, { scope: 'own', agentId: DELETED, items: [prompt()] }),
    ).rejects.toThrow(/Not found/)
  })

  test('a malformed scope still throws on a read', async () => {
    // Fixed by the call site, so it can't be reached by holding a stale id
    const { ctx } = makeCtx()

    await expect(list(ctx, { scope: 'own' })).rejects.toThrow(/need an agent/)
    await expect(
      list(ctx, { scope: 'global', agentId: AGENT as never }),
    ).rejects.toThrow(/user-owned/)
  })
})

describe('replaceScope', () => {
  test('keeps matched rows, reorders them, and drops the rest', async () => {
    const keep = prompt({ id: 'keep' })
    const drop = prompt({ id: 'drop' })
    const { ctx, store } = makeCtx([
      row('global', keep, 0),
      row('global', drop, 1),
    ])

    const added = prompt({ id: 'added' })
    await replaceScope(ctx, { scope: 'global', items: [added, keep] })

    expect(store.map((entry) => entry.key)).toEqual(['keep', 'added'])
    expect(store.find((entry) => entry.key === 'keep')?.order).toBe(1)
    expect(store.find((entry) => entry.key === 'added')?.order).toBe(0)
  })

  test('clearing a scope removes every row', async () => {
    const { ctx, store } = makeCtx([row('compaction', prompt(), 0, true)])

    await replaceScope(ctx, {
      scope: 'compaction',
      agentId: AGENT as never,
      items: [],
    })

    expect(store).toEqual([])
  })

  test('rejects a list over the per-scope cap', async () => {
    const { ctx } = makeCtx()
    const items = Array.from({ length: MAX_SCOPE_PROMPTS + 1 }, (_, i) =>
      prompt({ id: `p${i}` }),
    )

    await expect(replaceScope(ctx, { scope: 'global', items })).rejects.toThrow(
      /Prompts limit exceeded/,
    )
  })

  test('rejects a prompt over the content cap', async () => {
    const { ctx } = makeCtx()
    const items = [
      prompt({ content: 'x'.repeat(MAX_PROMPT_CONTENT_CHARS + 1) }),
    ]

    await expect(replaceScope(ctx, { scope: 'global', items })).rejects.toThrow(
      /Prompt content limit exceeded/,
    )
  })
})
