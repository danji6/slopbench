/// <reference types="bun-types" />
import { resolve } from '@sb/convex/model/appearances'
import type { ThemeSnapshot } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string; hash: string }

function makeCtx() {
  const rows: Row[] = []
  let nextId = 1

  const ctx = {
    db: {
      insert: async (_table: string, doc: Record<string, unknown>) => {
        const _id = `appearances_${nextId++}`
        rows.push({ ...doc, _id } as Row)
        return _id
      },
      query: () => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          let hash: string | undefined
          const q = {
            eq: (_field: string, value: string) => {
              hash = value
              return q
            },
          }
          build(q)
          return {
            first: async () => rows.find((row) => row.hash === hash) ?? null,
          }
        },
      }),
    },
  } as never

  return { ctx, rows }
}

const theme = (source: string): ThemeSnapshot => ({
  source,
  light: { primary: '#fff', surface: '#eee' },
  dark: { primary: '#000', surface: '#111' },
})

describe('appearance interning', () => {
  test('two senders with the same look share one row', async () => {
    const { ctx, rows } = makeCtx()

    const first = await resolve(ctx, { css: '.a {}', theme: theme('#123456') })
    const second = await resolve(ctx, { css: '.a {}', theme: theme('#123456') })

    expect(rows).toHaveLength(1)
    expect(second).toBe(first!)
  })

  test('key order does not change the hash', async () => {
    const { ctx, rows } = makeCtx()

    await resolve(ctx, {
      theme: {
        source: '#123456',
        dark: { surface: '#111', primary: '#000' },
        light: { surface: '#eee', primary: '#fff' },
      },
    })
    await resolve(ctx, { theme: theme('#123456') })

    expect(rows).toHaveLength(1)
  })

  test('a different look gets its own row', async () => {
    const { ctx, rows } = makeCtx()

    await resolve(ctx, { css: '.a {}', theme: theme('#123456') })
    await resolve(ctx, { css: '.b {}', theme: theme('#123456') })
    await resolve(ctx, { css: '.a {}', theme: theme('#654321') })

    expect(rows).toHaveLength(3)
  })

  test('an empty look interns nothing', async () => {
    const { ctx, rows } = makeCtx()

    expect(await resolve(ctx, {})).toBeUndefined()
    expect(await resolve(ctx, { css: undefined })).toBeUndefined()
    expect(rows).toEqual([])
  })
})
