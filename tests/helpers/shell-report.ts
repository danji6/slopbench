import type { ShellToolOutput } from '@sb/convex/types'

export type Row = Record<string, unknown> & { _id: string }

export const owner = 'user_1'

export const agent = { _id: 'agent_coder', ownerId: owner, name: 'Coder' }

/**
 * Stateful db fake for the watch flows: `shellJobs` rows are matched on their
 * (sessionId, jobId) pair, everything else is looked up by id.
 */
export function fakeCtx({
  docs = [],
  shellJobs = [],
  sessionAgents = [],
  streamsBySession = {},
  messages = [],
}: {
  docs?: Row[]
  shellJobs?: Row[]
  sessionAgents?: Row[]
  streamsBySession?: Record<string, Row[]>
  messages?: Row[]
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

  // Enough of a filter builder to evaluate the guards turn logic applies
  const filterFor = (row: Row) => ({
    field: (path: string) =>
      path
        .split('.')
        .reduce<unknown>(
          (acc, key) =>
            acc && typeof acc === 'object' ? (acc as Row)[key] : undefined,
          row,
        ),
    eq: (a: unknown, b: unknown) => a === b,
    neq: (a: unknown, b: unknown) => a !== b,
  })

  const makeQuery = (table: string) => {
    const captured: Array<[string, unknown]> = []
    const predicates: Array<(q: ReturnType<typeof filterFor>) => boolean> = []
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
      filter: (next: (q: ReturnType<typeof filterFor>) => boolean) => {
        predicates.push(next)
        return chain
      },
      order: () => chain,
      take: async (n: number) => (await chain.collect()).slice(0, n),
      first: async () => (await chain.collect())[0] ?? null,
      unique: async () => (await chain.collect())[0] ?? null,
      collect: async (): Promise<Row[]> => {
        let matched: Row[] = []
        if (table === 'shellJobs') {
          const jobId = value('jobId')
          matched = jobs.filter(
            (row) =>
              row.sessionId === value('sessionId') &&
              (jobId === undefined || row.jobId === jobId),
          )
        } else if (table === 'sessionAgents') {
          matched = sessionAgents
        } else if (table === 'streams') {
          matched = streamsBySession[String(value('sessionId'))] ?? []
        } else if (table === 'messages') {
          matched = messages.filter(
            (row) => row.sessionId === value('sessionId'),
          )
          const senderType = value('sender.type')
          if (senderType !== undefined) {
            matched = matched.filter(
              (row) => (row.sender as Row | undefined)?.type === senderType,
            )
          }
          matched.sort(
            (a, b) => Number(a._creationTime) - Number(b._creationTime),
          )
        } else if (table === 'sessions') {
          matched = docs.filter(
            (row) =>
              (row.parent as Row | undefined)?.sessionId ===
              value('parent.sessionId'),
          )
        }
        return matched.filter((row) =>
          predicates.every((predicate) => predicate(filterFor(row))),
        )
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

export const session = {
  _id: 'session_1',
  ownerId: owner,
  activeAgentId: 'agent_coder',
  workspace: { workspaceId: 'ws_1', label: 'ws' },
}

export const agentLink = {
  _id: 'link_1',
  sessionId: 'session_1',
  agentId: 'agent_coder',
}

export const registerArgs = {
  sessionId: 'session_1',
  agentId: 'agent_coder',
  invokedBy: owner,
  jobId: 'shell-1',
  command: 'bun run build',
  toolCallId: 'tc_1',
} as never

export function watchRow(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: 'watch_1',
    generation: 0,
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

export function output(
  overrides: Partial<ShellToolOutput> = {},
): ShellToolOutput {
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
