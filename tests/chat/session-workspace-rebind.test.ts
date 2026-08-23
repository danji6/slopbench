/// <reference types="bun-types" />
import type { Id } from '@sb/convex/_generated/dataModel'
import { duplicateSession } from '@sb/convex/actions/session/workspace'
import { afterEach, describe, expect, test } from 'bun:test'

const SIDECAR = 'http://sidecar.test'

type Call = { ref: unknown; args?: unknown }

/**
 * Action ctx stub. The queries here are answered positionally in the order
 * duplicateSession issues them: source lookup, admin role check, then the new
 * session's (empty) workspace context.
 */
function makeActionCtx(source: Record<string, unknown> | null) {
  const queries: unknown[] = [source, 'admin', {}]
  const mutations: Call[] = []

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: 'sub_1', name: 'Admin' }),
    },
    runQuery: async () => {
      const next = queries.shift()
      if (next === undefined) throw new Error('unexpected extra query')
      return next
    },
    runMutation: async (ref: unknown, args?: unknown) => {
      mutations.push({ ref, args })
      // First call is the transcript duplication itself
      return mutations.length === 1 ? { sessionId: 'sessions_new' } : undefined
    },
  }

  return { ctx, mutations }
}

let originalFetch: typeof globalThis.fetch
let originalSidecarUrl: string | undefined

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalSidecarUrl === undefined) delete process.env.SIDECAR_URL
  else process.env.SIDECAR_URL = originalSidecarUrl
})

function stubFetch(handler: (url: string, body: unknown) => unknown) {
  const calls: Array<{ url: string; body: unknown }> = []
  originalFetch = globalThis.fetch
  originalSidecarUrl = process.env.SIDECAR_URL
  process.env.SIDECAR_URL = SIDECAR
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body })
    return handler(url, body) as Response
  }) as typeof fetch
  return calls
}

describe('duplicateSession workspace re-binding', () => {
  test('re-binds the copy to the source root via the sidecar', async () => {
    const calls = stubFetch(() => ({
      ok: true,
      json: async () => ({
        workspaceId: 'w_new',
        label: 'repo',
        path: '/repo',
      }),
    }))
    const { ctx, mutations } = makeActionCtx({
      _id: 'sessions_src',
      workspace: { workspaceId: 'w_src', label: 'repo', path: '/repo' },
    })

    const result = await duplicateSession(ctx as never, {
      sessionId: 'sessions_src' as Id<'sessions'>,
    })

    expect(result).toEqual({
      sessionId: 'sessions_new' as Id<'sessions'>,
      workspaceBound: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SIDECAR}/workspace/bind`)
    expect(calls[0].body).toEqual({ sessionId: 'sessions_new', root: '/repo' })
    // The resolved binding lands on the copy, not the source
    const patch = mutations[1]
    expect(patch.args).toMatchObject({
      sessionId: 'sessions_new',
      workspace: { workspaceId: 'w_new', path: '/repo' },
    })
  })

  test('reports an unbound copy when the sidecar rejects the bind', async () => {
    stubFetch(() => ({ ok: false, json: async () => ({}) }))
    const { ctx } = makeActionCtx({
      _id: 'sessions_src',
      workspace: { workspaceId: 'w_src', label: 'repo', path: '/repo' },
    })

    const result = await duplicateSession(ctx as never, {
      sessionId: 'sessions_src' as Id<'sessions'>,
    })

    expect(result.workspaceBound).toBe(false)
  })

  test('skips binding entirely when the source has no workspace', async () => {
    const calls = stubFetch(() => ({
      ok: true,
      json: async () => ({}),
    }))
    const { ctx } = makeActionCtx(null)

    const result = await duplicateSession(ctx as never, {
      sessionId: 'sessions_src' as Id<'sessions'>,
    })

    expect(result).toEqual({
      sessionId: 'sessions_new' as Id<'sessions'>,
      workspaceBound: true,
    })
    expect(calls).toEqual([])
  })
})
