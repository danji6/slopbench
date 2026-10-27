import { _fail, stopChildSessions } from '@sb/convex/model/stream/lifecycle'
import { describe, expect, test } from 'bun:test'
import { taskPart } from '~/tests/helpers/subagent-lifecycle'
import { fakeCtx } from '~/tests/setup/subagents'

describe('parent teardown', () => {
  const childSessionRow = {
    _id: 'child_session_1',
    parent: {
      sessionId: 'parent_session',
      streamId: 'parent_stream',
      toolCallId: 'tc_1',
      agentId: 'agent_coder',
    },
  }
  const runningChildStream = {
    _id: 'child_stream_1',
    sessionId: 'child_session_1',
    state: { phase: 'streaming', processingMessageId: 'child_message_1' },
    command: { kind: 'invoke' },
  }

  function failDocs(parts: unknown[]) {
    return [
      {
        _id: 'parent_stream',
        sessionId: 'parent_session',
        attempt: 0,
        state: {
          phase: 'streaming',
          processingMessageId: 'parent_message',
          processingContentId: 'parent_content',
        },
        command: { kind: 'invoke' },
      },
      { _id: 'parent_message', selectedVersion: 1 },
      {
        _id: 'parent_content',
        segmentIndex: 0,
        version: 1,
        parts,
      },
    ]
  }

  test('stopChildSessions silences and stops running children', async () => {
    const { ctx, patches, scheduled, cancelled } = fakeCtx({
      docs: [structuredClone(runningChildStream)],
      sessionsByParent: { parent_session: [childSessionRow] },
      streamsBySession: {
        child_session_1: [structuredClone(runningChildStream)],
      },
    })

    await stopChildSessions(ctx, 'parent_session' as never)

    expect(cancelled).toEqual([])
    expect(patches).toContainEqual({
      id: 'child_stream_1',
      patch: expect.objectContaining({
        suppressFollowUp: true,
        suppressReport: true,
        state: expect.objectContaining({ phase: 'stopping' }),
      }),
    })
    expect(scheduled).toContainEqual({
      args: [0, expect.anything(), { streamId: 'child_stream_1' }],
    })
  })

  test('a failed parent leaves children running and settles unspawned parts', async () => {
    const parts = [taskPart()]
    const { ctx, patches, cancelled, byId } = fakeCtx({
      docs: failDocs(parts),
      sessionsByParent: { parent_session: [childSessionRow] },
      streamsBySession: {
        child_session_1: [structuredClone(runningChildStream)],
      },
    })

    await _fail(ctx, {
      generation: 0,
      streamId: 'parent_stream' as never,
      message: 'Stream interrupted before completion.',
    })

    const row = byId.get('parent_content') as unknown as { parts: unknown[] }
    expect(row.parts[0]).toMatchObject({
      state: 'output-available',
      output: '[The turn ended before the sub-agent could be started.]',
    })

    // Children are not cascade-stopped by a failed parent turn
    expect(cancelled).toHaveLength(0)
    expect(patches.find(({ id }) => id === 'child_stream_1')).toBeUndefined()
  })
})
