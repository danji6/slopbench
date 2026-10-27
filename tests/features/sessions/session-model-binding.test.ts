import type { Id } from '@sb/convex/_generated/dataModel'
import { activate } from '@sb/convex/model/session/agents'
import { refreshForOwner } from '@sb/convex/model/session/models'
import {
  create,
  setModel,
  setReasoningEffort,
} from '@sb/convex/model/session/sessions'
import { modelReference } from '@sb/core/model-reference'
import { describe, expect, test } from 'bun:test'
import {
  MEMBER,
  OWNER,
  makeCtx,
  seedMembership,
  seedSession,
} from '~/tests/helpers/session-duplicate'

describe('session model binding', () => {
  test('new sessions copy the recent model defaults', async () => {
    const { ctx, tables } = makeCtx()
    tables.agents.push({
      _id: 'agents_1',
      ownerId: OWNER,
      name: 'Agent',
    })
    tables.settings.push({
      _id: 'settings_1',
      ownerId: OWNER,
      recentModel: 'model-a',
      recentReasoning: 'medium',
    })

    const { sessionId } = await create(ctx as never, {
      activeAgentId: 'agents_1' as Id<'agents'>,
    })
    const session = tables.sessions.find((row) => row._id === sessionId)!

    expect(session.model).toEqual({ id: 'model-a' })
    expect(session.reasoningEffort).toBe('medium')
  })

  test('changes only the selected session and remembers the choice', async () => {
    const { ctx, tables } = makeCtx()
    const first = seedSession(tables, {
      activeAgentId: 'agents_1',
      model: { id: 'model-a' },
    })
    const second = {
      ...first,
      _id: 'session_2',
      model: { id: 'model-b' },
    }
    tables.sessions.push(second)
    tables.agents.push({
      _id: 'agents_1',
      ownerId: OWNER,
      name: 'Agent',
    })

    await setModel(ctx as never, {
      sessionId: first._id as Id<'sessions'>,
      modelId: 'model-c',
      reasoningEffort: 'low',
    })

    expect(first.model).toEqual({ id: 'model-c' })
    expect(first.reasoningEffort).toBe('low')
    expect(second.model).toEqual({ id: 'model-b' })
    expect(tables.settings[0]).toMatchObject({
      recentModel: 'model-c',
      recentReasoning: 'low',
    })
  })

  test('changes reasoning effort only for the targeted session', async () => {
    const { ctx, tables } = makeCtx()
    const first = seedSession(tables, {
      activeAgentId: 'agents_1',
      reasoningEffort: 'low',
    })
    const second = { ...first, _id: 'session_2', reasoningEffort: 'high' }
    tables.sessions.push(second)
    tables.agents.push({
      _id: 'agents_1',
      ownerId: OWNER,
      name: 'Agent',
    })

    await setReasoningEffort(ctx as never, {
      sessionId: first._id as Id<'sessions'>,
      reasoningEffort: 'medium',
    })

    expect(first.reasoningEffort).toBe('medium')
    expect(second.reasoningEffort).toBe('high')
    expect(tables.settings[0].recentReasoning).toBe('medium')
  })

  test('rejects changes from someone other than the active agent owner', async () => {
    const { ctx, tables } = makeCtx()
    seedSession(tables, { activeAgentId: 'agents_1' })
    seedMembership(tables, OWNER)
    tables.agents.push({
      _id: 'agents_1',
      ownerId: MEMBER,
      name: 'Theirs',
    })

    await expect(
      setModel(ctx as never, {
        sessionId: 'session_1' as Id<'sessions'>,
        modelId: 'model-c',
        reasoningEffort: 'auto',
      }),
    ).rejects.toThrow('Forbidden')
  })

  test('switching agents preserves the session model binding', async () => {
    const { ctx, tables } = makeCtx()
    const session = seedSession(tables, {
      activeAgentId: 'agents_1',
      model: { id: 'model-a' },
      reasoningEffort: 'high',
    })
    tables.agents.push(
      { _id: 'agents_1', ownerId: OWNER, name: 'First' },
      { _id: 'agents_2', ownerId: OWNER, name: 'Second' },
    )
    tables.sessionAgents.push({
      _id: 'link_2',
      sessionId: session._id,
      agentId: 'agents_2',
    })

    await activate(ctx as never, {
      sessionId: session._id as Id<'sessions'>,
      agentId: 'agents_2' as Id<'agents'>,
    })

    expect(session.activeAgentId).toBe('agents_2')
    expect(session.model).toEqual({ id: 'model-a' })
    expect(session.reasoningEffort).toBe('high')
  })

  test('provider edits refresh metadata without changing the selected id', async () => {
    const { ctx, tables } = makeCtx()
    const session = seedSession(tables, {
      activeAgentId: 'agents_1',
      model: {
        id: modelReference('provider_1', 'model-a'),
        label: 'Old label',
      },
    })
    tables.agents.push(
      { _id: 'agents_0', ownerId: OWNER, name: 'Inactive' },
      { _id: 'agents_1', ownerId: OWNER, name: 'Agent' },
    )
    tables.sessionAgents.push(
      {
        _id: 'link_0',
        sessionId: session._id,
        agentId: 'agents_0',
      },
      {
        _id: 'link_1',
        sessionId: session._id,
        agentId: 'agents_1',
      },
    )
    tables.modelProviders.push({
      _id: 'provider_1',
      ownerId: OWNER,
      key: 'openai',
      enabled: true,
      order: 0,
      models: [{ id: 'model-a', label: 'Updated label' }],
    })

    await refreshForOwner(ctx as never, OWNER as Id<'users'>)

    expect((session.model as { id: string; label?: string }).id).toBe(
      modelReference('provider_1', 'model-a'),
    )
    expect((session.model as { id: string; label?: string }).label).toBe(
      'Updated label',
    )
  })
})
