/// <reference types="bun-types" />
import { executeResume } from '@sb/convex/model/chat/send'
import { describe, expect, test } from 'bun:test'

function resumeCtx({
  messages,
  boundary,
  sessionAgent = { _id: 'link_1' },
}: {
  messages: Array<Record<string, unknown>>
  boundary: Record<string, unknown> | null
  sessionAgent?: Record<string, unknown> | null
}) {
  const session = {
    _id: 'session_1',
    ownerId: 'owner_1',
    activeAgentId: 'agent_current',
    disabled: false,
  }
  const membership = { _id: 'membership_1', role: 'owner' }
  const agent = { _id: 'agent_original', ownerId: 'owner_1' }
  const settings = { _id: 'settings_1', ownerId: 'owner_1' }
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; fields: Record<string, unknown> }> = []
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = []

  const q = {
    eq: () => q,
    lt: () => q,
  }

  const ctx = {
    userId: 'user_1',
    db: {
      get: async (id: string) => {
        if (id === 'session_1') return session
        if (id === 'agent_original') return agent
        if (id === boundary?._id) return boundary
        const message = messages.find((item) => item._id === id)
        if (message) return message
        return null
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
      },
      insert: async (table: string, fields: Record<string, unknown>) => {
        inserts.push({ table, fields })
        return `${table}_${inserts.length}`
      },
      query: (table: string) => ({
        withIndex: (index: string, cb: (query: typeof q) => typeof q) => {
          cb(q)
          if (table === 'userSessions') {
            return { unique: async () => membership }
          }
          if (table === 'streams') {
            return { first: async () => null }
          }
          if (table === 'messages') {
            return {
              order: () => ({
                collect: async () => messages,
                first: async () => boundary,
              }),
            }
          }
          if (table === 'sessionAgents') {
            return { unique: async () => sessionAgent }
          }
          if (table === 'settings') {
            return { unique: async () => settings }
          }
          if (table === 'messageContents') {
            return {
              order: () => ({
                first: async () => ({ _id: 'content_1', segmentIndex: 0 }),
              }),
            }
          }
          throw new Error(`Unexpected query: ${table}.${index}`)
        },
      }),
    },
    scheduler: {
      runAfter: async (
        delay: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ delay, args })
        return 'job_1'
      },
    },
  } as never

  return { ctx, session, patches, inserts, scheduled }
}

describe('executeResume', () => {
  test('resumes the latest normal assistant message behind newer user messages', async () => {
    const assistant = {
      _id: 'assistant_1',
      _creationTime: 20,
      sessionId: 'session_1',
      role: 'assistant',
      sender: { type: 'agent', id: 'agent_original' },
      status: 'done',
      contextEligible: true,
      parts: [{ type: 'text', text: 'partial' }],
      metadata: {
        duration: 100,
        error: 'Previous stream failed.',
      },
    }
    const boundary = {
      _id: 'user_1',
      _creationTime: 10,
      role: 'user',
    }
    const { ctx, session, patches, inserts, scheduled } = resumeCtx({
      messages: [
        {
          _id: 'user_2',
          _creationTime: 30,
          role: 'user',
          sender: { type: 'user', id: 'user_1' },
        },
        assistant,
        boundary,
      ],
      boundary,
    })

    const streamId = await executeResume(
      ctx,
      session as never,
      'user_1' as never,
    )

    expect(streamId).toBe('streams_1' as never)
    expect(patches).toContainEqual({
      id: 'assistant_1',
      patch: { status: 'processing', metadata: { duration: 100 } },
    })
    expect(inserts).toContainEqual({
      table: 'streams',
      fields: expect.objectContaining({
        agentId: 'agent_original',
        processingMessageId: 'assistant_1',
        contextBoundaryMessageId: 'user_1',
        contextBoundaryCreationTime: 10,
        suppressFollowUp: true,
      }),
    })
    expect(scheduled).toEqual([{ delay: 0, args: { streamId: 'streams_1' } }])
  })

  test('skips summaries when choosing the resumable assistant message', async () => {
    const { ctx, session, inserts } = resumeCtx({
      messages: [
        {
          _id: 'summary_1',
          _creationTime: 30,
          role: 'assistant',
          type: 'summary',
          sender: { type: 'agent', id: 'agent_original' },
        },
        {
          _id: 'assistant_1',
          _creationTime: 20,
          role: 'assistant',
          sender: { type: 'agent', id: 'agent_original' },
        },
      ],
      boundary: null,
    })

    await executeResume(ctx, session as never, 'user_1' as never)

    expect(inserts).toContainEqual({
      table: 'streams',
      fields: expect.objectContaining({
        processingMessageId: 'assistant_1',
      }),
    })
  })

  test('errors when there is no assistant message to resume', async () => {
    const { ctx, session } = resumeCtx({
      messages: [{ _id: 'user_1', role: 'user' }],
      boundary: null,
    })

    await expect(
      executeResume(ctx, session as never, 'user_1' as never),
    ).rejects.toThrow('No agent message to continue')
  })

  test('errors when the original agent is no longer linked', async () => {
    const { ctx, session } = resumeCtx({
      messages: [
        {
          _id: 'assistant_1',
          _creationTime: 20,
          role: 'assistant',
          sender: { type: 'agent', id: 'agent_original' },
        },
      ],
      boundary: null,
      sessionAgent: null,
    })

    await expect(
      executeResume(ctx, session as never, 'user_1' as never),
    ).rejects.toThrow('Original agent is not linked')
  })
})
