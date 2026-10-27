import { earliestUnconsumedMessage } from '@sb/convex/model/stream/lifecycle'
import { trackJob } from '@sb/convex/model/tool/shellTools'
import type { ShellToolOutput } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'
import { fakeCtx, output, owner } from '~/tests/helpers/shell-report'
import type { Row } from '~/tests/helpers/shell-report'

describe('earliestUnconsumedMessage', () => {
  const boundaryStream = {
    _id: 'stream_1',
    sessionId: 'session_1',
    contextBoundaryCreationTime: 0,
  } as never

  const message = (
    overrides: Record<string, unknown> & { _id: string },
  ): Row => ({
    sessionId: 'session_1',
    role: 'user',
    sender: { type: 'agent', id: 'agent_coder' },
    ...overrides,
  })

  test('looks past a user-killed report to the next candidate', async () => {
    const { ctx } = fakeCtx({
      messages: [
        message({
          _id: 'msg_killed',
          _creationTime: 10,
          extra: { userKilled: true },
        }),
        message({ _id: 'msg_report', _creationTime: 20 }),
      ],
    })

    const found = (await earliestUnconsumedMessage(
      ctx,
      boundaryStream,
    )) as Row | null

    expect(found?._id).toBe('msg_report')
  })

  test('never picks a user-killed report on its own', async () => {
    const { ctx } = fakeCtx({
      messages: [
        message({
          _id: 'msg_killed',
          _creationTime: 10,
          extra: { userKilled: true },
        }),
      ],
    })

    expect(await earliestUnconsumedMessage(ctx, boundaryStream)).toBeNull()
  })

  test('prefers the earliest of late user messages and reports', async () => {
    const { ctx } = fakeCtx({
      messages: [
        message({ _id: 'msg_report', _creationTime: 20 }),
        message({
          _id: 'msg_user',
          _creationTime: 5,
          sender: { type: 'user', id: owner },
        }),
      ],
    })

    const found = (await earliestUnconsumedMessage(
      ctx,
      boundaryStream,
    )) as Row | null

    expect(found?._id).toBe('msg_user')
  })
})

describe('trackJob', () => {
  function tracker() {
    const watched: unknown[] = []
    const released: string[] = []
    const context = {
      watchJob: async (job: unknown) => {
        watched.push(job)
      },
      releaseJob: async (jobId: string) => {
        released.push(jobId)
      },
    } as never
    return { context, watched, released }
  }

  async function* yields(...outputs: ShellToolOutput[]) {
    for (const value of outputs) yield value
  }

  const ref = { command: 'bun run build', toolCallId: 'tc_1' }

  test('passes every output through untouched', async () => {
    const { context } = tracker()
    const outputs = yields(output({ status: 'running' }), output())

    const seen = []
    for await (const value of trackJob(outputs, context, ref)) seen.push(value)

    expect(seen.map(({ status }) => status)).toEqual(['running', 'done'])
  })

  test('watches a job the call left running in the background', async () => {
    const { context, watched, released } = tracker()
    const outputs = yields(output({ status: 'background', text: '' }))

    for await (const _ of trackJob(outputs, context, ref));

    expect(watched).toEqual([
      { command: 'bun run build', toolCallId: 'tc_1', jobId: 'shell-1' },
    ])
    expect(released).toHaveLength(0)
  })

  test('releases a job the agent watched to its end itself', async () => {
    const { context, watched, released } = tracker()

    for await (const _ of trackJob(yields(output()), context, ref));

    expect(watched).toHaveLength(0)
    expect(released).toEqual(['shell-1'])
  })

  test('ignores a call that never got a job', async () => {
    const { context, watched, released } = tracker()
    const outputs = yields(output({ jobId: '', status: 'killed' }))

    for await (const _ of trackJob(outputs, context, ref));

    expect(watched).toHaveLength(0)
    expect(released).toHaveLength(0)
  })
})
