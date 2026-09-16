export type Row = Record<string, unknown> & { _id: string }

/**
 * Stateful db fake tuned for the sub-agent flows: patches merge into docs,
 * inserts land in `byId`, and index queries capture the messageId filter so
 * per-message content lookups work.
 */
export function fakeCtx({
  docs = [],
  agents = [],
  modelProviders = [],
  plans = [],
  sessionAgents = [],
  contentsByMessage = {},
  sessionsByParent = {},
  streamsBySession = {},
  membershipsBySession = {},
  sessionStates = [],
}: {
  docs?: Row[]
  /** Rows returned by the owner's agents index scan. */
  agents?: Row[]
  modelProviders?: Row[]
  /** Rows returned by the plans index scan. */
  plans?: Row[]
  /** Rows returned by the sessionAgents index scan. */
  sessionAgents?: Row[]
  contentsByMessage?: Record<string, Row[]>
  /** Child session rows keyed by parent.sessionId. */
  sessionsByParent?: Record<string, Row[]>
  /** Stream rows keyed by sessionId. */
  streamsBySession?: Record<string, Row[]>
  /** userSessions rows keyed by sessionId. */
  membershipsBySession?: Record<string, Row[]>
  /** sessionState rows, matched on their `sessionId`. */
  sessionStates?: Row[]
}) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; fields: Record<string, unknown> }> = []
  const scheduled: Array<{ args: unknown[] }> = []
  const cancelled: unknown[] = []
  const byId = new Map<string, Row>(docs.map((row) => [row._id, row]))

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
      collect: async () => {
        if (table === 'agents') return agents
        if (table === 'modelProviders') {
          const owner = captured.find(([field]) => field === 'ownerId')
          return modelProviders.filter((row) => row.ownerId === owner?.[1])
        }
        if (table === 'plans') return plans
        if (table === 'sessionAgents') return sessionAgents
        if (table === 'messageContents') {
          const messageId = captured.find(([field]) => field === 'messageId')
          return messageId
            ? (contentsByMessage[String(messageId[1])] ?? [])
            : []
        }
        if (table === 'sessions') {
          const parent = captured.find(
            ([field]) => field === 'parent.sessionId',
          )
          return parent ? (sessionsByParent[String(parent[1])] ?? []) : []
        }
        if (table === 'streams') {
          const sessionId = captured.find(([field]) => field === 'sessionId')
          return sessionId ? (streamsBySession[String(sessionId[1])] ?? []) : []
        }
        if (table === 'userSessions') {
          const sessionId = captured.find(([field]) => field === 'sessionId')
          const userId = captured.find(([field]) => field === 'userId')
          const members = sessionId
            ? (membershipsBySession[String(sessionId[1])] ?? [])
            : []
          return userId
            ? members.filter((row) => row.userId === userId[1])
            : members
        }
        if (table === 'sessionState') {
          const sessionId = captured.find(([field]) => field === 'sessionId')
          return sessionStates.filter((row) => row.sessionId === sessionId?.[1])
        }
        return []
      },
    }
    return chain
  }

  const ctx = {
    userId: 'user_1',
    role: 'admin',
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
        byId.set(id, { _id: id, ...fields })
        return id
      },
      delete: async () => {},
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

  return { ctx, patches, inserts, scheduled, cancelled, byId }
}
