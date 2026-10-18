export type Row = Record<string, unknown> & { _id: string }
type Predicate = (row: Row) => boolean

/** Applies indexed constraints and visibility filters before slicing pages. */
function indexedRows(rows: Row[], build?: (q: unknown) => unknown) {
  const predicates: Predicate[] = []
  const q = {
    eq: (field: string, value: unknown) => {
      predicates.push((row) => row[field] === value)
      return q
    },
    search: (field: string, term: string) => {
      predicates.push((row) =>
        String(row[field] ?? '')
          .toLowerCase()
          .includes(term.toLowerCase()),
      )
      return q
    },
  }
  build?.(q)
  const matches = () => rows.filter((row) => predicates.every((p) => p(row)))
  const result = {
    order: () => {
      rows = [...rows].sort(
        (a, b) => Number(b.lastMessageAt ?? 0) - Number(a.lastMessageAt ?? 0),
      )
      return result
    },
    filter: (predicate: (q: unknown) => Predicate) => {
      predicates.push(
        predicate({
          field: (field: string) => field,
          neq: (field: string, value: unknown) => (row: Row) =>
            row[field] !== value,
        }),
      )
      return result
    },
    collect: async () => matches(),
    unique: async () => matches()[0] ?? null,
    paginate: async (options: { cursor: string | null; numItems: number }) => {
      const found = matches()
      const start = Number(options.cursor ?? 0)
      const end = Math.min(start + options.numItems, found.length)
      return {
        page: found.slice(start, end),
        isDone: end === found.length,
        continueCursor: String(end),
      }
    },
  }
  return result
}

/** Resolves indexed reads across tables without leaking full session documents. */
export function makeCtx(tables: Record<string, Row[]>, queries: string[] = []) {
  const find = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id)

  return {
    userId: 'user_1',
    db: {
      get: async (id: string) => find(id) ?? null,
      query: (table: string) => ({
        withIndex: (index: string, build?: (q: unknown) => unknown) => {
          queries.push(`${table}:${index}`)
          return indexedRows(tables[table] ?? [], build)
        },
        withSearchIndex: (index: string, build: (q: unknown) => unknown) => {
          queries.push(`${table}:${index}`)
          return indexedRows(tables[table] ?? [], build)
        },
      }),
    },
  } as never
}
