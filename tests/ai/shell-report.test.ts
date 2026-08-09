/// <reference types="bun-types" />
import {
  SHELL_REPORT_PREFIX,
  toShellReportBlock,
} from '@sb/convex/lib/shellReport'
import { INJECTED_BLOCK_PREFIXES } from '@sb/convex/lib/workspace'
import {
  _report,
  register,
  release,
  releaseForSession,
} from '@sb/convex/model/shellJobs'
import { stopForSession } from '@sb/convex/model/stream/lifecycle'
import { trackJob } from '@sb/convex/model/tool/shellTools'
import type { ShellToolOutput } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

const owner = 'user_1'
const agent = { _id: 'agent_coder', ownerId: owner, name: 'Coder' }

/**
 * Stateful db fake for the watch flows: `shellJobs` rows are matched on their
 * (sessionId, jobId) pair, everything else is looked up by id.
 */
function fakeCtx({
  docs = [],
  shellJobs = [],
  sessionAgents = [],
  streamsBySession = {},
}: {
  docs?: Row[]
  shellJobs?: Row[]
  sessionAgents?: Row[]
  streamsBySession?: Record<string, Row[]>
} = {}) {
  const inserts: Array<{ table: string; fields: Record<string, unknown> }> = []
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const deleted: string[] = []
  const scheduled: Array<{ args: unknown[] }> = []
  const cancelled: unknown[] = []
  const byId = new Map<string, Row>(
    [...docs, ...shellJobs].map((row) => [row._id, row]),
  )
  const jobs = [...shellJobs]

  const makeQuery = (table: string) => {
    const captured: Array<[string, unknown]> = []
    const q = {
      eq: (field: string, value: unknown) => {
        captured.push([field, value])
        return q
      },
      gt: () => q,
      lt: () => q,
      gte: () => q,
      lte: () => q,
    }
    const value = (field: string) =>
      captured.find(([name]) => name === field)?.[1]

    const chain = {
      withIndex: (_name: string, fn?: (query: typeof q) => unknown) => {
        fn?.(q)
        return chain
      },
      filter: () => chain,
      order: () => chain,
      take: async (n: number) => (await chain.collect()).slice(0, n),
      first: async () => (await chain.collect())[0] ?? null,
      unique: async () => (await chain.collect())[0] ?? null,
      collect: async (): Promise<Row[]> => {
        if (table === 'shellJobs') {
          const jobId = value('jobId')
          return jobs.filter(
            (row) =>
              row.sessionId === value('sessionId') &&
              (jobId === undefined || row.jobId === jobId),
          )
        }
        if (table === 'sessionAgents') return sessionAgents
        if (table === 'streams') {
          return streamsBySession[String(value('sessionId'))] ?? []
        }
        return []
      },
    }
    return chain
  }

  const ctx = {
    db: {
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
        const doc = byId.get(id)
        if (doc) Object.assign(doc, patch)
      },
      insert: async (table: string, fields: Record<string, unknown>) => {
        inserts.push({ table, fields })
        const id = `inserted_${table}_${inserts.length}`
        const row = { _id: id, ...fields }
        byId.set(id, row)
        if (table === 'shellJobs') jobs.push(row)
        return id
      },
      delete: async (id: string) => {
        deleted.push(id)
        byId.delete(id)
        const index = jobs.findIndex((row) => row._id === id)
        if (index >= 0) jobs.splice(index, 1)
      },
      query: (table: string) => makeQuery(table),
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduled.push({ args })
        return `job_${scheduled.length}`
      },
      cancel: async (jobId: unknown) => {
        cancelled.push(jobId)
      },
    },
  } as never

  return { ctx, inserts, patches, deleted, scheduled, cancelled, jobs }
}

const session = {
  _id: 'session_1',
  ownerId: owner,
  activeAgentId: 'agent_coder',
  workspace: { workspaceId: 'ws_1', label: 'ws' },
}

const agentLink = {
  _id: 'link_1',
  sessionId: 'session_1',
  agentId: 'agent_coder',
}

const registerArgs = {
  sessionId: 'session_1',
  agentId: 'agent_coder',
  invokedBy: owner,
  jobId: 'shell-1',
  command: 'bun run build',
  toolCallId: 'tc_1',
} as never

function watchRow(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: 'watch_1',
    sessionId: 'session_1',
    agentId: 'agent_coder',
    invokedBy: owner,
    jobId: 'shell-1',
    command: 'bun run build',
    toolCallId: 'tc_1',
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    term: '',
    termOffset: 0,
    watcherId: 'watcher_1',
    ...overrides,
  }
}

function output(overrides: Partial<ShellToolOutput> = {}): ShellToolOutput {
  return {
    jobId: 'shell-1',
    status: 'done',
    exitCode: 0,
    text: 'built in 12.4s',
    term: '',
    termOffset: 0,
    ...overrides,
  }
}

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

describe('_report', () => {
  test('delivers the output and wakes an idle agent', async () => {
    const { ctx, inserts, deleted, scheduled } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow()],
      sessionAgents: [agentLink],
    })

    await _report(ctx, { shellJobId: 'watch_1' as never, output: output() })

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
      operation: 'invoke',
      status: 'pending',
      contextBoundaryMessageId: 'inserted_messages_1',
    })
    expect(scheduled).toHaveLength(1)
  })

  test('does not wake a session with an active stream', async () => {
    const { ctx, inserts, scheduled } = fakeCtx({
      docs: [session, agent],
      shellJobs: [watchRow()],
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

    await _report(ctx, { shellJobId: 'watch_1' as never, output: output() })

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
      shellJobs: [watchRow()],
      sessionAgents: [agentLink],
    })

    await _report(ctx, {
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
      shellJobs: [watchRow()],
      sessionAgents: [agentLink],
    })

    await _report(ctx, {
      shellJobId: 'watch_1' as never,
      errorText: 'Local server is unreachable',
    })

    const content = inserts.find(({ table }) => table === 'messageContents')
    expect((content?.fields.parts as unknown[])[0]).toMatchObject({
      status: 'failed',
      text: 'Local server is unreachable',
    })
  })

  test('a released watch reports nothing', async () => {
    const { ctx, inserts } = fakeCtx({ docs: [session, agent] })

    await _report(ctx, { shellJobId: 'watch_1' as never, output: output() })

    expect(inserts).toHaveLength(0)
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
