export type Row = Record<string, unknown> & { _id: string }

/**
 * Minimal stateful db fake: patches merge into the docs so read-after-write
 * matches Convex semantics; `contents` backs messageContents queries.
 */
export function fakeCtx({
  docs = [],
  contents = [],
  firstMessage = null,
  settings = null,
  deliveries = [],
}: {
  docs?: Row[]
  contents?: Row[]
  /** Result of `messages` index first() lookups (boundary/newer/latest). */
  firstMessage?: Row | null
  settings?: Row | null
  deliveries?: Row[]
}) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; fields: Record<string, unknown> }> = []
  const deletes: string[] = []
  const scheduled: Array<{ args: unknown[] }> = []
  const deletedBlobs: string[] = []

  const rows = [...contents]
  const deliveryRows = [...deliveries]
  for (const row of docs) {
    if (row._id.includes('stream')) row.generation ??= 0
  }
  const byId = new Map<string, Row>(
    [...docs, ...rows, ...deliveryRows].map((row) => [row._id, row]),
  )

  // Enough of a filter builder to evaluate the guards the model applies
  const filterFor = (row: Row) => ({
    field: (name: string) => row[name],
    eq: (a: unknown, b: unknown) => a === b,
    neq: (a: unknown, b: unknown) => a !== b,
    and: (...conditions: boolean[]) => conditions.every(Boolean),
  })

  const makeQuery = (table: string) => {
    const matches = new Map<string, unknown>()
    const index = {
      eq: (key: string, value: unknown) => {
        matches.set(key, value)
        return index
      },
    }
    const matchingDeliveries = () =>
      deliveryRows.filter((row) =>
        [...matches].every(([key, value]) => row[key] === value),
      )
    const predicates: Array<(q: ReturnType<typeof filterFor>) => boolean> = []
    const chain = {
      withIndex: (_name: string, fn?: (query: typeof index) => unknown) => {
        if (table === 'shellOutputDeliveries') fn?.(index)
        return chain
      },
      order: () => chain,
      filter: (next: (q: ReturnType<typeof filterFor>) => boolean) => {
        predicates.push(next)
        return chain
      },
      first: async () => {
        if (table === 'mcpOperations') return null
        if (table === 'messageContents') return rows[rows.length - 1] ?? null
        if (
          firstMessage &&
          !predicates.every((predicate) => predicate(filterFor(firstMessage)))
        ) {
          return null
        }
        return firstMessage
      },
      unique: async () =>
        table === 'shellOutputDeliveries'
          ? (matchingDeliveries()[0] ?? null)
          : table === 'settings'
            ? settings
            : table === 'sessionState'
              ? ([...byId.values()].find(
                  (row) => row.sessionId === 'session_1' && 'updatedAt' in row,
                ) ?? null)
              : null,
      collect: async () =>
        table === 'shellOutputDeliveries'
          ? matchingDeliveries()
          : table === 'messageContents'
            ? rows
            : [],
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
        const id = `inserted_${inserts.length}`
        const row = { _id: id, ...fields }
        byId.set(id, row)
        if (table === 'messageContents') rows.push(row)
        if (table === 'shellOutputDeliveries') deliveryRows.push(row)
        return id
      },
      delete: async (id: string) => {
        deletes.push(id)
        byId.delete(id)
        const delivery = deliveryRows.findIndex((row) => row._id === id)
        if (delivery >= 0) deliveryRows.splice(delivery, 1)
      },
      query: (table: string) => makeQuery(table),
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => {
        scheduled.push({ args })
        return `job_${scheduled.length}`
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedBlobs.push(id)
      },
    },
  } as never

  return { ctx, patches, inserts, deletes, scheduled, deletedBlobs }
}
