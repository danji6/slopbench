/// <reference types="bun-types" />
import {
  resolveSpawnableAgents,
  sanitizeSubAgents,
} from '@sb/convex/model/agent/subagents'
import { getEnabledTools } from '@sb/convex/model/tools'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

function fakeCtx(agents: Row[]) {
  const byId = new Map(agents.map((row) => [row._id, row]))
  return {
    db: {
      get: async (id: string) => byId.get(id) ?? null,
      query: () => {
        const chain = {
          withIndex: () => chain,
          order: () => chain,
          collect: async () => agents,
        }
        return chain
      },
    },
  } as never
}

const owner = 'user_1'
const coder = { _id: 'agent_coder', ownerId: owner, name: 'Coder' }
const explorer = {
  _id: 'agent_explorer',
  ownerId: owner,
  name: 'Explore',
  description: 'Searches the codebase',
}
const planner = { _id: 'agent_planner', ownerId: owner, name: 'Plan' }

describe('resolveSpawnableAgents', () => {
  test('no config (or allow + empty) means nothing spawnable', async () => {
    const ctx = fakeCtx([coder, explorer, planner])
    expect(await resolveSpawnableAgents(ctx, coder as never)).toEqual([])
    expect(
      await resolveSpawnableAgents(ctx, {
        ...coder,
        subAgents: { mode: 'allow', agentIds: [] },
      } as never),
    ).toEqual([])
  })

  test('allow mode returns only the listed agents', async () => {
    const ctx = fakeCtx([coder, explorer, planner])
    const spawnable = await resolveSpawnableAgents(ctx, {
      ...coder,
      subAgents: { mode: 'allow', agentIds: ['agent_explorer'] },
    } as never)
    expect(spawnable).toEqual([
      {
        _id: 'agent_explorer',
        name: 'Explore',
        description: 'Searches the codebase',
      },
    ] as never)
  })

  test('deny mode returns every owned agent (including self) except the listed ones', async () => {
    const ctx = fakeCtx([coder, explorer, planner])
    const spawnable = await resolveSpawnableAgents(ctx, {
      ...coder,
      subAgents: { mode: 'deny', agentIds: ['agent_planner'] },
    } as never)
    expect(spawnable.map((agent) => String(agent._id))).toEqual([
      'agent_coder',
      'agent_explorer',
    ])
  })

  test('the agent itself is spawnable when configured', async () => {
    const ctx = fakeCtx([coder, explorer])
    const spawnable = await resolveSpawnableAgents(ctx, {
      ...coder,
      subAgents: { mode: 'allow', agentIds: ['agent_coder', 'agent_explorer'] },
    } as never)
    expect(spawnable.map((agent) => String(agent._id))).toEqual([
      'agent_coder',
      'agent_explorer',
    ])

    const denyAll = await resolveSpawnableAgents(ctx, {
      ...coder,
      subAgents: { mode: 'deny', agentIds: [] },
    } as never)
    expect(denyAll.map((agent) => String(agent._id))).toEqual([
      'agent_coder',
      'agent_explorer',
    ])
  })
})

describe('sanitizeSubAgents', () => {
  test('drops foreign, unknown and duplicate ids but keeps self', async () => {
    const foreign = { _id: 'agent_foreign', ownerId: 'user_2', name: 'Other' }
    const ctx = fakeCtx([coder, explorer, foreign])

    const sanitized = await sanitizeSubAgents(ctx, owner as never, {
      mode: 'allow',
      agentIds: [
        'agent_explorer',
        'agent_explorer',
        'agent_foreign',
        'agent_coder',
        'agent_missing',
      ],
    } as never)

    expect(sanitized).toEqual({
      mode: 'allow',
      agentIds: ['agent_explorer', 'agent_coder'],
    } as never)
  })

  test('passes undefined through', async () => {
    const ctx = fakeCtx([])
    expect(await sanitizeSubAgents(ctx, owner as never, undefined)).toBe(
      undefined,
    )
  })
})

describe('task tool', () => {
  test('is exposed with the agent roster when spawnable agents exist', async () => {
    const tools = await getEnabledTools([], undefined, undefined, null, {
      spawnableAgents: [
        {
          _id: 'agent_explorer' as never,
          name: 'Explore',
          description: 'Searches the codebase',
        },
        { _id: 'agent_planner' as never, name: 'Plan' },
      ],
    })

    expect(tools.task).toBeDefined()
    expect(tools.task?.description).toContain(
      '- Explore: Searches the codebase',
    )
    expect(tools.task?.description).toContain('- Plan')
    // No execute: the engine mediates spawning and settlement
    expect(tools.task?.execute).toBeUndefined()
  })

  test('is hidden without spawnable agents', async () => {
    const none = await getEnabledTools([], undefined, undefined, null, {
      spawnableAgents: [],
    })
    expect(none.task).toBeUndefined()
  })

  test('stays exposed in plan mode', async () => {
    const planMode = await getEnabledTools([], undefined, undefined, null, {
      mode: 'plan',
      spawnableAgents: [{ _id: 'agent_explorer' as never, name: 'Explore' }],
    })
    expect(planMode.task).toBeDefined()
  })
})
