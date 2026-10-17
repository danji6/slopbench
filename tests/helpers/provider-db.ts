import type { AuthMutationCtx } from '@sb/convex/functions'

/** An indexed in-memory database for testing catalog commits and credential ownership together. */
export function providerFixture() {
  type Row = Record<string, unknown> & { _id: string }
  const tables = new Map<string, Row[]>()
  let sequence = 0
  const find = (id: string) =>
    [...tables.values()].flat().find((row) => row._id === id)
  const ctx = {
    userId: 'owner',
    scheduler: { runAfter: async () => 'scheduled' },
    db: {
      delete: async (id: string) => {
        for (const [table, rows] of tables)
          tables.set(
            table,
            rows.filter((row) => row._id !== id),
          )
      },
      get: async (id: string) => find(id) ?? null,
      patch: async (id: string, fields: Record<string, unknown>) => {
        Object.assign(find(id)!, fields)
      },
      insert: async (table: string, fields: Record<string, unknown>) => {
        const rows = tables.get(table) ?? []
        const id = `${table}-${sequence++}`
        rows.push({ ...fields, _id: id })
        tables.set(table, rows)
        return id
      },
      query: (table: string) => {
        const conditions: [string, unknown][] = []
        const q = {
          eq: (field: string, value: unknown) => {
            conditions.push([field, value])
            return q
          },
        }
        const chain = {
          withIndex: (_name: string, filter: (q: unknown) => void) => {
            filter(q)
            return chain
          },
          order: () => chain,
          collect: async () =>
            (tables.get(table) ?? []).filter((row) =>
              conditions.every(([key, value]) => row[key] === value),
            ),
          take: async (count: number) =>
            (await chain.collect()).slice(0, count),
          unique: async () => (await chain.collect())[0] ?? null,
        }
        return chain
      },
    },
  } as unknown as AuthMutationCtx
  return { ctx, tables, find }
}
