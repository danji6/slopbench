type Row = Record<string, unknown> & { _id: string }

/** Models indexed lifecycle records, scheduling, and storage cleanup. */
export function lifecycleDatabase(seed: Record<string, Row[]> = {}) {
  const tables = new Map(Object.entries(seed))
  const scheduled: { args: Record<string, unknown>; at: number }[] = []
  const cancelled: unknown[] = []
  const deletedStorage: string[] = []
  let sequence = 0
  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table)!
  }
  const get = async (id: string) =>
    [...tables.values()].flat().find((row) => row._id === id) ?? null
  const ctx = {
    db: {
      get,
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = await get(id)
        if (!row) throw new Error('Missing fixture row')
        Object.assign(row, patch)
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${++sequence}`
        rows(table).push({ _id: id, ...value })
        return id
      },
      delete: async (id: string) => {
        for (const entries of tables.values()) {
          const index = entries.findIndex((row) => row._id === id)
          if (index >= 0) entries.splice(index, 1)
        }
      },
      query: (table: string) => {
        const predicates: ((row: Row) => boolean)[] = []
        const field = (row: Row, key: string) =>
          key
            .split('.')
            .reduce<unknown>((value, key) => (value as Row)?.[key], row)
        const range = {
          eq: (key: string, value: unknown) => {
            predicates.push((row) => field(row, key) === value)
            return range
          },
          lt: (key: string, value: number) => {
            predicates.push((row) => Number(field(row, key)) < value)
            return range
          },
        }
        const selected = () =>
          rows(table).filter((row) =>
            predicates.every((predicate) => predicate(row)),
          )
        const query = {
          withIndex: (
            _name: string,
            select?: (index: typeof range) => unknown,
          ) => {
            select?.(range)
            return query
          },
          collect: async () => selected(),
          first: async () => selected()[0] ?? null,
          unique: async () => selected()[0] ?? null,
          order: () => query,
          take: async (count: number) => selected().slice(0, count),
        }
        return query
      },
    },
    scheduler: {
      runAfter: async (
        delay: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ args, at: Date.now() + delay })
        return `job_${scheduled.length}`
      },
      runAt: async (
        at: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ args, at })
        return `job_${scheduled.length}`
      },
      cancel: async (id: unknown) => {
        cancelled.push(id)
      },
    },
    storage: {
      delete: async (id: string) => {
        deletedStorage.push(id)
      },
    },
  }
  return { ctx: ctx as never, rows, scheduled, cancelled, deletedStorage }
}
