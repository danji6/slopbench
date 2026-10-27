import {
  markAllUserKilled,
  markUserKilled,
  register,
  release,
  releaseForSession,
} from '@sb/convex/model/shellJobs'
import { stopForSession } from '@sb/convex/model/stream/lifecycle'
import { describe, expect, test } from 'bun:test'
import {
  agent,
  fakeCtx,
  owner,
  registerArgs,
  session,
  watchRow,
} from '~/tests/helpers/shell-report'

describe('register', () => {
  test('inserts a watch and schedules its watcher', async () => {
    const { ctx, inserts, patches, scheduled } = fakeCtx()

    await register(ctx, registerArgs)

    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.fields).toMatchObject({
      sessionId: 'session_1',
      agentId: 'agent_coder',
      jobId: 'shell-1',
      command: 'bun run build',
      term: '',
      termOffset: 0,
    })
    expect(scheduled).toHaveLength(1)
    // The scheduled watcher is recorded so it can be cancelled later
    expect(patches[0]?.patch).toMatchObject({ watcherId: 'job_1' })
  })

  test('leaves a job that is already watched alone', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({ shellJobs: [watchRow()] })

    await register(ctx, registerArgs)

    expect(inserts).toHaveLength(0)
    expect(scheduled).toHaveLength(0)
  })
})

describe('release', () => {
  test('cancels the watcher and drops the row', async () => {
    const { ctx, deleted, cancelled } = fakeCtx({ shellJobs: [watchRow()] })

    await release(ctx, { sessionId: 'session_1' as never, jobId: 'shell-1' })

    expect(cancelled).toEqual(['watcher_1'])
    expect(deleted).toEqual(['watch_1'])
  })

  test('ignores a job nobody is watching', async () => {
    const { ctx, deleted } = fakeCtx({ shellJobs: [watchRow()] })

    await release(ctx, { sessionId: 'session_1' as never, jobId: 'shell-9' })

    expect(deleted).toHaveLength(0)
  })

  test('releaseForSession drops every watch of a torn down session', async () => {
    const { ctx, deleted } = fakeCtx({
      shellJobs: [
        watchRow(),
        watchRow({ _id: 'watch_2', jobId: 'shell-2', watcherId: 'watcher_2' }),
        watchRow({ _id: 'watch_3', sessionId: 'session_2' }),
      ],
    })

    await releaseForSession(ctx, 'session_1' as never)

    expect(deleted).toEqual(['watch_1', 'watch_2'])
  })
})

describe('stopForSession', () => {
  /**
   * Tearing a session down leaves nothing to hand a job's output to, so the
   * watch goes and the job itself is swept — background ones included, which
   * a stopped turn deliberately leaves running.
   */
  test('drops the watches and kills the jobs behind them', async () => {
    const { ctx, deleted, cancelled, scheduled } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow()],
    })

    await stopForSession(ctx, 'session_1' as never)

    expect(cancelled).toEqual(['watcher_1'])
    expect(deleted).toEqual(['watch_1'])

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.args[2]).toMatchObject({
      sessionId: 'session_1',
      owner: 'session_1',
      includeBackground: true,
    })
  })
})

describe('markUserKilled', () => {
  test('marks the watched job of the session', async () => {
    const { ctx, patches } = fakeCtx({
      docs: [session],
      shellJobs: [watchRow()],
    })

    await markUserKilled(ctx, {
      sessionId: session._id as never,
      jobId: 'shell-1',
    })

    expect(patches).toEqual([{ id: 'watch_1', patch: { userKilled: true } }])
  })

  test('reaches jobs owned by a sub-agent child session', async () => {
    const child = {
      _id: 'session_child',
      ownerId: owner,
      parent: { sessionId: 'session_1' },
    }
    const { ctx, patches } = fakeCtx({
      docs: [session, child],
      shellJobs: [{ ...watchRow(), sessionId: 'session_child' }],
    })

    await markUserKilled(ctx, {
      sessionId: session._id as never,
      jobId: 'shell-1',
    })

    expect(patches).toEqual([{ id: 'watch_1', patch: { userKilled: true } }])
  })
})

describe('markAllUserKilled', () => {
  test('marks every watched job of the session and its children', async () => {
    const child = {
      _id: 'session_child',
      ownerId: owner,
      parent: { sessionId: 'session_1' },
    }
    const { ctx, patches } = fakeCtx({
      docs: [session, child],
      shellJobs: [
        watchRow(),
        {
          ...watchRow({ jobId: 'shell-2', toolCallId: 'tc_2' }),
          _id: 'watch_2',
          sessionId: 'session_child',
        },
      ],
    })

    await markAllUserKilled(ctx, { sessionId: session._id as never })

    expect(patches).toEqual([
      { id: 'watch_1', patch: { userKilled: true } },
      { id: 'watch_2', patch: { userKilled: true } },
    ])
  })
})
