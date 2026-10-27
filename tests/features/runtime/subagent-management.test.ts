import {
  list as listSubagents,
  stopAll as stopAllSubagents,
  stop as stopSubagent,
} from '@sb/convex/model/subagent/manage'
import { describe, expect, test } from 'bun:test'
import { explorer, owner } from '~/tests/helpers/subagent-lifecycle'
import { fakeCtx } from '~/tests/setup/subagents'

describe('subagent management widget', () => {
  const membership = { _id: 'us_1', sessionId: 'parent_session', userId: owner }
  const parentSession = { _id: 'parent_session', ownerId: owner }
  const childSession = {
    _id: 'child_session_1',
    _creationTime: 900,
    title: 'Find the config',
    activeAgentId: 'agent_explorer',
    parent: { sessionId: 'parent_session', agentId: 'agent_coder' },
  }
  const liveChildStream = {
    _id: 'child_stream_1',
    _creationTime: 1_000,
    sessionId: 'child_session_1',
    leaseExpiresAt: Date.now() + 60_000,
    state: { phase: 'streaming', processingMessageId: 'child_message_1' },
    command: { kind: 'invoke' },
  }

  test('list returns running children with agent identity', async () => {
    const { ctx } = fakeCtx({
      docs: [parentSession, explorer, liveChildStream],
      membershipsBySession: { parent_session: [membership] },
      sessionsByParent: { parent_session: [childSession] },
      streamsBySession: { child_session_1: [structuredClone(liveChildStream)] },
    })

    const result = (await listSubagents(ctx, {
      sessionId: 'parent_session' as never,
    })) as Array<Record<string, unknown>>

    expect(result).toEqual([
      {
        sessionId: 'child_session_1',
        title: 'Find the config',
        agentName: 'Explore',
        avatarId: undefined,
        running: true,
        startedAt: expect.any(Number),
        tokens: null,
        status: 'streaming',
      },
    ])
  })

  test('list keeps settled children with running=false', async () => {
    const { ctx } = fakeCtx({
      docs: [parentSession, explorer],
      membershipsBySession: { parent_session: [membership] },
      sessionsByParent: { parent_session: [childSession] },
      streamsBySession: {},
    })

    const result = (await listSubagents(ctx, {
      sessionId: 'parent_session' as never,
    })) as Array<Record<string, unknown>>

    expect(result).toEqual([
      expect.objectContaining({
        sessionId: 'child_session_1',
        running: false,
        status: null,
      }),
    ])
  })

  test('list rejects a non-member', async () => {
    const { ctx } = fakeCtx({
      docs: [parentSession],
      membershipsBySession: {},
      sessionsByParent: { parent_session: [childSession] },
    })

    await expect(
      listSubagents(ctx, { sessionId: 'parent_session' as never }),
    ).rejects.toThrow()
  })

  test('stop silently halts one child', async () => {
    const { ctx, patches, cancelled } = fakeCtx({
      docs: [parentSession, childSession, structuredClone(liveChildStream)],
      membershipsBySession: { parent_session: [membership] },
      streamsBySession: { child_session_1: [structuredClone(liveChildStream)] },
    })

    await stopSubagent(ctx, {
      sessionId: 'parent_session' as never,
      childSessionId: 'child_session_1' as never,
    })

    expect(cancelled).toEqual([])
    // A user-initiated stop has nothing to report, so it's silenced
    expect(patches).toContainEqual({
      id: 'child_stream_1',
      patch: expect.objectContaining({
        suppressFollowUp: true,
        suppressReport: true,
        state: expect.objectContaining({ phase: 'stopping' }),
      }),
    })
  })

  test('stop rejects a session that is not a child of the parent', async () => {
    const orphan = { _id: 'child_session_1', parent: { sessionId: 'other' } }
    const { ctx } = fakeCtx({
      docs: [parentSession, orphan],
      membershipsBySession: { parent_session: [membership] },
    })

    await expect(
      stopSubagent(ctx, {
        sessionId: 'parent_session' as never,
        childSessionId: 'child_session_1' as never,
      }),
    ).rejects.toThrow()
  })

  test('stopAll silences every running child', async () => {
    const { ctx, patches } = fakeCtx({
      docs: [parentSession, childSession, structuredClone(liveChildStream)],
      membershipsBySession: { parent_session: [membership] },
      sessionsByParent: { parent_session: [childSession] },
      streamsBySession: { child_session_1: [structuredClone(liveChildStream)] },
    })

    await stopAllSubagents(ctx, { sessionId: 'parent_session' as never })

    expect(patches).toContainEqual({
      id: 'child_stream_1',
      patch: expect.objectContaining({
        suppressFollowUp: true,
        suppressReport: true,
        state: expect.objectContaining({ phase: 'stopping' }),
      }),
    })
  })
})
