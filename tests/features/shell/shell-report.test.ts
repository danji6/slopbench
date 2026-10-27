import {
  SHELL_REPORT_PREFIX,
  toShellReportBlock,
} from '@sb/convex/lib/shellReport'
import { INJECTED_BLOCK_PREFIXES } from '@sb/convex/lib/workspace'
import { _report } from '@sb/convex/model/shellJobs'
import { describe, expect, test } from 'bun:test'
import {
  agent,
  agentLink,
  fakeCtx,
  output,
  owner,
  session,
  watchRow,
} from '~/tests/helpers/shell-report'

describe('_report', () => {
  test('delivers the output and wakes an idle agent', async () => {
    const { ctx, inserts, deleted, scheduled } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow({ watcherId: undefined })],
      sessionAgents: [agentLink],
    })

    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      output: output(),
    })

    expect(deleted).toEqual(['watch_1'])

    // The report lands in the session as its own done user turn
    const message = inserts.find(({ table }) => table === 'messages')
    expect(message?.fields).toMatchObject({
      sessionId: 'session_1',
      role: 'user',
      status: 'done',
      sender: { type: 'agent', id: 'agent_coder' },
    })
    const content = inserts.find(({ table }) => table === 'messageContents')
    expect(content?.fields.parts).toEqual([
      {
        type: 'shell-report',
        jobId: 'shell-1',
        command: 'bun run build',
        status: 'done',
        exitCode: 0,
        text: 'built in 12.4s',
      },
    ])

    // Idle session wakes: a fresh invoke turn bounded by the report message
    const stream = inserts.find(({ table }) => table === 'streams')
    expect(stream?.fields).toMatchObject({
      sessionId: 'session_1',
      agentId: 'agent_coder',
      invokedBy: owner,
      contextBoundaryMessageId: 'inserted_messages_1',
      command: { kind: 'invoke' },
      state: { phase: 'reserved' },
    })
    expect(scheduled).toHaveLength(1)
  })

  test('does not wake a session with an active stream', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow({ watcherId: undefined })],
      sessionAgents: [agentLink],
      streamsBySession: {
        session_1: [
          {
            _id: 'stream_1',
            sessionId: 'session_1',
            leaseExpiresAt: Date.now() + 60_000,
          },
        ],
      },
    })

    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      output: output(),
    })

    // Report only; the running turn picks it up via the follow-up gate
    expect(inserts.map(({ table }) => table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(scheduled).toHaveLength(0)
  })

  test('reports a killed job with its outcome', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow({ watcherId: undefined })],
      sessionAgents: [agentLink],
    })

    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      output: output({
        status: 'killed',
        exitCode: null,
        text: 'partial\n(command was killed)',
      }),
    })

    const content = inserts.find(({ table }) => table === 'messageContents')
    expect((content?.fields.parts as unknown[])[0]).toMatchObject({
      status: 'killed',
      text: 'partial\n(command was killed)',
    })
    expect(
      (content?.fields.parts as [{ exitCode?: number }])[0].exitCode,
    ).toBeUndefined()
  })

  test('a watcher failure still reports back', async () => {
    const { ctx, inserts } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow({ watcherId: undefined })],
      sessionAgents: [agentLink],
    })

    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      errorText: 'Local server is unreachable',
    })

    const content = inserts.find(({ table }) => table === 'messageContents')
    expect((content?.fields.parts as unknown[])[0]).toMatchObject({
      status: 'failed',
      text: 'Local server is unreachable',
    })
  })

  test('removes a watch without reporting when its session was deleted', async () => {
    const { ctx, inserts, deleted, scheduled } = fakeCtx({
      shellJobs: [watchRow({ watcherId: undefined })],
    })
    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      output: output(),
    })
    expect(deleted).toEqual(['watch_1'])
    expect(inserts).toEqual([])
    expect(scheduled).toEqual([])
  })

  test.each([
    {
      result: output({ text: 'x'.repeat(32 * 1024 + 1) }),
      expected: {
        status: 'done',
        text: 'x'.repeat(32 * 1024) + '\n\n[Output truncated.]',
      },
    },
    {
      result: output({ text: '' }),
      expected: { status: 'done', text: '(no output)' },
    },
    { result: output({ status: 'running' }), expected: { status: 'failed' } },
    {
      result: output({ status: 'background' }),
      expected: { status: 'failed' },
    },
    {
      result: undefined,
      expected: { status: 'failed', text: 'The job produced no result.' },
    },
  ])(
    'preserves report normalization for case $#',
    async ({ result, expected }) => {
      const { ctx, inserts } = fakeCtx({
        docs: [session, agent],
        shellJobs: [watchRow({ watcherId: undefined, userKilled: true })],
      })
      await _report(ctx, {
        generation: 0,
        shellJobId: 'watch_1' as never,
        output: result,
      })
      const content = inserts.find(({ table }) => table === 'messageContents')
      expect((content?.fields.parts as unknown[])[0]).toMatchObject(expected)
    },
  )

  test('a released watch reports nothing', async () => {
    const { ctx, inserts } = fakeCtx({ docs: [session, agent] })

    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      output: output(),
    })

    expect(inserts).toHaveLength(0)
  })

  test('a user-killed job leaves its report but never wakes the agent', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow({ userKilled: true, watcherId: undefined })],
      sessionAgents: [agentLink],
    })

    await _report(ctx, {
      generation: 0,
      shellJobId: 'watch_1' as never,
      output: output({ status: 'killed', exitCode: null }),
    })

    // The report is tagged so turn logic looks past it
    const message = inserts.find(({ table }) => table === 'messages')
    expect(message?.fields.extra).toEqual({ userKilled: true })

    expect(inserts.some(({ table }) => table === 'streams')).toBe(false)
    expect(scheduled).toHaveLength(0)
  })
})

describe('toShellReportBlock', () => {
  test('renders the command and output as one attributed block', () => {
    const text = toShellReportBlock({
      type: 'shell-report',
      jobId: 'shell-1',
      command: 'bun run build',
      status: 'done',
      exitCode: 0,
      text: 'built in 12.4s',
    })

    expect(text.startsWith(SHELL_REPORT_PREFIX)).toBe(true)
    expect(text).toContain('job="shell-1"')
    expect(text).toContain('status="done"')
    expect(text).toContain('exit-code="0"')
    expect(text).toContain('$ bun run build')
    expect(text).toContain('built in 12.4s')
  })

  test('is treated as injected context, not agent speech', () => {
    expect(INJECTED_BLOCK_PREFIXES).toContain(SHELL_REPORT_PREFIX)
  })
})
