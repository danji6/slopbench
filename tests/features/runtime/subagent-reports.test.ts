import { settleAbandonedTaskParts } from '@sb/convex/lib/subagent'
import { deliverChildReport } from '@sb/convex/model/stream/subagents'
import { describe, expect, test } from 'bun:test'
import {
  childStream1,
  coderLink,
  owner,
  reportDocs,
  taskPart,
} from '~/tests/helpers/subagent-lifecycle'
import { fakeCtx } from '~/tests/setup/subagents'

describe('deliverChildReport', () => {
  test('delivers the report and wakes an idle parent', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          {
            _id: 'cc_1',
            parts: [{ type: 'text', text: 'Found it in config.ts' }],
          },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    // The report lands in the parent session as its own done user turn
    const report = inserts.find(({ table }) => table === 'messages')
    expect(report?.fields).toMatchObject({
      sessionId: 'parent_session',
      role: 'user',
      status: 'done',
      sender: { type: 'agent', id: 'agent_explorer' },
    })
    const content = inserts.find(({ table }) => table === 'messageContents')
    expect(content?.fields.parts).toEqual([
      {
        type: 'subagent-report',
        sessionId: 'child_session_1',
        agentName: 'Explore',
        title: 'Find config',
        status: 'complete',
        text: 'Found it in config.ts',
      },
    ])

    // Idle parent wakes: a fresh invoke turn bounded by the report message
    const invoke = inserts.find(({ table }) => table === 'streams')
    expect(invoke?.fields).toMatchObject({
      sessionId: 'parent_session',
      agentId: 'agent_coder',
      invokedBy: owner,
      contextBoundaryMessageId: 'inserted_messages_1',
      command: { kind: 'invoke' },
      state: { phase: 'reserved' },
    })
    expect(scheduled).toHaveLength(1)
  })

  test('does not wake a parent with an active stream', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      streamsBySession: {
        parent_session: [
          {
            _id: 'parent_stream',
            sessionId: 'parent_session',
            leaseExpiresAt: Date.now() + 60_000,
          },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    // Report only; the running turn picks it up via the follow-up gate
    expect(inserts.map(({ table }) => table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(scheduled).toHaveLength(0)
  })

  test('cascade-stopped children deliver nothing', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
    })

    await deliverChildReport(
      ctx,
      { ...(childStream1 as object), suppressReport: true } as never,
      { kind: 'stopped' },
    )

    expect(inserts).toHaveLength(0)
    expect(scheduled).toHaveLength(0)
  })

  test('no-ops when the parent session is gone', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs().filter((doc) => doc._id !== 'parent_session'),
      sessionAgents: [coderLink],
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    expect(inserts).toHaveLength(0)
  })

  test('a failed child reports the failure', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
    })

    await deliverChildReport(ctx, childStream1, {
      kind: 'failed',
      message: 'boom',
    })

    const content = inserts.find(({ table }) => table === 'messageContents')
    expect((content?.fields.parts as unknown[])[0]).toMatchObject({
      type: 'subagent-report',
      status: 'failed',
      text: 'Sub-agent failed: boom',
    })
  })

  test('a stopped child reports with a stopped note', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          { _id: 'cc_1', parts: [{ type: 'text', text: 'Partial findings' }] },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'stopped' })

    const content = inserts.find(({ table }) => table === 'messageContents')
    const part = (
      content?.fields.parts as { status: string; text: string }[]
    )[0]!
    expect(part.status).toBe('stopped')
    expect(part.text.includes('Partial findings')).toBe(true)
    expect(part.text.includes('stopped before finishing')).toBe(true)
  })

  test('long reports are truncated under the split budget', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          { _id: 'cc_1', parts: [{ type: 'text', text: 'y'.repeat(40_000) }] },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    const content = inserts.find(({ table }) => table === 'messageContents')
    const text = (content?.fields.parts as { text: string }[])[0]!.text
    expect(text.length).toBeLessThan(33_000)
    expect(text).toContain('[Report truncated.')
  })

  test('reports only the concluding text, dropping interstitial narration', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: reportDocs(),
      sessionAgents: [coderLink],
      contentsByMessage: {
        child_message_1: [
          {
            _id: 'cc_1',
            parts: [
              { type: 'text', text: 'Let me check the config.' },
              { type: 'tool-read_file', state: 'output-available' },
              { type: 'text', text: 'Now searching for usages.' },
              { type: 'tool-shell', state: 'output-available' },
              { type: 'text', text: '## Report' },
              { type: 'text', text: 'It lives in config.ts.' },
            ],
          },
        ],
      },
    })

    await deliverChildReport(ctx, childStream1, { kind: 'complete' })

    const content = inserts.find(({ table }) => table === 'messageContents')
    const text = (content?.fields.parts as { text: string }[])[0]!.text
    // The trailing run of text parts is kept in full...
    expect(text).toBe('## Report\n\nIt lives in config.ts.')
    // ...and the narration before the last tool call is dropped.
    expect(text.includes('Let me check')).toBe(false)
    expect(text.includes('Now searching')).toBe(false)
  })
})

describe('settleAbandonedTaskParts', () => {
  test('settles unspawned task calls with an abandoned note', () => {
    const settled = settleAbandonedTaskParts([
      taskPart(),
      { type: 'text', text: 'hi' },
    ])!

    expect(settled[0]).toMatchObject({
      state: 'output-available',
      output: '[The turn ended before the sub-agent could be started.]',
    })
    expect(settled[1]).toEqual({ type: 'text', text: 'hi' })
  })

  test('returns null when nothing is unsettled', () => {
    expect(
      settleAbandonedTaskParts([
        taskPart({ state: 'output-available', output: 'done' }),
        { type: 'text', text: 'hi' },
      ]),
    ).toBeNull()
  })
})
