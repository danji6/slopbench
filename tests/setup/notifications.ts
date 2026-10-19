export type Row = Record<string, unknown> & {
  _id: string
  _creationTime: number
}

export function fakeCtx(initial: Record<string, Row[]> = {}) {
  const tables = new Map(
    Object.entries(initial).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ]),
  )
  let sequence = 10_000

  const query = (table: string) => {
    const matches: Record<string, unknown> = {}
    let descending = false
    const chain = {
      withIndex: (_name: string, build?: (q: unknown) => unknown) => {
        const builder = {
          eq: (field: string, value: unknown) => {
            matches[field] = value
            return builder
          },
        }
        build?.(builder)
        return chain
      },
      order: (direction: string) => {
        descending = direction === 'desc'
        return chain
      },
      collect: async () => selected(),
      first: async () => selected()[0] ?? null,
      paginate: async ({
        cursor,
        numItems,
      }: {
        cursor: string | null
        numItems: number
      }) => {
        const start = Number(cursor ?? 0)
        const rows = selected()
        return {
          page: rows.slice(start, start + numItems),
          isDone: start + numItems >= rows.length,
          continueCursor: String(start + numItems),
        }
      },
      take: async (count: number) => selected().slice(0, count),
    }

    const selected = () => {
      const rows = (tables.get(table) ?? []).filter((row) =>
        Object.entries(matches).every(
          ([field, value]) =>
            field
              .split('.')
              .reduce<unknown>(
                (object, key) =>
                  (object as Record<string, unknown> | undefined)?.[key],
                row,
              ) === value,
        ),
      )
      if (!descending)
        return [...rows].sort((a, b) => a._creationTime - b._creationTime)
      return [...rows].sort(
        (a, b) =>
          Number(b.readAt ?? b._creationTime) -
            Number(a.readAt ?? a._creationTime) ||
          b._creationTime - a._creationTime,
      )
    }
    return chain
  }

  const ctx = {
    userId: 'user_1',
    db: {
      get: async (id: string) =>
        [...tables.values()].flat().find((row) => row._id === id) ?? null,
      query,
      insert: async (table: string, fields: Record<string, unknown>) => {
        const row = {
          _id: `${table}_${sequence}`,
          _creationTime: sequence++,
          ...fields,
        }
        const rows = tables.get(table) ?? []
        rows.push(row)
        tables.set(table, rows)
        return row._id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = [...tables.values()].flat().find((item) => item._id === id)
        if (row) Object.assign(row, patch)
      },
      delete: async (id: string) => {
        for (const [name, rows] of tables) {
          tables.set(
            name,
            rows.filter((row) => row._id !== id),
          )
        }
      },
    },
  } as never

  return {
    ctx,
    rows: (table: string) => tables.get(table) ?? [],
  }
}
