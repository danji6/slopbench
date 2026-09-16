/// <reference types="bun-types" />
import type { Doc } from '@sb/convex/_generated/dataModel'
import { _suspendStep } from '@sb/convex/model/stream/subagents'
import { resolveSubagentModel } from '@sb/convex/model/subagent/models'
import type { AgentSubagentOverride, ModelReasoning } from '@sb/core/types'
import { describe, expect, test } from 'bun:test'

import { fakeCtx } from '../setup/subagents'

const owner = 'user_1'
const explorer = { _id: 'explore', ownerId: owner, name: 'Explore' }
const reviewer = { _id: 'review', ownerId: owner, name: 'Review' }
const session = {
  _id: 'session',
  ownerId: owner,
  model: { id: 'parent-model' },
  reasoningEffort: 'high',
}
const task = (name: string) => ({
  type: 'tool-task',
  toolCallId: name,
  state: 'input-available',
  input: { agent_name: name, prompt: 'Inspect the code' },
})

function setup(
  overrides: AgentSubagentOverride[] = [],
  reasoning: ModelReasoning = { type: 'effort', efforts: ['low', 'high'] },
) {
  const parent = {
    _id: 'parent',
    ownerId: owner,
    name: 'Parent',
    subAgents: { mode: 'deny', agentIds: [], overrides },
  }
  const provider = {
    _id: 'provider',
    ownerId: owner,
    key: 'openai',
    enabled: true,
    models: [
      { id: 'fast', label: 'Fast', contextWindow: 32768, reasoning },
      {
        id: 'capable',
        reasoning: { type: 'effort', efforts: ['low', 'high'] },
      },
    ],
  }
  const fixture = fakeCtx({
    docs: [
      parent,
      explorer,
      reviewer,
      session,
      {
        _id: 'stream',
        sessionId: session._id,
        agentId: parent._id,
        status: 'streaming',
        invokedBy: owner,
        processingMessageId: 'message',
        processingContentId: 'content',
      },
      { _id: 'message', selectedVersion: 1 },
      {
        _id: 'content',
        segmentIndex: 0,
        version: 1,
        parts: [task('Explore'), task('Review')],
      },
    ],
    agents: [parent, explorer, reviewer],
    modelProviders: [provider],
  })
  return { ...fixture, parent, provider }
}

async function resolve(
  fixture: ReturnType<typeof setup>,
  parent = fixture.parent,
) {
  return resolveSubagentModel(fixture.ctx, {
    parent: parent as unknown as Doc<'agents'>,
    session: session as Doc<'sessions'>,
    agent: explorer as Doc<'agents'>,
  })
}

describe('subagent model resolution', () => {
  test('preserves legacy model and reasoning inheritance', async () => {
    const result = await resolve(setup())
    expect(result.settings).toEqual({
      model: session.model,
      reasoningEffort: 'high',
    })
  })

  test('supports independent overrides and uses model metadata', async () => {
    const modelOnly = await resolve(
      setup([{ agentId: 'explore', modelId: 'fast' }]),
    )
    expect(modelOnly.settings).toMatchObject({
      model: { id: 'fast', label: 'Fast', contextWindow: 32768 },
      reasoningEffort: 'high',
    })
    const reasoningOnly = await resolve(
      setup([{ agentId: 'explore', reasoningEffort: 'low' }]),
    )
    expect(reasoningOnly.settings).toEqual({
      model: session.model,
      reasoningEffort: 'low',
    })
  })

  test('different parents can configure the same subagent differently', async () => {
    const fixture = setup([
      { agentId: 'explore', modelId: 'fast', reasoningEffort: 'low' },
    ])
    const other = {
      ...fixture.parent,
      subAgents: {
        ...fixture.parent.subAgents,
        overrides: [{ agentId: 'explore', modelId: 'capable' }],
      },
    }
    expect((await resolve(fixture)).settings?.model?.id).toBe('fast')
    expect((await resolve(fixture, other)).settings?.model?.id).toBe('capable')
    expect(session.model.id).toBe('parent-model')
  })

  test.each([
    { reasoning: { type: 'effort', efforts: ['low'] }, expected: 'auto' },
    {
      reasoning: { type: 'binary', parameter: 'enable_thinking' },
      expected: 'auto',
    },
    { reasoning: { type: 'none' }, expected: 'none' },
  ] as const)(
    'normalizes inherited reasoning for $reasoning.type models',
    async ({ reasoning, expected }) => {
      const fixture = setup(
        [{ agentId: 'explore', modelId: 'fast' }],
        reasoning as ModelReasoning,
      )
      expect((await resolve(fixture)).settings?.reasoningEffort).toBe(expected)
    },
  )

  test('explicit None remains off for a binary model', async () => {
    const fixture = setup(
      [{ agentId: 'explore', modelId: 'fast', reasoningEffort: 'none' }],
      { type: 'binary', parameter: 'enable_thinking' },
    )
    expect((await resolve(fixture)).settings?.reasoningEffort).toBe('none')
  })
})

describe('spawning configured subagents', () => {
  test('stores independent selections on new child sessions', async () => {
    const fixture = setup([
      { agentId: 'explore', modelId: 'fast', reasoningEffort: 'low' },
      { agentId: 'review', modelId: 'capable' },
    ])
    expect(
      await _suspendStep(fixture.ctx, { streamId: 'stream' as never }),
    ).toBe('continue')
    const children = fixture.inserts.filter(
      (entry) => entry.table === 'sessions',
    )
    expect(
      children.map(({ fields }) => [
        fields.activeAgentId,
        fields.model,
        fields.reasoningEffort,
      ]),
    ).toMatchObject([
      ['explore', { id: 'fast' }, 'low'],
      ['review', { id: 'capable' }, 'high'],
    ])
    expect(fixture.byId.get('session')?.model).toEqual(session.model)
    fixture.parent.subAgents.overrides = []
    expect(children[0].fields).toMatchObject({
      model: { id: 'fast' },
      reasoningEffort: 'low',
    })
  })

  test.each(['removed', 'disabled', 'foreign'] as const)(
    'reports a %s model without blocking valid tasks',
    async (unavailable) => {
      const fixture = setup([
        {
          agentId: 'explore',
          modelId: unavailable === 'removed' ? 'removed' : 'fast',
        },
      ])
      if (unavailable === 'disabled') fixture.provider.enabled = false
      if (unavailable === 'foreign') fixture.provider.ownerId = 'other-user'
      expect(
        await _suspendStep(fixture.ctx, { streamId: 'stream' as never }),
      ).toBe('continue')
      const children = fixture.inserts.filter(
        (entry) => entry.table === 'sessions',
      )
      expect(children).toHaveLength(1)
      expect(children[0].fields.activeAgentId).toBe('review')
      expect(fixture.byId.get('content')?.parts).toMatchObject([
        {
          state: 'output-error',
          errorText: expect.stringContaining(
            'Cannot spawn sub-agent "Explore"',
          ),
        },
        { state: 'output-available' },
      ])
    },
  )
})
