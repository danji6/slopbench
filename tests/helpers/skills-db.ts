import type { AuthMutationCtx } from '@sb/convex/functions'

type Row = Record<string, unknown> & { _id: string }

/** Minimal indexed database fixture for skill ownership, paging and transition behavior. */
export function skillsDatabase() {
  const tables = new Map<string, Row[]>()
  const scheduled: { reference: unknown; args: unknown }[] = []
  let sequence = 0
  function rows(table: string) {
    if (!tables.has(table)) {
      tables.set(table, [])
    }
    return tables.get(table)!
  }
  const db = {
    get: async (id: string) =>
      [...tables.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, fields: Record<string, unknown>) => {
      const id = `${table}_${++sequence}`
      rows(table).push({ _id: id, ...fields })
      return id
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const row = await db.get(id)
      if (!row) {
        throw new Error('Missing fixture row')
      }
      Object.assign(row, patch)
    },
    replace: async (id: string, fields: Record<string, unknown>) => {
      const row = await db.get(id)
      if (!row) throw new Error('Missing fixture row')
      for (const key of Object.keys(row)) {
        if (key !== '_id' && key !== '_creationTime') delete row[key]
      }
      Object.assign(row, fields)
    },
    delete: async (id: string) => {
      for (const entries of tables.values()) {
        const index = entries.findIndex((row) => row._id === id)
        if (index >= 0) {
          entries.splice(index, 1)
        }
      }
    },
    query: (table: string) => {
      const predicates: ((row: Row) => boolean)[] = []
      const index = {
        eq: (key: string, value: unknown) => {
          predicates.push(
            (row) =>
              key
                .split('.')
                .reduce<unknown>(
                  (value, segment) =>
                    value && typeof value === 'object'
                      ? (value as Record<string, unknown>)[segment]
                      : undefined,
                  row,
                ) === value,
          )
          return index
        },
        gte: (key: string, value: string) => {
          predicates.push((row) => String(row[key] ?? '') >= value)
          return index
        },
        lt: (key: string, value: string) => {
          predicates.push((row) => String(row[key] ?? '') < value)
          return index
        },
      }
      const selected = () =>
        rows(table)
          .filter((row) => predicates.every((predicate) => predicate(row)))
          .sort((a, b) =>
            String(a.name ?? '').localeCompare(String(b.name ?? '')),
          )
      const query = {
        withIndex: (
          _name: string,
          select: (range: typeof index) => unknown,
        ) => {
          select(index)
          return query
        },
        first: async () => selected()[0] ?? null,
        unique: async () => selected()[0] ?? null,
        take: async (count: number) => selected().slice(0, count),
        collect: async () => selected(),
        paginate: async ({
          cursor,
          numItems,
        }: {
          cursor: string | null
          numItems: number
        }) => {
          const offset = Number(cursor ?? 0)
          const items = selected()
          return {
            page: items.slice(offset, offset + numItems),
            continueCursor: String(offset + numItems),
            isDone: offset + numItems >= items.length,
          }
        },
      }
      return query
    },
  }
  const ctx = {
    db,
    role: 'admin',
    userId: 'owner',
    subject: 'owner',
    scheduler: {
      runAfter: async (_delay: number, reference: unknown, args: unknown) => {
        scheduled.push({ reference, args })
        return 'scheduled'
      },
    },
  } as unknown as AuthMutationCtx
  return { ctx, db, rows, scheduled }
}
